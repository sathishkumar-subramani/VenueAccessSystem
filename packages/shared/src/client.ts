import type {
  AuthResponse,
  BalanceDto,
  LedgerEntryDto,
  PassDto,
  PassTokenDto,
  PaymentIntentDto,
  RedeemResultDto,
  UserDto,
  VenueDto,
  VenueTypeDto,
} from "./dto.js";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface TokenStore {
  getAccessToken(): Promise<string | null> | string | null;
  getRefreshToken(): Promise<string | null> | string | null;
  save(tokens: { accessToken: string; refreshToken: string }): Promise<void> | void;
  clear(): Promise<void> | void;
}

export interface ClientOptions {
  baseUrl: string;
  tokens: TokenStore;
  /** Called when the refresh token is rejected and the session is over. */
  onSignedOut?: () => void;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  idempotencyKey?: string;
  /** Internal: stops a refresh loop. */
  retried?: boolean;
}

/**
 * One client for web and mobile. Everything platform-specific (where tokens
 * live) is injected, so the same file runs under Vite and under Metro.
 */
export function createApiClient(options: ClientOptions) {
  const { baseUrl, tokens } = options;
  let refreshing: Promise<boolean> | null = null;

  async function request<T>(path: string, init: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };

    const accessToken = await tokens.getAccessToken();
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    if (init.idempotencyKey) headers["Idempotency-Key"] = init.idempotencyKey;

    const response = await fetch(`${baseUrl}${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });

    if (response.status === 401 && !init.retried) {
      // Collapse concurrent 401s into a single refresh attempt.
      refreshing ??= refreshSession().finally(() => {
        refreshing = null;
      });

      if (await refreshing) {
        return request<T>(path, { ...init, retried: true });
      }

      await tokens.clear();
      options.onSignedOut?.();
      throw new ApiError(401, "unauthorized", "Your session has ended. Please sign in again.");
    }

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as
        | { error?: { code?: string; message?: string } }
        | null;

      throw new ApiError(
        response.status,
        body?.error?.code ?? "unexpected",
        body?.error?.message ?? "Something went wrong. Please try again.",
      );
    }

    return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
  }

  async function refreshSession(): Promise<boolean> {
    const refreshToken = await tokens.getRefreshToken();
    if (!refreshToken) return false;

    const response = await fetch(`${baseUrl}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!response.ok) return false;

    const next = (await response.json()) as { accessToken: string; refreshToken: string };
    await tokens.save(next);
    return true;
  }

  async function authenticate(path: string, body: unknown): Promise<AuthResponse> {
    const result = await request<AuthResponse>(path, { method: "POST", body });
    await tokens.save({ accessToken: result.accessToken, refreshToken: result.refreshToken });
    return result;
  }

  return {
    request,

    auth: {
      signUp: (body: { email: string; password: string; displayName: string }) =>
        authenticate("/auth/signup", body),
      signIn: (body: { email: string; password: string }) => authenticate("/auth/signin", body),
      google: (idToken: string) => authenticate("/auth/google", { idToken }),
      me: () => request<UserDto>("/auth/me"),
      verifyEmail: (body: { email: string; code: string }) =>
        request<void>("/auth/verify-email", { method: "POST", body }),
      resendEmailCode: () => request<void>("/auth/resend-email-code", { method: "POST" }),
      sendPhoneOtp: (phone: string) =>
        request<void>("/auth/phone/send-otp", { method: "POST", body: { phone } }),
      verifyPhone: (code: string) =>
        request<void>("/auth/phone/verify", { method: "POST", body: { code } }),
      signOut: async () => {
        const refreshToken = await tokens.getRefreshToken();
        if (refreshToken) {
          await request<void>("/auth/signout", { method: "POST", body: { refreshToken } }).catch(
            () => undefined,
          );
        }
        await tokens.clear();
      },
    },

    wallet: {
      balance: () => request<BalanceDto>("/wallet/balance"),
      ledger: (page = 1, size = 25) =>
        request<LedgerEntryDto[]>(`/wallet/ledger?page=${page}&size=${size}`),
      startTopUp: (credits: number) =>
        request<PaymentIntentDto>("/wallet/top-up", { method: "POST", body: { credits } }),
    },

    venues: {
      types: () => request<VenueTypeDto[]>("/venues/types"),
      list: (filter: { type?: string; city?: string } = {}) => {
        const query = new URLSearchParams();
        if (filter.type) query.set("type", filter.type);
        if (filter.city) query.set("city", filter.city);
        const suffix = query.toString();
        return request<VenueDto[]>(`/venues${suffix ? `?${suffix}` : ""}`);
      },
      byId: (id: string) => request<VenueDto>(`/venues/${id}`),
    },

    passes: {
      mine: () => request<PassDto[]>("/passes"),
      byId: (id: string) => request<PassDto>(`/passes/${id}`),
      purchase: (
        body: {
          venueId: string;
          accessPlanId: string;
          requestedFor: string;
          options?: Record<string, string>;
        },
        idempotencyKey: string,
      ) => request<PassDto>("/passes", { method: "POST", body, idempotencyKey }),
      token: (passId: string) => request<PassTokenDto>(`/passes/${passId}/token`),
    },

    operator: {
      redeem: (token: string) =>
        request<RedeemResultDto>("/operator/redeem", { method: "POST", body: { token } }),
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

/** The server dedupes on this, so a double-tap cannot buy two passes. */
export function newIdempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

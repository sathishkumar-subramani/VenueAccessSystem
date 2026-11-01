export type ErrorCode =
  | "not_found"
  | "validation"
  | "conflict"
  | "forbidden"
  | "unauthorized"
  | "insufficient_credits"
  | "duplicate_request"
  | "pass_expired"
  | "pass_not_yet_valid"
  | "pass_not_active"
  | "no_entries_remaining"
  | "re_entry_not_allowed"
  | "invalid_pass_token"
  | "rate_limited"
  | "provider_unavailable"
  | "unexpected";

export interface AppError {
  readonly code: ErrorCode;
  readonly message: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: AppError };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });

export const fail = <T = never>(code: ErrorCode, message: string): Result<T> => ({
  ok: false,
  error: { code, message },
});

export const failWith = <T = never>(error: AppError): Result<T> => ({ ok: false, error });

export const errors = {
  notFound: (what: string) => ({ code: "not_found" as const, message: `${what} was not found.` }),
  validation: (message: string) => ({ code: "validation" as const, message }),
  conflict: (message: string) => ({ code: "conflict" as const, message }),
  forbidden: (message: string) => ({ code: "forbidden" as const, message }),
  insufficientCredits: {
    code: "insufficient_credits" as const,
    message: "There are not enough credits in this wallet.",
  },
  invalidPassToken: {
    code: "invalid_pass_token" as const,
    message: "This code is invalid or has expired. Ask them to refresh it.",
  },
} as const;

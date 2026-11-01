/**
 * The wire contract. The API, the web app and the mobile app all import these,
 * so renaming a field here breaks compilation in all three at once — which is
 * exactly what you want. No field is added to a response that is not here.
 */

export type UserRole = "end_user" | "venue_operator" | "platform_admin";

export interface UserDto {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  emailVerified: boolean;
  phoneVerified: boolean;
  phoneE164: string | null;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: UserDto;
}

export interface BalanceDto {
  credits: number;
}

export interface LedgerEntryDto {
  id: string;
  type: "top_up" | "spend" | "refund" | "adjustment" | "expiry";
  amount: number;
  signed: number;
  reason: string;
  occurredAt: string;
}

export interface PlanDto {
  id: string;
  name: string;
  cost: number;
  config: Record<string, unknown>;
}

export interface VenueDto {
  id: string;
  name: string;
  typeKey: string;
  city: string | null;
  addressLine: string | null;
  plans: PlanDto[];
}

export interface VenueTypeDto {
  key: string;
  displayName: string;
  planConfigSchema: Record<string, unknown>;
}

export type PassState = "active" | "exhausted" | "expired" | "cancelled";

export interface PassDto {
  id: string;
  venueId: string;
  venueName: string;
  venueTypeKey: string;
  validFrom: string;
  validUntil: string;
  maxEntries: number;
  entriesRemaining: number;
  state: PassState;
  creditsPaid: number;
}

export interface PassTokenDto {
  token: string;
  expiresInMs: number;
}

export interface RedeemResultDto {
  admitted: boolean;
  message: string;
  entriesRemaining: number;
}

export interface PaymentIntentDto {
  providerOrderId: string;
  amountPaise: number;
  currency: string;
  publicKey: string;
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}

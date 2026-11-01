import type { Credits } from "./credits.js";

export type UserRole = "end_user" | "venue_operator" | "platform_admin";

export interface User {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  walletId: string;
  phoneE164: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
  googleSubjectId: string | null;
  createdAt: Date;
}

export type LedgerEntryType = "top_up" | "spend" | "refund" | "adjustment" | "expiry";

/** Append-only. Never updated, never deleted. A correction is a new entry. */
export interface LedgerEntry {
  id: string;
  walletId: string;
  type: LedgerEntryType;
  /** Always positive. `type` carries the direction. */
  amount: Credits;
  reason: string;
  referenceId: string | null;
  /** Unique index. A retried request returns the original entry instead of moving credits twice. */
  idempotencyKey: string;
  occurredAt: Date;
}

export const isDebit = (type: LedgerEntryType): boolean =>
  type === "spend" || type === "expiry";

export const signedValue = (entry: Pick<LedgerEntry, "type" | "amount">): number =>
  isDebit(entry.type) ? -entry.amount : entry.amount;

/** The key that selects a plugin. Core code never switches on its value. */
export type VenueTypeKey = string;

export interface Venue {
  id: string;
  name: string;
  typeKey: VenueTypeKey;
  operatorUserId: string;
  city: string | null;
  addressLine: string | null;
  isActive: boolean;
  plans: AccessPlan[];
  createdAt: Date;
}

export interface AccessPlan {
  id: string;
  venueId: string;
  name: string;
  cost: Credits;
  /** Opaque to the core. Only the venue-type plugin knows how to read it. */
  config: Record<string, unknown>;
  isActive: boolean;
}

export type PassState = "active" | "exhausted" | "expired" | "cancelled";

export interface CheckIn {
  scanNonce: string;
  scannedByUserId: string;
  occurredAt: Date;
}

export interface AccessPass {
  id: string;
  userId: string;
  venueId: string;
  accessPlanId: string;
  creditsPaid: Credits;
  validFrom: Date;
  validUntil: Date;
  maxEntries: number;
  entriesUsed: number;
  reEntryAllowed: boolean;
  state: PassState;
  checkIns: CheckIn[];
  createdAt: Date;
}

export const entriesRemaining = (pass: Pick<AccessPass, "maxEntries" | "entriesUsed">): number =>
  Math.max(pass.maxEntries - pass.entriesUsed, 0);

/**
 * Read-side view of whether a pass is usable right now. The write path does NOT
 * use this — it uses PassRepository.tryConsumeEntry, which applies the same rules
 * inside a single atomic database operation. Two readers cannot both be told "yes".
 */
export function describePassState(pass: AccessPass, now: Date): PassState {
  if (pass.state !== "active") return pass.state;
  if (now > pass.validUntil) return "expired";
  if (entriesRemaining(pass) === 0) return "exhausted";
  return "active";
}

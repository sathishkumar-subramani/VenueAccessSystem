import type { Credits } from "../domain/credits.js";
import type {
  AccessPass,
  AccessPlan,
  LedgerEntry,
  LedgerEntryType,
  User,
  UserRole,
  Venue,
  VenueTypeKey,
} from "../domain/entities.js";
import type { Result } from "../domain/result.js";

export interface Paging {
  page: number;
  size: number;
}

export interface LedgerCommand {
  walletId: string;
  type: LedgerEntryType;
  amount: Credits;
  reason: string;
  idempotencyKey: string;
  referenceId?: string | null;
}

/**
 * The only way credits move.
 *
 * An implementation MUST guarantee, without relying on anything the caller does:
 *  1. a debit that would overdraw the wallet changes nothing and fails;
 *  2. the balance and the inserted entry are written together or not at all;
 *  3. the same idempotencyKey twice moves credits once and returns the first entry.
 *
 * Checking the balance in application code and then writing is NOT an
 * implementation of this interface, however carefully it is written.
 */
export interface LedgerStore {
  openWallet(walletId: string): Promise<void>;
  getBalance(walletId: string): Promise<Credits>;
  append(command: LedgerCommand): Promise<Result<LedgerEntry>>;
  history(walletId: string, paging: Paging): Promise<LedgerEntry[]>;
  /** Cached balance vs the signed sum of every entry. Run nightly; alarm on drift. */
  reconcile(walletId: string): Promise<{ cached: number; computed: number }>;
}

export type CreateUserInput = Omit<User, "id" | "createdAt"> & {
  /** Null for accounts that only ever sign in with Google. */
  passwordHash?: string | null;
};

export interface UserRepository {
  byId(id: string): Promise<User | null>;
  byEmail(email: string): Promise<User | null>;
  byGoogleSubject(subjectId: string): Promise<User | null>;
  /**
   * The only way the hash leaves the database. Kept off the User entity so a
   * credential cannot be serialised into an API response by accident.
   */
  credentialsByEmail(email: string): Promise<{ user: User; passwordHash: string | null } | null>;
  create(user: CreateUserInput): Promise<User>;
  update(
    id: string,
    patch: Partial<Pick<User, "phoneE164" | "emailVerified" | "phoneVerified" | "googleSubjectId" | "role">>,
  ): Promise<User | null>;
}

export interface VenueRepository {
  byId(id: string): Promise<Venue | null>;
  planById(planId: string): Promise<AccessPlan | null>;
  list(filter: { typeKey?: VenueTypeKey; city?: string }, paging: Paging): Promise<Venue[]>;
  create(venue: Omit<Venue, "id" | "createdAt" | "plans" | "isActive">): Promise<Venue>;
  addPlan(venueId: string, plan: Omit<AccessPlan, "id" | "venueId" | "isActive">): Promise<AccessPlan>;
}

export type ConsumeOutcome =
  | { status: "admitted"; pass: AccessPass }
  /** The same physical scan arriving twice. Idempotent: no second entry consumed. */
  | { status: "replay"; pass: AccessPass }
  | { status: "rejected"; pass: AccessPass | null; reason: RejectionReason };

export type RejectionReason =
  | "not_found"
  | "not_active"
  | "not_yet_valid"
  | "expired"
  | "exhausted"
  | "re_entry_not_allowed";

export interface PassRepository {
  byId(id: string): Promise<AccessPass | null>;
  listForUser(userId: string): Promise<AccessPass[]>;
  countActiveAtVenue(venueId: string, day: Date): Promise<number>;
  userHasActivePass(userId: string, venueId: string, at: Date): Promise<boolean>;
  create(pass: Omit<AccessPass, "id" | "createdAt" | "checkIns" | "entriesUsed" | "state">): Promise<AccessPass>;
  /**
   * Validate and consume one entry in a SINGLE atomic operation.
   * Two simultaneous scanners must never both receive "admitted" for the last entry.
   */
  tryConsumeEntry(input: {
    passId: string;
    scanNonce: string;
    scannedByUserId: string;
    at: Date;
  }): Promise<ConsumeOutcome>;
}

export interface VerificationCodeStore {
  /** Stores a hash, not the code. Expires on its own. */
  store(purpose: string, subject: string, code: string, ttlMs: number): Promise<void>;
  /** Attempt-capped. Consuming a correct code removes it. */
  consume(purpose: string, subject: string, code: string): Promise<boolean>;
  sendsInLastHour(purpose: string, subject: string): Promise<number>;
}

export interface RefreshTokenStore {
  issue(userId: string, ttlMs: number): Promise<string>;
  /** Rotates: the presented token is invalidated as the new one is minted. */
  rotate(token: string, ttlMs: number): Promise<Result<{ userId: string; token: string }>>;
  revokeAllForUser(userId: string): Promise<void>;
}

export interface SeedUserInput {
  email: string;
  displayName: string;
  role: UserRole;
}

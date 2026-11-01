import { Schema, model, type InferSchemaType } from "mongoose";

/* ------------------------------------------------------------------ users */

const userSchema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    displayName: { type: String, required: true, trim: true },
    /** Absent for accounts that only ever sign in with Google. */
    passwordHash: { type: String, default: null },
    googleSubjectId: { type: String, default: null },
    role: {
      type: String,
      enum: ["end_user", "venue_operator", "platform_admin"],
      default: "end_user",
    },
    walletId: { type: String, required: true },
    phoneE164: { type: String, default: null },
    emailVerified: { type: Boolean, default: false },
    phoneVerified: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: true } },
);

userSchema.index({ email: 1 }, { unique: true });
// A PARTIAL index, not a sparse one. `sparse` only skips documents where the
// field is absent — but googleSubjectId defaults to null, so the field is
// present on every password account and they all collide on null. The partial
// filter restricts uniqueness to accounts that actually have a Google subject.
userSchema.index(
  { googleSubjectId: 1 },
  { unique: true, partialFilterExpression: { googleSubjectId: { $type: "string" } } },
);
userSchema.index({ walletId: 1 }, { unique: true });

export const UserModel = model("User", userSchema);
export type UserDoc = InferSchemaType<typeof userSchema> & { _id: unknown; createdAt: Date };

/* ---------------------------------------------------------------- wallets */

/**
 * One row per wallet, holding the cached balance. It is mutated ONLY by the
 * conditional findOneAndUpdate inside MongoLedgerStore, in the same transaction
 * as the ledger insert. Truth is the ledger; this is a fast view of it.
 */
const walletSchema = new Schema(
  {
    _id: { type: String, required: true }, // uuid, minted when the user is created
    balance: { type: Number, required: true, default: 0, min: 0 },
  },
  { timestamps: true, _id: false },
);

export const WalletModel = model("Wallet", walletSchema);

/* --------------------------------------------------------- ledger entries */

const ledgerEntrySchema = new Schema({
  walletId: { type: String, required: true },
  type: {
    type: String,
    enum: ["top_up", "spend", "refund", "adjustment", "expiry"],
    required: true,
  },
  /** Always positive. `type` carries the direction. */
  amount: { type: Number, required: true, min: 1 },
  reason: { type: String, required: true },
  referenceId: { type: String, default: null },
  idempotencyKey: { type: String, required: true },
  occurredAt: { type: Date, required: true },
});

// The index that makes a retried request safe. Without it, a network retry
// during a top-up credits the wallet twice.
ledgerEntrySchema.index({ idempotencyKey: 1 }, { unique: true });
ledgerEntrySchema.index({ walletId: 1, occurredAt: -1 });

export const LedgerEntryModel = model("LedgerEntry", ledgerEntrySchema);

/* ----------------------------------------------------------------- venues */

const accessPlanSchema = new Schema({
  name: { type: String, required: true },
  cost: { type: Number, required: true, min: 0 },
  /** Opaque to the core. Only the venue-type plugin reads it. */
  config: { type: Schema.Types.Mixed, default: {} },
  isActive: { type: Boolean, default: true },
});

const venueSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    typeKey: { type: String, required: true, lowercase: true },
    operatorUserId: { type: Schema.Types.ObjectId, required: true, ref: "User" },
    city: { type: String, default: null },
    addressLine: { type: String, default: null },
    isActive: { type: Boolean, default: true },
    plans: { type: [accessPlanSchema], default: [] },
  },
  { timestamps: true },
);

venueSchema.index({ typeKey: 1, isActive: 1 });
venueSchema.index({ city: 1, isActive: 1 });
venueSchema.index({ operatorUserId: 1 });

export const VenueModel = model("Venue", venueSchema);

/* ------------------------------------------------------------------ passes */

const checkInSchema = new Schema(
  {
    scanNonce: { type: String, required: true },
    scannedByUserId: { type: Schema.Types.ObjectId, required: true },
    occurredAt: { type: Date, required: true },
  },
  { _id: false },
);

const accessPassSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, ref: "User" },
    venueId: { type: Schema.Types.ObjectId, required: true, ref: "Venue" },
    accessPlanId: { type: Schema.Types.ObjectId, required: true },
    creditsPaid: { type: Number, required: true, min: 0 },
    validFrom: { type: Date, required: true },
    validUntil: { type: Date, required: true },
    maxEntries: { type: Number, required: true, min: 1 },
    entriesUsed: { type: Number, required: true, default: 0, min: 0 },
    reEntryAllowed: { type: Boolean, required: true, default: false },
    state: {
      type: String,
      enum: ["active", "exhausted", "expired", "cancelled"],
      default: "active",
    },
    checkIns: { type: [checkInSchema], default: [] },
  },
  { timestamps: true },
);

accessPassSchema.index({ userId: 1, state: 1 });
accessPassSchema.index({ venueId: 1, validFrom: 1, validUntil: 1 });
// A replayed scan must never consume a second entry.
accessPassSchema.index({ _id: 1, "checkIns.scanNonce": 1 });

export const AccessPassModel = model("AccessPass", accessPassSchema);

/* ------------------------------------------------- verification + refresh */

const verificationCodeSchema = new Schema({
  purpose: { type: String, required: true },
  subject: { type: String, required: true },
  /** SHA-256 of the code. The code itself is never stored or logged. */
  codeHash: { type: String, required: true },
  attempts: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true },
  createdAt: { type: Date, default: () => new Date() },
});

verificationCodeSchema.index({ purpose: 1, subject: 1 }, { unique: true });
// Mongo removes the document itself once it expires. No cleanup job to forget.
verificationCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const VerificationCodeModel = model("VerificationCode", verificationCodeSchema);

const sendLogSchema = new Schema({
  purpose: { type: String, required: true },
  subject: { type: String, required: true },
  sentAt: { type: Date, required: true },
  /** Kept only long enough to enforce the hourly cap. */
  expiresAt: { type: Date, required: true },
});

sendLogSchema.index({ purpose: 1, subject: 1, sentAt: -1 });
sendLogSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const CodeSendLogModel = model("CodeSendLog", sendLogSchema);

const refreshTokenSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, required: true, ref: "User" },
  /** SHA-256 of the token. A database leak does not hand over live sessions. */
  tokenHash: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  createdAt: { type: Date, default: () => new Date() },
});

refreshTokenSchema.index({ tokenHash: 1 }, { unique: true });
refreshTokenSchema.index({ userId: 1 });
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshTokenModel = model("RefreshToken", refreshTokenSchema);

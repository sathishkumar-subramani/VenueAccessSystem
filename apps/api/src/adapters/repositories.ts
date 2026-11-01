import mongoose from "mongoose";
import type {
  AccessPass,
  AccessPlan,
  ConsumeOutcome,
  CreateUserInput,
  Paging,
  PassRepository,
  RejectionReason,
  User,
  UserRepository,
  Venue,
  VenueRepository,
} from "@venue/core";
import { AccessPassModel, UserModel, VenueModel } from "../db/models.js";

const oid = (value: string) => new mongoose.Types.ObjectId(value);
const isOid = (value: string) => mongoose.Types.ObjectId.isValid(value);

/* ------------------------------------------------------------------ users */

type AnyUserDoc = {
  _id: unknown;
  email: string;
  displayName: string;
  role: User["role"];
  walletId: string;
  phoneE164: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
  googleSubjectId: string | null;
  passwordHash?: string | null;
  createdAt?: Date;
};

function toUser(doc: AnyUserDoc): User {
  return {
    id: String(doc._id),
    email: doc.email,
    displayName: doc.displayName,
    role: doc.role,
    walletId: doc.walletId,
    phoneE164: doc.phoneE164 ?? null,
    emailVerified: doc.emailVerified,
    phoneVerified: doc.phoneVerified,
    googleSubjectId: doc.googleSubjectId ?? null,
    createdAt: doc.createdAt ?? new Date(),
  };
}

export class MongoUserRepository implements UserRepository {
  async byId(id: string): Promise<User | null> {
    if (!isOid(id)) return null;
    const doc = await UserModel.findById(id).lean<AnyUserDoc | null>();
    return doc ? toUser(doc) : null;
  }

  async byEmail(email: string): Promise<User | null> {
    const doc = await UserModel.findOne({ email: email.toLowerCase() }).lean<AnyUserDoc | null>();
    return doc ? toUser(doc) : null;
  }

  async byGoogleSubject(subjectId: string): Promise<User | null> {
    const doc = await UserModel.findOne({ googleSubjectId: subjectId }).lean<AnyUserDoc | null>();
    return doc ? toUser(doc) : null;
  }

  /** The only path the hash takes out of the database. */
  async credentialsByEmail(email: string) {
    const doc = await UserModel.findOne({ email: email.toLowerCase() })
      .select("+passwordHash")
      .lean<AnyUserDoc | null>();

    return doc ? { user: toUser(doc), passwordHash: doc.passwordHash ?? null } : null;
  }

  async create(input: CreateUserInput): Promise<User> {
    const doc = await UserModel.create({
      email: input.email,
      displayName: input.displayName,
      role: input.role,
      walletId: input.walletId,
      phoneE164: input.phoneE164,
      emailVerified: input.emailVerified,
      phoneVerified: input.phoneVerified,
      googleSubjectId: input.googleSubjectId,
      passwordHash: input.passwordHash ?? null,
    });

    return toUser(doc.toObject() as AnyUserDoc);
  }

  async update(id: string, patch: Partial<User>): Promise<User | null> {
    if (!isOid(id)) return null;
    const doc = await UserModel.findByIdAndUpdate(id, { $set: patch }, { new: true })
      .lean<AnyUserDoc | null>();
    return doc ? toUser(doc) : null;
  }
}

/* ----------------------------------------------------------------- venues */

type AnyPlanDoc = {
  _id: unknown;
  name: string;
  cost: number;
  config: Record<string, unknown>;
  isActive: boolean;
};

type AnyVenueDoc = {
  _id: unknown;
  name: string;
  typeKey: string;
  operatorUserId: unknown;
  city: string | null;
  addressLine: string | null;
  isActive: boolean;
  plans: AnyPlanDoc[];
  createdAt?: Date;
};

const toPlan = (venueId: string, doc: AnyPlanDoc): AccessPlan => ({
  id: String(doc._id),
  venueId,
  name: doc.name,
  cost: doc.cost,
  config: (doc.config ?? {}) as Record<string, unknown>,
  isActive: doc.isActive,
});

function toVenue(doc: AnyVenueDoc): Venue {
  const id = String(doc._id);
  return {
    id,
    name: doc.name,
    typeKey: doc.typeKey,
    operatorUserId: String(doc.operatorUserId),
    city: doc.city ?? null,
    addressLine: doc.addressLine ?? null,
    isActive: doc.isActive,
    plans: (doc.plans ?? []).map((plan) => toPlan(id, plan)),
    createdAt: doc.createdAt ?? new Date(),
  };
}

export class MongoVenueRepository implements VenueRepository {
  async byId(id: string): Promise<Venue | null> {
    if (!isOid(id)) return null;
    const doc = await VenueModel.findById(id).lean<AnyVenueDoc | null>();
    return doc ? toVenue(doc) : null;
  }

  /** Plans are embedded, so this finds the parent venue and picks the sub-document. */
  async planById(planId: string): Promise<AccessPlan | null> {
    if (!isOid(planId)) return null;

    const doc = await VenueModel.findOne({ "plans._id": oid(planId) }).lean<AnyVenueDoc | null>();
    if (!doc) return null;

    const plan = doc.plans.find((p) => String(p._id) === planId);
    return plan ? toPlan(String(doc._id), plan) : null;
  }

  async list(filter: { typeKey?: string; city?: string }, paging: Paging): Promise<Venue[]> {
    const size = Math.min(Math.max(paging.size, 1), 100);
    const query: Record<string, unknown> = { isActive: true };

    if (filter.typeKey) query.typeKey = filter.typeKey.toLowerCase();
    if (filter.city) query.city = filter.city;

    const docs = await VenueModel.find(query)
      .sort({ name: 1 })
      .skip((Math.max(paging.page, 1) - 1) * size)
      .limit(size)
      .lean<AnyVenueDoc[]>();

    return docs.map(toVenue);
  }

  async create(input: Omit<Venue, "id" | "createdAt" | "plans" | "isActive">): Promise<Venue> {
    const doc = await VenueModel.create({
      name: input.name,
      typeKey: input.typeKey,
      operatorUserId: oid(input.operatorUserId),
      city: input.city,
      addressLine: input.addressLine,
    });

    return toVenue(doc.toObject() as AnyVenueDoc);
  }

  async addPlan(
    venueId: string,
    plan: Omit<AccessPlan, "id" | "venueId" | "isActive">,
  ): Promise<AccessPlan> {
    const doc = await VenueModel.findByIdAndUpdate(
      venueId,
      { $push: { plans: { name: plan.name, cost: plan.cost, config: plan.config } } },
      { new: true },
    ).lean<AnyVenueDoc | null>();

    if (!doc) throw new Error(`Venue ${venueId} disappeared while adding a plan.`);

    const added = doc.plans[doc.plans.length - 1];
    if (!added) throw new Error("Plan was not appended.");

    return toPlan(venueId, added);
  }
}

/* ------------------------------------------------------------------ passes */

type AnyPassDoc = {
  _id: unknown;
  userId: unknown;
  venueId: unknown;
  accessPlanId: unknown;
  creditsPaid: number;
  validFrom: Date;
  validUntil: Date;
  maxEntries: number;
  entriesUsed: number;
  reEntryAllowed: boolean;
  state: AccessPass["state"];
  checkIns: { scanNonce: string; scannedByUserId: unknown; occurredAt: Date }[];
  createdAt?: Date;
};

function toPass(doc: AnyPassDoc): AccessPass {
  return {
    id: String(doc._id),
    userId: String(doc.userId),
    venueId: String(doc.venueId),
    accessPlanId: String(doc.accessPlanId),
    creditsPaid: doc.creditsPaid,
    validFrom: doc.validFrom,
    validUntil: doc.validUntil,
    maxEntries: doc.maxEntries,
    entriesUsed: doc.entriesUsed,
    reEntryAllowed: doc.reEntryAllowed,
    state: doc.state,
    checkIns: (doc.checkIns ?? []).map((c) => ({
      scanNonce: c.scanNonce,
      scannedByUserId: String(c.scannedByUserId),
      occurredAt: c.occurredAt,
    })),
    createdAt: doc.createdAt ?? new Date(),
  };
}

export class MongoPassRepository implements PassRepository {
  async byId(id: string): Promise<AccessPass | null> {
    if (!isOid(id)) return null;
    const doc = await AccessPassModel.findById(id).lean<AnyPassDoc | null>();
    return doc ? toPass(doc) : null;
  }

  async listForUser(userId: string): Promise<AccessPass[]> {
    if (!isOid(userId)) return [];

    const docs = await AccessPassModel.find({ userId: oid(userId) })
      .sort({ validFrom: -1 })
      .limit(100)
      .lean<AnyPassDoc[]>();

    return docs.map(toPass);
  }

  async countActiveAtVenue(venueId: string, day: Date): Promise<number> {
    const from = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
    const to = new Date(from.getTime() + 86_400_000);

    return AccessPassModel.countDocuments({
      venueId: oid(venueId),
      state: { $ne: "cancelled" },
      validFrom: { $lt: to },
      validUntil: { $gt: from },
    });
  }

  async userHasActivePass(userId: string, venueId: string, at: Date): Promise<boolean> {
    const found = await AccessPassModel.exists({
      userId: oid(userId),
      venueId: oid(venueId),
      state: "active",
      validFrom: { $lte: at },
      validUntil: { $gt: at },
    });

    return found !== null;
  }

  async create(
    input: Omit<AccessPass, "id" | "createdAt" | "checkIns" | "entriesUsed" | "state">,
  ): Promise<AccessPass> {
    const doc = await AccessPassModel.create({
      userId: oid(input.userId),
      venueId: oid(input.venueId),
      accessPlanId: oid(input.accessPlanId),
      creditsPaid: input.creditsPaid,
      validFrom: input.validFrom,
      validUntil: input.validUntil,
      maxEntries: input.maxEntries,
      reEntryAllowed: input.reEntryAllowed,
    });

    return toPass(doc.toObject() as AnyPassDoc);
  }

  /**
   * Validate and consume one entry in a SINGLE atomic update.
   *
   * Every rule — the time window, the entry count, the re-entry setting — is in
   * the filter, so MongoDB decides. If two scanners hit the last entry at the
   * same moment, exactly one update matches and the other gets null. No lock,
   * no Redis, no read-then-write race.
   */
  async tryConsumeEntry(input: {
    passId: string;
    scanNonce: string;
    scannedByUserId: string;
    at: Date;
  }): Promise<ConsumeOutcome> {
    if (!isOid(input.passId)) return { status: "rejected", pass: null, reason: "not_found" };

    // The same physical scan arriving twice (a network retry) must be idempotent.
    const replayed = await AccessPassModel.findOne({
      _id: oid(input.passId),
      "checkIns.scanNonce": input.scanNonce,
    }).lean<AnyPassDoc | null>();

    if (replayed) return { status: "replay", pass: toPass(replayed) };

    const updated = await AccessPassModel.findOneAndUpdate(
      {
        _id: oid(input.passId),
        state: "active",
        validFrom: { $lte: input.at },
        validUntil: { $gt: input.at },
        "checkIns.scanNonce": { $ne: input.scanNonce },
        $expr: { $lt: ["$entriesUsed", "$maxEntries"] },
        // Re-entry off means this must be the first entry.
        $or: [{ reEntryAllowed: true }, { entriesUsed: 0 }],
      },
      {
        $inc: { entriesUsed: 1 },
        $push: {
          checkIns: {
            scanNonce: input.scanNonce,
            scannedByUserId: oid(input.scannedByUserId),
            occurredAt: input.at,
          },
        },
      },
      { returnDocument: "after" },
    ).lean<AnyPassDoc | null>();

    if (!updated) {
      return { status: "rejected", pass: null, reason: await this.diagnose(input.passId, input.at) };
    }

    // Bookkeeping only — the entry has already been consumed atomically above.
    if (updated.entriesUsed >= updated.maxEntries) {
      await AccessPassModel.updateOne(
        { _id: updated._id, state: "active" },
        { $set: { state: "exhausted" } },
      );
      updated.state = "exhausted";
    }

    return { status: "admitted", pass: toPass(updated) };
  }

  /** Runs only on the failure path, to tell the door staff why. */
  private async diagnose(passId: string, at: Date): Promise<RejectionReason> {
    const doc = await AccessPassModel.findById(passId).lean<AnyPassDoc | null>();
    if (!doc) return "not_found";

    if (at < doc.validFrom) return "not_yet_valid";

    if (at > doc.validUntil) {
      // Mark it once, so lists stop showing it as active.
      await AccessPassModel.updateOne(
        { _id: doc._id, state: "active" },
        { $set: { state: "expired" } },
      );
      return "expired";
    }

    if (doc.state === "cancelled") return "not_active";
    if (doc.entriesUsed >= doc.maxEntries) return "exhausted";
    if (!doc.reEntryAllowed && doc.entriesUsed > 0) return "re_entry_not_allowed";

    return "not_active";
  }
}

import mongoose, { type ClientSession } from "mongoose";
import {
  assertCredits,
  errors,
  failWith,
  isDebit,
  ok,
  signedValue,
  type Credits,
  type LedgerCommand,
  type LedgerEntry,
  type LedgerStore,
  type Logger,
  type Paging,
  type Result,
} from "@venue/core";
import { LedgerEntryModel, WalletModel } from "../db/models.js";

/** Thrown to roll the transaction back deliberately. Carries the reason out. */
class AbortTransaction extends Error {
  constructor(readonly outcome: Result<LedgerEntry>) {
    super("ledger transaction aborted");
  }
}

const DUPLICATE_KEY = 11000;

/**
 * The only place credits move.
 *
 * Three things keep it correct, and none of them is application-level checking:
 *
 *   1. A conditional update — findOneAndUpdate with `balance: { $gte: amount }`.
 *      MongoDB matches and decrements in one atomic step. If it matches nothing,
 *      there were not enough credits. There is no read-then-write gap for two
 *      concurrent requests to slip through.
 *
 *   2. A unique index on idempotencyKey. A retried request hits a duplicate-key
 *      error and gets the original entry back instead of moving credits again.
 *
 *   3. A transaction around both writes, so the cached balance and the ledger
 *      entry can never disagree.
 *
 * Do NOT "simplify" this into: read the balance, compare it in JavaScript, then
 * update. That version passes every single-user test and loses money in
 * production the first time somebody double-taps.
 */
export class MongoLedgerStore implements LedgerStore {
  constructor(private readonly logger: Logger) {}

  async openWallet(walletId: string): Promise<void> {
    await WalletModel.updateOne(
      { _id: walletId },
      { $setOnInsert: { balance: 0 } },
      { upsert: true },
    );
  }

  async getBalance(walletId: string): Promise<Credits> {
    const wallet = await WalletModel.findById(walletId).lean();
    return wallet?.balance ?? 0;
  }

  async append(command: LedgerCommand): Promise<Result<LedgerEntry>> {
    const existing = await this.findByIdempotencyKey(command.idempotencyKey);
    if (existing) return ok(existing);

    try {
      assertCredits(command.amount, "Ledger amount");
    } catch {
      return failWith(errors.validation("A ledger amount must be a whole number above zero."));
    }
    if (command.amount === 0) {
      return failWith(errors.validation("A ledger entry cannot be for zero credits."));
    }

    const delta = signedValue({ type: command.type, amount: command.amount });
    const session = await mongoose.startSession();

    try {
      let result!: Result<LedgerEntry>;

      await session.withTransaction(async () => {
        result = await this.runInsideTransaction(command, delta, session);
      });

      return result;
    } catch (cause) {
      if (cause instanceof AbortTransaction) return cause.outcome;

      // Someone else committed the same idempotency key while we were working.
      if (isDuplicateKeyError(cause)) {
        const winner = await this.findByIdempotencyKey(command.idempotencyKey);
        return winner
          ? ok(winner)
          : failWith({
              code: "duplicate_request",
              message: "This request has already been processed.",
            });
      }

      this.logger.error("Ledger append failed", {
        walletId: command.walletId,
        idempotencyKey: command.idempotencyKey,
        cause: String(cause),
      });
      throw cause;
    } finally {
      await session.endSession();
    }
  }

  private async runInsideTransaction(
    command: LedgerCommand,
    delta: number,
    session: ClientSession,
  ): Promise<Result<LedgerEntry>> {
    const debit = isDebit(command.type);

    // The guard lives in the query, not in JavaScript.
    const filter = debit
      ? { _id: command.walletId, balance: { $gte: command.amount } }
      : { _id: command.walletId };

    const wallet = await WalletModel.findOneAndUpdate(
      filter,
      { $inc: { balance: delta } },
      { session, returnDocument: "after" },
    );

    if (!wallet) {
      // Nothing matched. Either the wallet is missing or the balance is short.
      const exists = await WalletModel.exists({ _id: command.walletId }).session(session);
      throw new AbortTransaction(
        failWith(exists ? errors.insufficientCredits : errors.notFound("Wallet")),
      );
    }

    const occurredAt = new Date();
    const [doc] = await LedgerEntryModel.create(
      [
        {
          walletId: command.walletId,
          type: command.type,
          amount: command.amount,
          reason: command.reason,
          referenceId: command.referenceId ?? null,
          idempotencyKey: command.idempotencyKey,
          occurredAt,
        },
      ],
      { session },
    );

    if (!doc) throw new Error("Ledger entry insert returned nothing.");

    return ok({
      id: String(doc._id),
      walletId: command.walletId,
      type: command.type,
      amount: command.amount,
      reason: command.reason,
      referenceId: command.referenceId ?? null,
      idempotencyKey: command.idempotencyKey,
      occurredAt,
    });
  }

  async history(walletId: string, paging: Paging): Promise<LedgerEntry[]> {
    const size = Math.min(Math.max(paging.size, 1), 100);
    const skip = (Math.max(paging.page, 1) - 1) * size;

    const docs = await LedgerEntryModel.find({ walletId })
      .sort({ occurredAt: -1 })
      .skip(skip)
      .limit(size)
      .lean();

    return docs.map((doc) => ({
      id: String(doc._id),
      walletId: doc.walletId,
      type: doc.type,
      amount: doc.amount,
      reason: doc.reason,
      referenceId: doc.referenceId ?? null,
      idempotencyKey: doc.idempotencyKey,
      occurredAt: doc.occurredAt,
    }));
  }

  /**
   * The cached balance must equal the signed sum of every entry. Run this
   * nightly for every wallet and alarm on any difference — it is the only thing
   * that catches a bug writing to WalletModel outside this class.
   */
  async reconcile(walletId: string): Promise<{ cached: number; computed: number }> {
    const cached = await this.getBalance(walletId);

    const [aggregate] = await LedgerEntryModel.aggregate<{ total: number }>([
      { $match: { walletId } },
      {
        $group: {
          _id: null,
          total: {
            $sum: {
              $cond: [{ $in: ["$type", ["spend", "expiry"]] }, { $multiply: ["$amount", -1] }, "$amount"],
            },
          },
        },
      },
    ]);

    return { cached, computed: aggregate?.total ?? 0 };
  }

  private async findByIdempotencyKey(key: string): Promise<LedgerEntry | null> {
    const doc = await LedgerEntryModel.findOne({ idempotencyKey: key }).lean();
    if (!doc) return null;

    return {
      id: String(doc._id),
      walletId: doc.walletId,
      type: doc.type,
      amount: doc.amount,
      reason: doc.reason,
      referenceId: doc.referenceId ?? null,
      idempotencyKey: doc.idempotencyKey,
      occurredAt: doc.occurredAt,
    };
  }
}

function isDuplicateKeyError(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    (cause as { code?: number }).code === DUPLICATE_KEY
  );
}

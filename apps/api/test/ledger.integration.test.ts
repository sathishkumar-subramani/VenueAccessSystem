import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import mongoose from "mongoose";
import { MongoLedgerStore } from "../src/adapters/mongoLedgerStore.js";
import { MongoPassRepository } from "../src/adapters/repositories.js";
import { AccessPassModel, LedgerEntryModel, WalletModel } from "../src/db/models.js";

/**
 * THE TESTS THAT MATTER.
 *
 * Everything else in this repo is checked with fakes, and fakes cannot prove
 * the one thing that actually loses money: what happens when two requests hit
 * the same wallet at the same instant. That needs a real MongoDB, because the
 * guarantee lives in the database, not in the JavaScript.
 *
 *   docker compose up -d
 *   docker compose exec mongo mongosh --eval 'rs.initiate()'
 *   TEST_MONGODB_URI=mongodb://localhost:27017/venue-access-test?replicaSet=rs0 \
 *     pnpm --filter @venue/api test
 *
 * Without TEST_MONGODB_URI the suite skips rather than fails, so CI without a
 * database stays green — but DO NOT ship the wallet until you have watched
 * these pass.
 */
const URI = process.env.TEST_MONGODB_URI;
const silent = { info: () => {}, warn: () => {}, error: () => {} };

describe.skipIf(!URI)("credit ledger, against a real MongoDB", () => {
  const WALLET = "wallet-under-test";
  let ledger: MongoLedgerStore;

  beforeAll(async () => {
    await mongoose.connect(URI!);

    const info = (await mongoose.connection.db!.admin().command({ hello: 1 })) as {
      setName?: string;
    };
    if (!info.setName) {
      throw new Error(
        "TEST_MONGODB_URI points at a standalone mongod. Transactions need a replica set — " +
          "see docker-compose.yml.",
      );
    }

    await mongoose.syncIndexes();
    ledger = new MongoLedgerStore(silent);
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await Promise.all([
      WalletModel.deleteMany({}),
      LedgerEntryModel.deleteMany({}),
      AccessPassModel.deleteMany({}),
    ]);

    await ledger.openWallet(WALLET);
    await ledger.append({
      walletId: WALLET,
      type: "top_up",
      amount: 1000,
      reason: "test seed",
      idempotencyKey: `seed-${Date.now()}-${Math.random()}`,
    });
  });

  it("lets exactly ten of a hundred simultaneous spends through", async () => {
    // 1000 credits, 100 credits each: ten can succeed, ninety must not.
    const attempts = Array.from({ length: 100 }, (_, index) =>
      ledger.append({
        walletId: WALLET,
        type: "spend",
        amount: 100,
        reason: "concurrent spend",
        idempotencyKey: `spend-${index}`,
      }),
    );

    const results = await Promise.all(attempts);
    const succeeded = results.filter((r) => r.ok).length;

    expect(succeeded).toBe(10);
    expect(await ledger.getBalance(WALLET)).toBe(0);

    const { cached, computed } = await ledger.reconcile(WALLET);
    expect(cached).toBe(computed);
  });

  it("never lets the balance go negative under load", async () => {
    await Promise.all(
      Array.from({ length: 50 }, (_, index) =>
        ledger.append({
          walletId: WALLET,
          type: "spend",
          amount: 300,
          reason: "overdraw attempt",
          idempotencyKey: `overdraw-${index}`,
        }),
      ),
    );

    expect(await ledger.getBalance(WALLET)).toBeGreaterThanOrEqual(0);
  });

  it("moves credits once when the same idempotency key arrives many times", async () => {
    const command = {
      walletId: WALLET,
      type: "spend" as const,
      amount: 250,
      reason: "double tap",
      idempotencyKey: "same-key-every-time",
    };

    const results = await Promise.all(Array.from({ length: 20 }, () => ledger.append(command)));

    expect(results.every((r) => r.ok)).toBe(true);

    // Every caller gets the SAME entry back, and the wallet moved once.
    const ids = new Set(results.map((r) => (r.ok ? r.value.id : "failed")));
    expect(ids.size).toBe(1);
    expect(await ledger.getBalance(WALLET)).toBe(750);
    expect(await LedgerEntryModel.countDocuments({ idempotencyKey: command.idempotencyKey })).toBe(1);
  });

  it("keeps the cached balance equal to the ledger after a mixed run", async () => {
    await ledger.append({ walletId: WALLET, type: "spend", amount: 400, reason: "a", idempotencyKey: "m1" });
    await ledger.append({ walletId: WALLET, type: "refund", amount: 400, reason: "b", idempotencyKey: "m2" });
    await ledger.append({ walletId: WALLET, type: "spend", amount: 125, reason: "c", idempotencyKey: "m3" });
    await ledger.append({ walletId: WALLET, type: "top_up", amount: 75, reason: "d", idempotencyKey: "m4" });

    const { cached, computed } = await ledger.reconcile(WALLET);

    expect(cached).toBe(950);
    expect(computed).toBe(cached);
  });

  it("refuses a spend against a wallet that does not exist", async () => {
    const result = await ledger.append({
      walletId: "no-such-wallet",
      type: "spend",
      amount: 10,
      reason: "ghost",
      idempotencyKey: "ghost-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_found");
  });
});

describe.skipIf(!URI)("door scanning, against a real MongoDB", () => {
  let passes: MongoPassRepository;

  beforeAll(async () => {
    if (mongoose.connection.readyState === 0) await mongoose.connect(URI!);
    passes = new MongoPassRepository();
  });

  beforeEach(async () => {
    await AccessPassModel.deleteMany({});
  });

  async function singleEntryPass() {
    return passes.create({
      userId: new mongoose.Types.ObjectId().toString(),
      venueId: new mongoose.Types.ObjectId().toString(),
      accessPlanId: new mongoose.Types.ObjectId().toString(),
      creditsPaid: 100,
      validFrom: new Date(Date.now() - 60_000),
      validUntil: new Date(Date.now() + 3_600_000),
      maxEntries: 1,
      reEntryAllowed: false,
    });
  }

  it("admits exactly one of two scanners racing for the last entry", async () => {
    const pass = await singleEntryPass();
    const operator = new mongoose.Types.ObjectId().toString();

    const [first, second] = await Promise.all([
      passes.tryConsumeEntry({ passId: pass.id, scanNonce: "door-a", scannedByUserId: operator, at: new Date() }),
      passes.tryConsumeEntry({ passId: pass.id, scanNonce: "door-b", scannedByUserId: operator, at: new Date() }),
    ]);

    const admitted = [first, second].filter((o) => o.status === "admitted");
    expect(admitted).toHaveLength(1);

    const after = await passes.byId(pass.id);
    expect(after?.entriesUsed).toBe(1);
  });

  it("treats a replayed scan as idempotent rather than a second entry", async () => {
    const pass = await singleEntryPass();
    const operator = new mongoose.Types.ObjectId().toString();
    const nonce = "same-physical-scan";

    const first = await passes.tryConsumeEntry({ passId: pass.id, scanNonce: nonce, scannedByUserId: operator, at: new Date() });
    const second = await passes.tryConsumeEntry({ passId: pass.id, scanNonce: nonce, scannedByUserId: operator, at: new Date() });

    expect(first.status).toBe("admitted");
    expect(second.status).toBe("replay");

    const after = await passes.byId(pass.id);
    expect(after?.entriesUsed).toBe(1);
  });

  it("rejects a pass whose window has closed", async () => {
    const pass = await passes.create({
      userId: new mongoose.Types.ObjectId().toString(),
      venueId: new mongoose.Types.ObjectId().toString(),
      accessPlanId: new mongoose.Types.ObjectId().toString(),
      creditsPaid: 100,
      validFrom: new Date(Date.now() - 7_200_000),
      validUntil: new Date(Date.now() - 3_600_000),
      maxEntries: 1,
      reEntryAllowed: false,
    });

    const outcome = await passes.tryConsumeEntry({
      passId: pass.id,
      scanNonce: "late",
      scannedByUserId: new mongoose.Types.ObjectId().toString(),
      at: new Date(),
    });

    expect(outcome.status).toBe("rejected");
    if (outcome.status === "rejected") expect(outcome.reason).toBe("expired");
  });
});

// Keeps the runner happy when no database is configured.
describe("suite wiring", () => {
  it("skips the database tests unless TEST_MONGODB_URI is set", () => {
    expect(URI === undefined || typeof URI === "string").toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import {
  AccessService,
  createRegistry,
  ok,
  type AccessPass,
  type PassClaims,
  type PassTokenService,
  type PluginModule,
  type Result,
  type User,
  type Venue,
} from "../src/index.js";
import { FixedClock, InMemoryLedgerStore, InMemoryPassRepository, silentLogger } from "./fakes.js";

const NOW = new Date("2026-11-01T10:00:00Z");
const WALLET = "wallet-1";

const user: User = {
  id: "user-1",
  email: "a@b.com",
  displayName: "A",
  role: "end_user",
  walletId: WALLET,
  phoneE164: null,
  emailVerified: true,
  phoneVerified: false,
  googleSubjectId: null,
  createdAt: NOW,
};

const venue: Venue = {
  id: "venue-1",
  name: "Test Gym",
  typeKey: "testtype",
  operatorUserId: "operator-1",
  city: "Chennai",
  addressLine: null,
  isActive: true,
  createdAt: NOW,
  plans: [
    { id: "plan-1", venueId: "venue-1", name: "Day pass", cost: 60, config: {}, isActive: true },
  ],
};

/** A minimal plugin, so these tests exercise the service rather than a real policy. */
const testPlugin: PluginModule = {
  key: "testtype",
  create: () => ({
    key: "testtype",
    displayName: "Test type",
    planConfigSchema: {},
    accessPolicy: {
      canIssue: async () => ok(true as const),
      issue: async (request) => ({
        validFrom: request.requestedFor,
        validUntil: new Date(request.requestedFor.getTime() + 86_400_000),
        maxEntries: 2,
        reEntryAllowed: true,
      }),
      redeem: async (pass) =>
        ok({
          message: "Welcome in.",
          entriesRemaining: pass.maxEntries - pass.entriesUsed,
          validUntil: pass.validUntil,
        }),
    },
    pricingPolicy: { quote: async (request) => request.plan.cost },
  }),
};

class StubTokenService implements PassTokenService {
  constructor(private readonly nonce = "nonce-1") {}

  issue(pass: AccessPass): string {
    return `${pass.id}|${pass.userId}|${this.nonce}`;
  }

  validate(token: string): Result<PassClaims> {
    const [passId, userId, scanNonce] = token.split("|");
    if (!passId || !userId || !scanNonce) {
      return { ok: false, error: { code: "invalid_pass_token", message: "bad token" } };
    }
    return ok({ passId, userId, scanNonce, expiresAt: new Date(NOW.getTime() + 30_000) });
  }
}

async function build(options: { balance?: number; nonce?: string } = {}) {
  const clock = new FixedClock(NOW);
  const ledger = new InMemoryLedgerStore();
  const passes = new InMemoryPassRepository();

  await ledger.openWallet(WALLET);
  if (options.balance) {
    await ledger.append({
      walletId: WALLET,
      type: "top_up",
      amount: options.balance,
      reason: "seed",
      idempotencyKey: `seed-${options.balance}`,
    });
  }

  const registry = createRegistry([testPlugin], ["testtype"], { passes, clock, settings: {} });

  const access = new AccessService({
    registry,
    venues: {
      byId: async (id) => (id === venue.id ? venue : null),
      planById: async (id) => venue.plans.find((p) => p.id === id) ?? null,
      list: async () => [venue],
      create: async () => venue,
      addPlan: async () => venue.plans[0]!,
    },
    passes,
    users: {
      byId: async (id) => (id === user.id ? user : null),
      byEmail: async () => null,
      byGoogleSubject: async () => null,
      credentialsByEmail: async () => null,
      create: async () => user,
      update: async () => user,
    },
    ledger,
    tokens: new StubTokenService(options.nonce),
    clock,
    logger: silentLogger,
  });

  return { access, ledger, passes, clock };
}

const purchase = (idempotencyKey: string) => ({
  userId: user.id,
  venueId: venue.id,
  accessPlanId: "plan-1",
  requestedFor: NOW,
  options: {},
  idempotencyKey,
});

describe("buying a pass", () => {
  it("debits the wallet and issues the pass", async () => {
    const { access, ledger } = await build({ balance: 100 });

    const result = await access.purchase(purchase("buy-1"));

    expect(result.ok).toBe(true);
    expect(await ledger.getBalance(WALLET)).toBe(40);
  });

  it("refuses when the wallet is short, and takes nothing", async () => {
    const { access, ledger } = await build({ balance: 10 });

    const result = await access.purchase(purchase("buy-1"));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("insufficient_credits");
    expect(await ledger.getBalance(WALLET)).toBe(10);
  });

  it("charges once when the same request arrives twice", async () => {
    const { access, ledger } = await build({ balance: 100 });

    // The second call is the retry a flaky connection produces.
    await access.purchase(purchase("same-key"));
    await access.purchase(purchase("same-key"));

    expect(await ledger.getBalance(WALLET)).toBe(40);
  });
});

describe("redeeming at the door", () => {
  it("admits the holder and consumes an entry", async () => {
    const { access, passes } = await build({ balance: 100 });
    const bought = await access.purchase(purchase("buy-1"));
    if (!bought.ok) throw new Error("setup failed");

    const token = await access.generateToken(user.id, bought.value.id);
    if (!token.ok) throw new Error("token failed");

    const result = await access.redeem(token.value.token, venue.operatorUserId);

    expect(result.ok).toBe(true);
    const after = await passes.byId(bought.value.id);
    expect(after?.entriesUsed).toBe(1);
  });

  it("does not consume a second entry when the same scan is replayed", async () => {
    const { access, passes } = await build({ balance: 100, nonce: "fixed-nonce" });
    const bought = await access.purchase(purchase("buy-1"));
    if (!bought.ok) throw new Error("setup failed");

    const token = await access.generateToken(user.id, bought.value.id);
    if (!token.ok) throw new Error("token failed");

    // Same token twice: the network retried, the turnstile did not.
    await access.redeem(token.value.token, venue.operatorUserId);
    const second = await access.redeem(token.value.token, venue.operatorUserId);

    expect(second.ok).toBe(true);
    const after = await passes.byId(bought.value.id);
    expect(after?.entriesUsed).toBe(1);
  });

  it("refuses an operator from another venue", async () => {
    const { access } = await build({ balance: 100 });
    const bought = await access.purchase(purchase("buy-1"));
    if (!bought.ok) throw new Error("setup failed");

    const token = await access.generateToken(user.id, bought.value.id);
    if (!token.ok) throw new Error("token failed");

    const result = await access.redeem(token.value.token, "someone-else");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("forbidden");
  });

  it("refuses a pass that has expired", async () => {
    const { access, clock } = await build({ balance: 100 });
    const bought = await access.purchase(purchase("buy-1"));
    if (!bought.ok) throw new Error("setup failed");

    const token = await access.generateToken(user.id, bought.value.id);
    if (!token.ok) throw new Error("token failed");

    clock.set(new Date(NOW.getTime() + 2 * 86_400_000));
    const result = await access.redeem(token.value.token, venue.operatorUserId);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("pass_expired");
  });

  it("will not hand a pass token to a different user", async () => {
    const { access } = await build({ balance: 100 });
    const bought = await access.purchase(purchase("buy-1"));
    if (!bought.ok) throw new Error("setup failed");

    const result = await access.generateToken("someone-else", bought.value.id);

    expect(result.ok).toBe(false);
  });
});

describe("the plugin registry", () => {
  it("refuses to start when a configured venue type has no module", async () => {
    const passes = new InMemoryPassRepository();

    expect(() =>
      createRegistry([testPlugin], ["testtype", "spaceport"], {
        passes,
        clock: new FixedClock(NOW),
        settings: {},
      }),
    ).toThrow(/spaceport/);
  });

  it("loads only the venue types configuration asked for", () => {
    const passes = new InMemoryPassRepository();
    const registry = createRegistry([testPlugin], [], {
      passes,
      clock: new FixedClock(NOW),
      settings: {},
    });

    expect(registry.all()).toHaveLength(0);
    expect(registry.get("testtype")).toBeNull();
  });
});

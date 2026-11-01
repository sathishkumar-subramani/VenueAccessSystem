import { describe, expect, it } from "vitest";
import { WalletService, walletIdFromReceipt, type PaymentEvent } from "../src/index.js";
import { FixedClock, InMemoryLedgerStore, silentLogger } from "./fakes.js";

const WALLET = "wallet-1";
const NOW = new Date("2026-11-01T10:00:00Z");

function build() {
  const ledger = new InMemoryLedgerStore();

  const users = {
    byId: async (id: string) =>
      id === "user-1"
        ? {
            id: "user-1",
            email: "a@b.com",
            displayName: "A",
            role: "end_user" as const,
            walletId: WALLET,
            phoneE164: null,
            emailVerified: true,
            phoneVerified: false,
            googleSubjectId: null,
            createdAt: NOW,
          }
        : null,
    byEmail: async () => null,
    byGoogleSubject: async () => null,
    credentialsByEmail: async () => null,
    create: async () => {
      throw new Error("not used");
    },
    update: async () => null,
  };

  const payments = {
    createOrder: async () => ({ ok: true as const, value: { providerOrderId: "order_1", amount: { paise: 10_000, currency: "INR" as const }, publicKey: "key" } }),
    parseWebhook: () => {
      throw new Error("not used");
    },
  };

  const wallet = new WalletService({
    ledger,
    users,
    payments,
    clock: new FixedClock(NOW),
    logger: silentLogger,
  });

  return { wallet, ledger };
}

const captured = (paymentId: string, paise: number, receiptId: string): PaymentEvent => ({
  kind: "captured",
  providerOrderId: "order_1",
  providerPaymentId: paymentId,
  amount: { paise, currency: "INR" },
  receiptId,
});

describe("wallet top-ups", () => {
  it("credits the wallet once a payment is captured", async () => {
    const { wallet, ledger } = build();
    await ledger.openWallet(WALLET);

    const result = await wallet.confirmTopUp(captured("pay_1", 50_000, `topup_${WALLET}_1`));

    expect(result.ok).toBe(true);
    expect(await ledger.getBalance(WALLET)).toBe(500);
  });

  it("does not credit twice when the provider retries the same payment", async () => {
    const { wallet, ledger } = build();
    await ledger.openWallet(WALLET);

    const event = captured("pay_1", 50_000, `topup_${WALLET}_1`);
    await wallet.confirmTopUp(event);
    await wallet.confirmTopUp(event);
    await wallet.confirmTopUp(event);

    // Three deliveries, one credit. The idempotency key is the payment id.
    expect(await ledger.getBalance(WALLET)).toBe(500);
    expect(ledger.allEntries()).toHaveLength(1);
  });

  it("ignores a failed payment", async () => {
    const { wallet, ledger } = build();
    await ledger.openWallet(WALLET);

    await wallet.confirmTopUp({ ...captured("pay_2", 50_000, `topup_${WALLET}_1`), kind: "failed" });

    expect(await ledger.getBalance(WALLET)).toBe(0);
  });

  it("refuses a top-up whose receipt it cannot read", async () => {
    const { wallet, ledger } = build();
    await ledger.openWallet(WALLET);

    const result = await wallet.confirmTopUp(captured("pay_3", 50_000, "garbage"));

    expect(result.ok).toBe(false);
    expect(await ledger.getBalance(WALLET)).toBe(0);
  });

  it("reads the wallet id back out of a receipt it minted", async () => {
    const { wallet } = build();
    const intent = await wallet.startTopUp("user-1", 100);

    expect(intent.ok).toBe(true);
    expect(walletIdFromReceipt(`topup_${WALLET}_12345`)).toBe(WALLET);
  });

  it("rejects a nonsense credit amount", async () => {
    const { wallet } = build();

    expect((await wallet.startTopUp("user-1", 0)).ok).toBe(false);
    expect((await wallet.startTopUp("user-1", -5)).ok).toBe(false);
    expect((await wallet.startTopUp("user-1", 1.5)).ok).toBe(false);
  });
});

describe("ledger invariants", () => {
  it("never lets a debit overdraw the wallet", async () => {
    const ledger = new InMemoryLedgerStore();
    await ledger.openWallet(WALLET);

    await ledger.append({
      walletId: WALLET,
      type: "top_up",
      amount: 100,
      reason: "seed",
      idempotencyKey: "seed-1",
    });

    const tooMuch = await ledger.append({
      walletId: WALLET,
      type: "spend",
      amount: 150,
      reason: "pass",
      idempotencyKey: "spend-1",
    });

    expect(tooMuch.ok).toBe(false);
    expect(await ledger.getBalance(WALLET)).toBe(100);
  });

  it("keeps the cached balance equal to the sum of the entries", async () => {
    const ledger = new InMemoryLedgerStore();
    await ledger.openWallet(WALLET);

    await ledger.append({ walletId: WALLET, type: "top_up", amount: 500, reason: "a", idempotencyKey: "k1" });
    await ledger.append({ walletId: WALLET, type: "spend", amount: 120, reason: "b", idempotencyKey: "k2" });
    await ledger.append({ walletId: WALLET, type: "refund", amount: 120, reason: "c", idempotencyKey: "k3" });
    await ledger.append({ walletId: WALLET, type: "spend", amount: 60, reason: "d", idempotencyKey: "k4" });

    const { cached, computed } = await ledger.reconcile(WALLET);

    expect(cached).toBe(440);
    expect(computed).toBe(cached);
  });
});

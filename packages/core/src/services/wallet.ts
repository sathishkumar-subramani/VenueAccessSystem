import { PAISE_PER_CREDIT, paiseToCredits, type Credits } from "../domain/credits.js";
import type { LedgerEntry } from "../domain/entities.js";
import { errors, fail, failWith, ok, type Result } from "../domain/result.js";
import type { Clock, Logger, PaymentEvent, PaymentGateway, PaymentIntent } from "../ports/providers.js";
import type { LedgerStore, Paging, UserRepository } from "../ports/repositories.js";

export interface WalletDeps {
  ledger: LedgerStore;
  users: UserRepository;
  payments: PaymentGateway;
  clock: Clock;
  logger: Logger;
}

export class WalletService {
  constructor(private readonly deps: WalletDeps) {}

  async balance(userId: string): Promise<Result<{ credits: Credits }>> {
    const user = await this.deps.users.byId(userId);
    if (!user) return failWith(errors.notFound("User"));
    return ok({ credits: await this.deps.ledger.getBalance(user.walletId) });
  }

  async history(userId: string, paging: Paging): Promise<Result<LedgerEntry[]>> {
    const user = await this.deps.users.byId(userId);
    if (!user) return failWith(errors.notFound("User"));
    return ok(await this.deps.ledger.history(user.walletId, paging));
  }

  /** Step 1 of a top-up: create the provider order. No credits are minted here. */
  async startTopUp(userId: string, credits: number): Promise<Result<PaymentIntent>> {
    if (!Number.isSafeInteger(credits) || credits <= 0) {
      return failWith(errors.validation("Choose a whole number of credits above zero."));
    }

    const user = await this.deps.users.byId(userId);
    if (!user) return failWith(errors.notFound("User"));

    // The wallet id travels in the receipt so the webhook knows where the money goes.
    const receiptId = `topup_${user.walletId}_${this.deps.clock.now().getTime()}`;
    return this.deps.payments.createOrder(
      { paise: credits * PAISE_PER_CREDIT, currency: "INR" },
      receiptId,
    );
  }

  /**
   * Step 2: called ONLY from the signature-verified webhook. Idempotent on the
   * provider's payment id, so provider retries cannot credit the wallet twice.
   */
  async confirmTopUp(event: PaymentEvent): Promise<Result<true>> {
    if (event.kind !== "captured") {
      this.deps.logger.info("Ignoring payment event", {
        kind: event.kind,
        orderId: event.providerOrderId,
      });
      return ok(true);
    }

    const walletId = walletIdFromReceipt(event.receiptId);
    if (!walletId) {
      this.deps.logger.error("Unrecognised receipt on a captured payment", {
        receiptId: event.receiptId,
        paymentId: event.providerPaymentId,
      });
      return fail("validation", "Unrecognised receipt reference.");
    }

    const result = await this.deps.ledger.append({
      walletId,
      type: "top_up",
      amount: paiseToCredits(event.amount.paise),
      reason: "Credit top-up",
      idempotencyKey: `payment:${event.providerPaymentId}`,
      referenceId: event.providerPaymentId,
    });

    return result.ok ? ok(true) : failWith(result.error);
  }
}

export function walletIdFromReceipt(receiptId: string): string | null {
  const parts = receiptId.split("_");
  return parts.length >= 3 && parts[1] ? parts[1] : null;
}

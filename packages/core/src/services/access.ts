import type { Credits } from "../domain/credits.js";
import { entriesRemaining, type AccessPass } from "../domain/entities.js";
import { errors, fail, failWith, ok, type Result } from "../domain/result.js";
import type { Clock, Logger, PassTokenService } from "../ports/providers.js";
import type { RejectionReason } from "../ports/repositories.js";
import type {
  LedgerStore,
  PassRepository,
  UserRepository,
  VenueRepository,
} from "../ports/repositories.js";
import type { VenueTypeRegistry } from "../registry.js";

const TOKEN_LIFETIME_MS = 30_000;

export interface PurchaseCommand {
  userId: string;
  venueId: string;
  accessPlanId: string;
  requestedFor: Date;
  options: Record<string, string>;
  idempotencyKey: string;
}

export interface AccessDeps {
  registry: VenueTypeRegistry;
  venues: VenueRepository;
  passes: PassRepository;
  users: UserRepository;
  ledger: LedgerStore;
  tokens: PassTokenService;
  clock: Clock;
  logger: Logger;
}

export class AccessService {
  constructor(private readonly deps: AccessDeps) {}

  async purchase(command: PurchaseCommand): Promise<Result<AccessPass>> {
    const user = await this.deps.users.byId(command.userId);
    if (!user) return failWith(errors.notFound("User"));

    const venue = await this.deps.venues.byId(command.venueId);
    if (!venue || !venue.isActive) return failWith(errors.notFound("Venue"));

    const plan = await this.deps.venues.planById(command.accessPlanId);
    if (!plan || plan.venueId !== venue.id || !plan.isActive) {
      return failWith(errors.notFound("Access plan"));
    }

    // The core does not know what a gym or an expo is. The plugin does.
    const plugin = this.deps.registry.getRequired(venue.typeKey);
    const request = {
      userId: user.id,
      venue,
      plan,
      requestedFor: command.requestedFor,
      options: command.options,
    };

    const eligible = await plugin.accessPolicy.canIssue(request);
    if (!eligible.ok) return failWith(eligible.error);

    const price: Credits = await plugin.pricingPolicy.quote(request);

    // Debit first. If issuing then fails, the money comes back as a NEW
    // compensating entry — the original debit is never edited away.
    const debit = await this.deps.ledger.append({
      walletId: user.walletId,
      type: "spend",
      amount: price,
      reason: `Pass at ${venue.name}`,
      idempotencyKey: `pass:${command.idempotencyKey}`,
      referenceId: venue.id,
    });
    if (!debit.ok) return failWith(debit.error);

    try {
      const grant = await plugin.accessPolicy.issue(request);

      const pass = await this.deps.passes.create({
        userId: user.id,
        venueId: venue.id,
        accessPlanId: plan.id,
        creditsPaid: price,
        validFrom: grant.validFrom,
        validUntil: grant.validUntil,
        maxEntries: grant.maxEntries,
        reEntryAllowed: grant.reEntryAllowed,
      });

      return ok(pass);
    } catch (cause) {
      this.deps.logger.error("Pass issue failed after debit; refunding", {
        walletId: user.walletId,
        idempotencyKey: command.idempotencyKey,
        cause: String(cause),
      });

      await this.deps.ledger.append({
        walletId: user.walletId,
        type: "refund",
        amount: price,
        reason: "Refund: pass could not be issued",
        idempotencyKey: `refund:${command.idempotencyKey}`,
        referenceId: venue.id,
      });

      return fail("unexpected", "The pass could not be issued. Your credits were returned.");
    }
  }

  /** Short-lived token for the QR on the user's screen. Refetched while it is open. */
  async generateToken(userId: string, passId: string): Promise<Result<{ token: string; expiresInMs: number }>> {
    const pass = await this.deps.passes.byId(passId);
    if (!pass) return failWith(errors.notFound("Pass"));
    if (pass.userId !== userId) return failWith(errors.forbidden("This pass belongs to someone else."));

    return ok({
      token: this.deps.tokens.issue(pass, TOKEN_LIFETIME_MS),
      expiresInMs: TOKEN_LIFETIME_MS,
    });
  }

  async redeem(
    token: string,
    operatorUserId: string,
  ): Promise<Result<{ admitted: boolean; message: string; entriesRemaining: number }>> {
    const claims = this.deps.tokens.validate(token);
    if (!claims.ok) return failWith(claims.error);

    const existing = await this.deps.passes.byId(claims.value.passId);
    if (!existing) return failWith(errors.notFound("Pass"));

    const venue = await this.deps.venues.byId(existing.venueId);
    if (!venue) return failWith(errors.notFound("Venue"));
    if (venue.operatorUserId !== operatorUserId) {
      return failWith(errors.forbidden("You cannot scan passes for this venue."));
    }

    // One atomic operation decides it. Two scanners cannot both win the last entry.
    const outcome = await this.deps.passes.tryConsumeEntry({
      passId: existing.id,
      scanNonce: claims.value.scanNonce,
      scannedByUserId: operatorUserId,
      at: this.deps.clock.now(),
    });

    if (outcome.status === "rejected") {
      return failWith(rejectionToError(outcome.reason));
    }

    const pass = outcome.pass;
    const plugin = this.deps.registry.getRequired(venue.typeKey);

    const described = await plugin.accessPolicy.redeem(pass, {
      scannedByUserId: operatorUserId,
      scanNonce: claims.value.scanNonce,
      at: this.deps.clock.now(),
    });

    if (!described.ok) return failWith(described.error);

    return ok({
      admitted: true,
      message:
        outcome.status === "replay"
          ? `${described.value.message} (already scanned)`
          : described.value.message,
      entriesRemaining: entriesRemaining(pass),
    });
  }

  async listForUser(userId: string): Promise<AccessPass[]> {
    return this.deps.passes.listForUser(userId);
  }
}

function rejectionToError(reason: RejectionReason) {
  switch (reason) {
    case "not_found":
      return errors.notFound("Pass");
    case "expired":
      return { code: "pass_expired" as const, message: "This pass has expired." };
    case "not_yet_valid":
      return { code: "pass_not_yet_valid" as const, message: "This pass is not valid yet." };
    case "exhausted":
      return { code: "no_entries_remaining" as const, message: "This pass has no entries left." };
    case "re_entry_not_allowed":
      return { code: "re_entry_not_allowed" as const, message: "Re-entry is not allowed on this pass." };
    case "not_active":
      return { code: "pass_not_active" as const, message: "This pass is no longer active." };
  }
}

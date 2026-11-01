import type {
  AccessPass,
  Clock,
  ConsumeOutcome,
  Credits,
  IdGenerator,
  LedgerCommand,
  LedgerEntry,
  LedgerStore,
  Logger,
  Paging,
  PassRepository,
  Result,
} from "../src/index.js";
import { errors, failWith, isDebit, ok } from "../src/index.js";

export class FixedClock implements Clock {
  constructor(private current: Date) {}
  now(): Date {
    return this.current;
  }
  set(next: Date): void {
    this.current = next;
  }
}

export class SequentialIds implements IdGenerator {
  private n = 0;
  uuid(): string {
    this.n += 1;
    return `id-${this.n}`;
  }
  numericCode(digits: number): string {
    return "1".repeat(digits);
  }
}

export const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/**
 * Single-threaded JavaScript, so this fake cannot reproduce a real race. It
 * enforces the same CONTRACT the Mongo implementation must honour: no overdraw,
 * and one entry per idempotency key. The concurrency proof needs a real
 * database — see the integration test described in the README.
 */
export class InMemoryLedgerStore implements LedgerStore {
  private balances = new Map<string, number>();
  private entries: LedgerEntry[] = [];

  async openWallet(walletId: string): Promise<void> {
    if (!this.balances.has(walletId)) this.balances.set(walletId, 0);
  }

  async getBalance(walletId: string): Promise<Credits> {
    return this.balances.get(walletId) ?? 0;
  }

  async append(command: LedgerCommand): Promise<Result<LedgerEntry>> {
    const replay = this.entries.find((e) => e.idempotencyKey === command.idempotencyKey);
    if (replay) return ok(replay);

    if (!this.balances.has(command.walletId)) return failWith(errors.notFound("Wallet"));

    const current = this.balances.get(command.walletId) ?? 0;
    const debit = isDebit(command.type);

    if (debit && current < command.amount) return failWith(errors.insufficientCredits);

    this.balances.set(command.walletId, debit ? current - command.amount : current + command.amount);

    const entry: LedgerEntry = {
      id: `entry-${this.entries.length + 1}`,
      walletId: command.walletId,
      type: command.type,
      amount: command.amount,
      reason: command.reason,
      referenceId: command.referenceId ?? null,
      idempotencyKey: command.idempotencyKey,
      occurredAt: new Date(),
    };

    this.entries.push(entry);
    return ok(entry);
  }

  async history(walletId: string, paging: Paging): Promise<LedgerEntry[]> {
    return this.entries.filter((e) => e.walletId === walletId).slice(0, paging.size);
  }

  async reconcile(walletId: string): Promise<{ cached: number; computed: number }> {
    const computed = this.entries
      .filter((e) => e.walletId === walletId)
      .reduce((total, e) => total + (isDebit(e.type) ? -e.amount : e.amount), 0);

    return { cached: this.balances.get(walletId) ?? 0, computed };
  }

  allEntries(): LedgerEntry[] {
    return [...this.entries];
  }
}

export class InMemoryPassRepository implements PassRepository {
  private passes = new Map<string, AccessPass>();
  private sequence = 0;

  activeAtVenueOverride: number | null = null;
  userHasPassOverride = false;

  async byId(id: string): Promise<AccessPass | null> {
    return this.passes.get(id) ?? null;
  }

  async listForUser(userId: string): Promise<AccessPass[]> {
    return [...this.passes.values()].filter((p) => p.userId === userId);
  }

  async countActiveAtVenue(): Promise<number> {
    return this.activeAtVenueOverride ?? 0;
  }

  async userHasActivePass(): Promise<boolean> {
    return this.userHasPassOverride;
  }

  async create(
    input: Omit<AccessPass, "id" | "createdAt" | "checkIns" | "entriesUsed" | "state">,
  ): Promise<AccessPass> {
    this.sequence += 1;
    const pass: AccessPass = {
      ...input,
      id: `pass-${this.sequence}`,
      entriesUsed: 0,
      state: "active",
      checkIns: [],
      createdAt: new Date(),
    };

    this.passes.set(pass.id, pass);
    return pass;
  }

  async tryConsumeEntry(input: {
    passId: string;
    scanNonce: string;
    scannedByUserId: string;
    at: Date;
  }): Promise<ConsumeOutcome> {
    const pass = this.passes.get(input.passId);
    if (!pass) return { status: "rejected", pass: null, reason: "not_found" };

    if (pass.checkIns.some((c) => c.scanNonce === input.scanNonce)) {
      return { status: "replay", pass };
    }

    if (pass.state === "cancelled") return { status: "rejected", pass, reason: "not_active" };
    if (input.at < pass.validFrom) return { status: "rejected", pass, reason: "not_yet_valid" };
    if (input.at > pass.validUntil) return { status: "rejected", pass, reason: "expired" };
    if (pass.entriesUsed >= pass.maxEntries) return { status: "rejected", pass, reason: "exhausted" };
    if (!pass.reEntryAllowed && pass.entriesUsed > 0) {
      return { status: "rejected", pass, reason: "re_entry_not_allowed" };
    }

    pass.checkIns.push({
      scanNonce: input.scanNonce,
      scannedByUserId: input.scannedByUserId,
      occurredAt: input.at,
    });
    pass.entriesUsed += 1;
    if (pass.entriesUsed >= pass.maxEntries) pass.state = "exhausted";

    return { status: "admitted", pass };
  }
}

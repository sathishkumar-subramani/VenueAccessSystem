import type { Credits } from "../domain/credits.js";
import type { AccessPass, AccessPlan, Venue, VenueTypeKey } from "../domain/entities.js";
import type { Result } from "../domain/result.js";
import type { PassRepository } from "./repositories.js";
import type { Clock } from "./providers.js";

export interface AccessRequest {
  userId: string;
  venue: Venue;
  plan: AccessPlan;
  requestedFor: Date;
  /** Free-form, plugin-specific. e.g. coworking sends { blocks: "2" }. */
  options: Record<string, string>;
}

export interface PassGrant {
  validFrom: Date;
  validUntil: Date;
  maxEntries: number;
  reEntryAllowed: boolean;
}

export interface RedeemContext {
  scannedByUserId: string;
  scanNonce: string;
  at: Date;
}

export interface RedemptionOutcome {
  message: string;
  entriesRemaining: number;
  validUntil: Date;
}

export interface AccessPolicy {
  /** Capacity, date windows, duplicate-pass rules — anything venue-specific. */
  canIssue(request: AccessRequest): Promise<Result<true>>;
  /** Turns the plan's opaque config into a concrete window and entry count. */
  issue(request: AccessRequest): Promise<PassGrant>;
  /** Runs at the scanner, after the pass's own window and entry count have passed. */
  redeem(pass: AccessPass, ctx: RedeemContext): Promise<Result<RedemptionOutcome>>;
}

export interface PricingPolicy {
  quote(request: AccessRequest): Promise<Credits>;
}

/**
 * One venue type. Plugged in from configuration; the core resolves it by key
 * through VenueTypeRegistry and never switches on the key itself.
 */
export interface VenueTypePlugin {
  readonly key: VenueTypeKey;
  readonly displayName: string;
  /** JSON Schema the operator's plan-configuration form is rendered from. */
  readonly planConfigSchema: Record<string, unknown>;
  readonly accessPolicy: AccessPolicy;
  readonly pricingPolicy: PricingPolicy;
}

/** What a plugin is handed at startup. Ports only — never a database handle. */
export interface PluginContext {
  passes: PassRepository;
  clock: Clock;
  /** Values under `plugins.<key>` in configuration. */
  settings: Record<string, unknown>;
}

/** Every plugin package default-exports one of these. */
export interface PluginModule {
  readonly key: VenueTypeKey;
  create(context: PluginContext): VenueTypePlugin;
}

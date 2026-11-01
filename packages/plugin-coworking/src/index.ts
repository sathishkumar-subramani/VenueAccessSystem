import {
  ok,
  failWith,
  errors,
  entriesRemaining,
  type AccessPass,
  type AccessPolicy,
  type AccessRequest,
  type PassGrant,
  type PluginContext,
  type PluginModule,
  type PricingPolicy,
  type RedeemContext,
  type RedemptionOutcome,
  type Result,
  type VenueTypePlugin,
} from "@venue/core";

/**
 * Deliberately a different shape from the gym plugin: hour blocks instead of
 * day passes, a quantity that changes the price, re-entry on by default.
 *
 * This plugin exists to prove the ports hold. If a new venue type ever needs a
 * change inside @venue/core to work, the port is wrong — fix the port, do not
 * special-case the plugin.
 */

export const BLOCKS_OPTION = "blocks";
const MAX_BLOCKS = 6;

interface CoworkingConfig {
  blockMinutes: number;
  seatCapacity: number;
  maxEntries: number;
  openHour: number;
  closeHour: number;
  creditsPerExtraBlock: number;
}

function readConfig(raw: Record<string, unknown>): CoworkingConfig {
  const num = (key: string, fallback: number): number => {
    const value = raw[key];
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  };

  return {
    blockMinutes: Math.max(30, num("blockMinutes", 240)),
    seatCapacity: Math.max(1, num("seatCapacity", 50)),
    maxEntries: Math.max(1, num("maxEntries", 10)),
    openHour: num("openHour", 9),
    closeHour: num("closeHour", 21),
    creditsPerExtraBlock: Math.max(0, num("creditsPerExtraBlock", 0)),
  };
}

export function readBlocks(options: Record<string, string>): number {
  const parsed = Number.parseInt(options[BLOCKS_OPTION] ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, MAX_BLOCKS) : 1;
}

const schema = {
  type: "object",
  properties: {
    blockMinutes: { type: "integer", title: "Block length (minutes)", default: 240, minimum: 30 },
    seatCapacity: { type: "integer", title: "Seats", default: 50, minimum: 1 },
    maxEntries: { type: "integer", title: "Entries allowed", default: 10, minimum: 1 },
    openHour: { type: "integer", title: "Opens (hour)", default: 9, minimum: 0, maximum: 23 },
    closeHour: { type: "integer", title: "Closes (hour)", default: 21, minimum: 0, maximum: 23 },
    creditsPerExtraBlock: { type: "integer", title: "Credits per extra block", default: 0, minimum: 0 },
  },
} as const;

class CoworkingAccessPolicy implements AccessPolicy {
  constructor(private readonly ctx: PluginContext) {}

  async canIssue(request: AccessRequest): Promise<Result<true>> {
    const config = readConfig(request.plan.config);
    const now = this.ctx.clock.now();

    if (request.requestedFor.getTime() < now.getTime() - 5 * 60_000) {
      return failWith(errors.validation("Choose a start time in the future."));
    }

    const startHour = request.requestedFor.getHours();
    if (startHour < config.openHour || startHour >= config.closeHour) {
      return failWith(
        errors.validation(`This space is open from ${config.openHour}:00 to ${config.closeHour}:00.`),
      );
    }

    const booked = await this.ctx.passes.countActiveAtVenue(request.venue.id, request.requestedFor);
    if (booked >= config.seatCapacity) {
      return failWith(errors.conflict("No seats are left for that day."));
    }

    return ok(true);
  }

  async issue(request: AccessRequest): Promise<PassGrant> {
    const config = readConfig(request.plan.config);
    const blocks = readBlocks(request.options);
    const validFrom = request.requestedFor;

    let validUntil = new Date(validFrom.getTime() + config.blockMinutes * blocks * 60_000);

    // Never sell time past closing.
    const closing = new Date(validFrom);
    closing.setHours(config.closeHour, 0, 0, 0);
    if (validUntil > closing) validUntil = closing;

    return {
      validFrom,
      validUntil,
      maxEntries: config.maxEntries,
      reEntryAllowed: true, // people step out for lunch
    };
  }

  async redeem(pass: AccessPass, ctx: RedeemContext): Promise<Result<RedemptionOutcome>> {
    const minutesLeft = Math.max(
      Math.round((pass.validUntil.getTime() - ctx.at.getTime()) / 60_000),
      0,
    );

    return ok({
      message: `Checked in. Desk held for another ${minutesLeft} minutes.`,
      entriesRemaining: entriesRemaining(pass),
      validUntil: pass.validUntil,
    });
  }
}

class CoworkingPricingPolicy implements PricingPolicy {
  async quote(request: AccessRequest): Promise<number> {
    const config = readConfig(request.plan.config);
    const blocks = readBlocks(request.options);

    return request.plan.cost + Math.max(blocks - 1, 0) * config.creditsPerExtraBlock;
  }
}

const coworkingPlugin: PluginModule = {
  key: "coworking",
  create(context: PluginContext): VenueTypePlugin {
    return {
      key: "coworking",
      displayName: "Coworking space",
      planConfigSchema: schema as unknown as Record<string, unknown>,
      accessPolicy: new CoworkingAccessPolicy(context),
      pricingPolicy: new CoworkingPricingPolicy(),
    };
  },
};

export default coworkingPlugin;

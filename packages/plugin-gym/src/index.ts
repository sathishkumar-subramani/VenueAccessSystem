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

interface GymConfig {
  durationHours: number;
  maxEntries: number;
  reEntry: boolean;
  dailyCapacity: number;
  peakSurchargeCredits: number;
  peakStartHour: number;
  peakEndHour: number;
}

/** A malformed config row must never take the venue offline. Fall back, don't throw. */
function readConfig(raw: Record<string, unknown>): GymConfig {
  const num = (key: string, fallback: number): number => {
    const value = raw[key];
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  };

  return {
    durationHours: num("durationHours", 24),
    maxEntries: Math.max(1, num("maxEntries", 1)),
    reEntry: raw.reEntry === true,
    dailyCapacity: Math.max(1, num("dailyCapacity", 100)),
    peakSurchargeCredits: Math.max(0, num("peakSurchargeCredits", 0)),
    peakStartHour: num("peakStartHour", 17),
    peakEndHour: num("peakEndHour", 21),
  };
}

const schema = {
  type: "object",
  properties: {
    durationHours: { type: "integer", title: "Valid for (hours)", default: 24, minimum: 1 },
    maxEntries: { type: "integer", title: "Entries allowed", default: 1, minimum: 1 },
    reEntry: { type: "boolean", title: "Allow re-entry", default: false },
    dailyCapacity: { type: "integer", title: "Passes per day", default: 100, minimum: 1 },
    peakSurchargeCredits: { type: "integer", title: "Peak surcharge", default: 0, minimum: 0 },
    peakStartHour: { type: "integer", title: "Peak starts (hour)", default: 17, minimum: 0, maximum: 23 },
    peakEndHour: { type: "integer", title: "Peak ends (hour)", default: 21, minimum: 0, maximum: 23 },
  },
} as const;

class GymAccessPolicy implements AccessPolicy {
  constructor(private readonly ctx: PluginContext) {}

  async canIssue(request: AccessRequest): Promise<Result<true>> {
    const config = readConfig(request.plan.config);
    const now = this.ctx.clock.now();

    if (sameDayOrLater(request.requestedFor, now) === false) {
      return failWith(errors.validation("A gym pass cannot be bought for a past date."));
    }

    const issued = await this.ctx.passes.countActiveAtVenue(request.venue.id, request.requestedFor);
    if (issued >= config.dailyCapacity) {
      return failWith(errors.conflict("This gym is fully booked for that day."));
    }

    if (await this.ctx.passes.userHasActivePass(request.userId, request.venue.id, request.requestedFor)) {
      return failWith(errors.conflict("You already hold an active pass for this gym."));
    }

    return ok(true);
  }

  async issue(request: AccessRequest): Promise<PassGrant> {
    const config = readConfig(request.plan.config);
    const validFrom = request.requestedFor;

    return {
      validFrom,
      validUntil: new Date(validFrom.getTime() + config.durationHours * 3_600_000),
      maxEntries: config.maxEntries,
      reEntryAllowed: config.reEntry,
    };
  }

  async redeem(pass: AccessPass, _ctx: RedeemContext): Promise<Result<RedemptionOutcome>> {
    const left = entriesRemaining(pass);

    return ok({
      message: left > 0 ? `Welcome in. ${left} entry left.` : "Welcome in. That was the last entry.",
      entriesRemaining: left,
      validUntil: pass.validUntil,
    });
  }
}

class GymPricingPolicy implements PricingPolicy {
  async quote(request: AccessRequest): Promise<number> {
    const config = readConfig(request.plan.config);
    const hour = request.requestedFor.getHours();
    const isPeak = hour >= config.peakStartHour && hour < config.peakEndHour;

    return request.plan.cost + (isPeak ? config.peakSurchargeCredits : 0);
  }
}

function sameDayOrLater(requested: Date, now: Date): boolean {
  const day = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return day(requested) >= day(now);
}

const gymPlugin: PluginModule = {
  key: "gym",
  create(context: PluginContext): VenueTypePlugin {
    return {
      key: "gym",
      displayName: "Gym",
      planConfigSchema: schema as unknown as Record<string, unknown>,
      accessPolicy: new GymAccessPolicy(context),
      pricingPolicy: new GymPricingPolicy(),
    };
  },
};

export default gymPlugin;

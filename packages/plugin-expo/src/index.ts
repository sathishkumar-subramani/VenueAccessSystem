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
 * An exhibition runs on fixed dates set by the organiser, not on a rolling
 * window from the moment of purchase. A third shape again — which is the point.
 */

interface ExpoConfig {
  /** ISO dates, e.g. ["2026-12-04", "2026-12-05"]. Empty means any day. */
  eventDates: string[];
  doorsOpenHour: number;
  doorsCloseHour: number;
  maxEntries: number;
  reEntry: boolean;
  totalTickets: number;
  earlyBirdDiscountCredits: number;
  earlyBirdDaysBefore: number;
}

function readConfig(raw: Record<string, unknown>): ExpoConfig {
  const num = (key: string, fallback: number): number => {
    const value = raw[key];
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  };

  const dates = Array.isArray(raw.eventDates)
    ? raw.eventDates.filter((d): d is string => typeof d === "string" && ISO_DATE.test(d))
    : [];

  return {
    eventDates: dates,
    doorsOpenHour: num("doorsOpenHour", 10),
    doorsCloseHour: num("doorsCloseHour", 18),
    maxEntries: Math.max(1, num("maxEntries", 3)),
    reEntry: raw.reEntry !== false, // expos almost always allow stepping out
    totalTickets: Math.max(1, num("totalTickets", 500)),
    earlyBirdDiscountCredits: Math.max(0, num("earlyBirdDiscountCredits", 0)),
    earlyBirdDaysBefore: Math.max(0, num("earlyBirdDaysBefore", 7)),
  };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const toIsoDay = (date: Date): string => date.toISOString().slice(0, 10);

const schema = {
  type: "object",
  properties: {
    eventDates: {
      type: "array",
      title: "Event dates",
      items: { type: "string", format: "date" },
      default: [],
    },
    doorsOpenHour: { type: "integer", title: "Doors open (hour)", default: 10, minimum: 0, maximum: 23 },
    doorsCloseHour: { type: "integer", title: "Doors close (hour)", default: 18, minimum: 0, maximum: 23 },
    maxEntries: { type: "integer", title: "Entries allowed", default: 3, minimum: 1 },
    reEntry: { type: "boolean", title: "Allow re-entry", default: true },
    totalTickets: { type: "integer", title: "Tickets available", default: 500, minimum: 1 },
    earlyBirdDiscountCredits: { type: "integer", title: "Early-bird discount", default: 0, minimum: 0 },
    earlyBirdDaysBefore: { type: "integer", title: "Early-bird window (days before)", default: 7, minimum: 0 },
  },
} as const;

class ExpoAccessPolicy implements AccessPolicy {
  constructor(private readonly ctx: PluginContext) {}

  async canIssue(request: AccessRequest): Promise<Result<true>> {
    const config = readConfig(request.plan.config);
    const requestedDay = toIsoDay(request.requestedFor);

    if (config.eventDates.length > 0 && !config.eventDates.includes(requestedDay)) {
      return failWith(
        errors.validation(
          `This expo runs on ${config.eventDates.join(", ")}. Pick one of those dates.`,
        ),
      );
    }

    const sold = await this.ctx.passes.countActiveAtVenue(request.venue.id, request.requestedFor);
    if (sold >= config.totalTickets) {
      return failWith(errors.conflict("This expo is sold out for that day."));
    }

    return ok(true);
  }

  async issue(request: AccessRequest): Promise<PassGrant> {
    const config = readConfig(request.plan.config);

    // Valid for the whole event day, not from the moment of purchase.
    const validFrom = new Date(request.requestedFor);
    validFrom.setHours(config.doorsOpenHour, 0, 0, 0);

    const validUntil = new Date(request.requestedFor);
    validUntil.setHours(config.doorsCloseHour, 0, 0, 0);

    return {
      validFrom,
      validUntil,
      maxEntries: config.maxEntries,
      reEntryAllowed: config.reEntry,
    };
  }

  async redeem(pass: AccessPass, _ctx: RedeemContext): Promise<Result<RedemptionOutcome>> {
    const left = entriesRemaining(pass);

    return ok({
      message:
        pass.entriesUsed <= 1
          ? "Welcome to the expo. Enjoy the show."
          : `Welcome back. ${left} re-entry left.`,
      entriesRemaining: left,
      validUntil: pass.validUntil,
    });
  }
}

class ExpoPricingPolicy implements PricingPolicy {
  constructor(private readonly ctx: PluginContext) {}

  async quote(request: AccessRequest): Promise<number> {
    const config = readConfig(request.plan.config);
    if (config.earlyBirdDiscountCredits === 0) return request.plan.cost;

    const daysAhead =
      (request.requestedFor.getTime() - this.ctx.clock.now().getTime()) / 86_400_000;

    return daysAhead >= config.earlyBirdDaysBefore
      ? Math.max(0, request.plan.cost - config.earlyBirdDiscountCredits)
      : request.plan.cost;
  }
}

const expoPlugin: PluginModule = {
  key: "expo",
  create(context: PluginContext): VenueTypePlugin {
    return {
      key: "expo",
      displayName: "Expo / exhibition",
      planConfigSchema: schema as unknown as Record<string, unknown>,
      accessPolicy: new ExpoAccessPolicy(context),
      pricingPolicy: new ExpoPricingPolicy(context),
    };
  },
};

export default expoPlugin;

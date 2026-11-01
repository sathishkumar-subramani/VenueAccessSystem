import { describe, expect, it } from "vitest";
import type {
  AccessPass,
  AccessPlan,
  Clock,
  ConsumeOutcome,
  PassRepository,
  PluginContext,
  PluginModule,
  Venue,
} from "@venue/core";
import gymPlugin from "@venue/plugin-gym";
import coworkingPlugin from "@venue/plugin-coworking";
import expoPlugin from "@venue/plugin-expo";

/**
 * ONE suite, run against EVERY plugin.
 *
 * This is the real test of the plug-and-play claim. If a new venue type cannot
 * satisfy these without a change inside @venue/core, the port is wrong — fix
 * the port, do not special-case the plugin. Add new plugins to this list on the
 * day they are written.
 */
const PLUGINS: PluginModule[] = [gymPlugin, coworkingPlugin, expoPlugin];

const NOW = new Date("2026-11-01T10:00:00Z");

class StubClock implements Clock {
  now(): Date {
    return NOW;
  }
}

class StubPasses implements PassRepository {
  activeCount = 0;
  hasPass = false;

  async byId(): Promise<AccessPass | null> {
    return null;
  }
  async listForUser(): Promise<AccessPass[]> {
    return [];
  }
  async countActiveAtVenue(): Promise<number> {
    return this.activeCount;
  }
  async userHasActivePass(): Promise<boolean> {
    return this.hasPass;
  }
  async create(): Promise<AccessPass> {
    throw new Error("not used");
  }
  async tryConsumeEntry(): Promise<ConsumeOutcome> {
    throw new Error("not used");
  }
}

function context(passes = new StubPasses()): PluginContext {
  return { passes, clock: new StubClock(), settings: {} };
}

function makeRequest(typeKey: string, config: Record<string, unknown>, options: Record<string, string> = {}) {
  const plan: AccessPlan = {
    id: "plan-1",
    venueId: "venue-1",
    name: "Standard",
    cost: 100,
    config,
    isActive: true,
  };

  const venue: Venue = {
    id: "venue-1",
    name: "Test venue",
    typeKey,
    operatorUserId: "operator-1",
    city: "Chennai",
    addressLine: null,
    isActive: true,
    plans: [plan],
    createdAt: NOW,
  };

  // Two hours ahead: inside opening hours for every plugin's defaults.
  return { userId: "user-1", venue, plan, requestedFor: new Date(NOW.getTime() + 2 * 3_600_000), options };
}

const fakePass = (overrides: Partial<AccessPass> = {}): AccessPass => ({
  id: "pass-1",
  userId: "user-1",
  venueId: "venue-1",
  accessPlanId: "plan-1",
  creditsPaid: 100,
  validFrom: NOW,
  validUntil: new Date(NOW.getTime() + 86_400_000),
  maxEntries: 3,
  entriesUsed: 1,
  reEntryAllowed: true,
  state: "active",
  checkIns: [],
  createdAt: NOW,
  ...overrides,
});

describe.each(PLUGINS.map((module) => [module.key, module] as const))(
  "plugin contract: %s",
  (key, module) => {
    it("declares the key it was registered under", () => {
      expect(module.create(context()).key).toBe(key);
    });

    it("grants a window that ends after it starts", async () => {
      const plugin = module.create(context());
      const grant = await plugin.accessPolicy.issue(makeRequest(key, {}));

      expect(grant.validUntil.getTime()).toBeGreaterThan(grant.validFrom.getTime());
      expect(grant.maxEntries).toBeGreaterThan(0);
    });

    it("quotes a non-negative price", async () => {
      const plugin = module.create(context());
      const quote = await plugin.pricingPolicy.quote(makeRequest(key, {}));

      expect(quote).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(quote)).toBe(true);
    });

    it("survives a plan config full of nonsense", async () => {
      const plugin = module.create(context());
      const junk = { durationHours: "not a number", maxEntries: null, blockMinutes: [], eventDates: 7 };

      // A bad config row must never take a whole venue offline.
      await expect(plugin.accessPolicy.issue(makeRequest(key, junk))).resolves.toBeDefined();
      await expect(plugin.accessPolicy.quote?.(makeRequest(key, junk)) ?? Promise.resolve(0)).resolves.toBeDefined();
      await expect(plugin.pricingPolicy.quote(makeRequest(key, junk))).resolves.toBeGreaterThanOrEqual(0);
    });

    it("exposes a JSON-schema-shaped object for the operator form", () => {
      const plugin = module.create(context());
      expect(plugin.planConfigSchema).toHaveProperty("properties");
    });

    it("produces a message for the door staff on redemption", async () => {
      const plugin = module.create(context());
      const result = await plugin.accessPolicy.redeem(fakePass(), {
        scannedByUserId: "operator-1",
        scanNonce: "n1",
        at: NOW,
      });

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.message.length).toBeGreaterThan(0);
    });
  },
);

describe("plugins differ where they should", () => {
  it("gym blocks a second active pass for the same person", async () => {
    const passes = new StubPasses();
    passes.hasPass = true;

    const plugin = gymPlugin.create(context(passes));
    const result = await plugin.accessPolicy.canIssue(makeRequest("gym", {}));

    expect(result.ok).toBe(false);
  });

  it("gym adds the peak surcharge inside peak hours", async () => {
    const plugin = gymPlugin.create(context());
    const config = { peakStartHour: 0, peakEndHour: 23, peakSurchargeCredits: 25 };

    const peak = await plugin.pricingPolicy.quote(makeRequest("gym", config));
    const offPeak = await plugin.pricingPolicy.quote(
      makeRequest("gym", { ...config, peakStartHour: 23, peakEndHour: 23 }),
    );

    expect(peak - offPeak).toBe(25);
  });

  it("coworking charges per extra block", async () => {
    const plugin = coworkingPlugin.create(context());
    const config = { blockMinutes: 240, creditsPerExtraBlock: 30 };

    const one = await plugin.pricingPolicy.quote(makeRequest("coworking", config, { blocks: "1" }));
    const three = await plugin.pricingPolicy.quote(makeRequest("coworking", config, { blocks: "3" }));

    expect(three - one).toBe(60);
  });

  it("coworking refuses a booking outside opening hours", async () => {
    const plugin = coworkingPlugin.create(context());
    const request = makeRequest("coworking", { openHour: 9, closeHour: 18 });
    request.requestedFor = new Date("2026-11-02T22:00:00");

    const result = await plugin.accessPolicy.canIssue(request);
    expect(result.ok).toBe(false);
  });

  it("expo refuses a date the event does not run on", async () => {
    const plugin = expoPlugin.create(context());
    const result = await plugin.accessPolicy.canIssue(
      makeRequest("expo", { eventDates: ["2026-12-04", "2026-12-05"] }),
    );

    expect(result.ok).toBe(false);
  });

  it("expo discounts an early-bird booking", async () => {
    const plugin = expoPlugin.create(context());
    const config = { earlyBirdDiscountCredits: 40, earlyBirdDaysBefore: 7 };

    const soon = await plugin.pricingPolicy.quote(makeRequest("expo", config));

    const early = makeRequest("expo", config);
    early.requestedFor = new Date(NOW.getTime() + 30 * 86_400_000);
    const earlyQuote = await plugin.pricingPolicy.quote(early);

    expect(soon - earlyQuote).toBe(40);
  });
});

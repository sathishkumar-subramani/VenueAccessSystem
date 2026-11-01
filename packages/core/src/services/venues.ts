import { assertCredits } from "../domain/credits.js";
import type { AccessPlan, Venue } from "../domain/entities.js";
import { errors, failWith, ok, type Result } from "../domain/result.js";
import type { Clock } from "../ports/providers.js";
import type { Paging, VenueRepository } from "../ports/repositories.js";
import type { VenueTypeRegistry } from "../registry.js";

export interface VenueTypeInfo {
  key: string;
  displayName: string;
  planConfigSchema: Record<string, unknown>;
}

export interface VenueDeps {
  venues: VenueRepository;
  registry: VenueTypeRegistry;
  clock: Clock;
}

export class VenueService {
  constructor(private readonly deps: VenueDeps) {}

  /** Drives the venue-type dropdown. Always matches what configuration enabled. */
  availableTypes(): VenueTypeInfo[] {
    return this.deps.registry.all().map((plugin) => ({
      key: plugin.key,
      displayName: plugin.displayName,
      planConfigSchema: plugin.planConfigSchema,
    }));
  }

  async onboard(input: {
    name: string;
    typeKey: string;
    operatorUserId: string;
    city?: string | null;
    addressLine?: string | null;
  }): Promise<Result<Venue>> {
    if (!this.deps.registry.get(input.typeKey)) {
      return failWith(
        errors.validation(
          `"${input.typeKey}" is not an enabled venue type. ` +
            `Enabled: ${this.deps.registry.all().map((p) => p.key).join(", ")}.`,
        ),
      );
    }

    return ok(
      await this.deps.venues.create({
        name: input.name.trim(),
        typeKey: input.typeKey.toLowerCase(),
        operatorUserId: input.operatorUserId,
        city: input.city ?? null,
        addressLine: input.addressLine ?? null,
      }),
    );
  }

  async addPlan(
    venueId: string,
    callerUserId: string,
    input: { name: string; cost: number; config: Record<string, unknown> },
  ): Promise<Result<AccessPlan>> {
    const venue = await this.deps.venues.byId(venueId);
    if (!venue) return failWith(errors.notFound("Venue"));
    if (venue.operatorUserId !== callerUserId) {
      return failWith(errors.forbidden("You do not operate this venue."));
    }

    try {
      assertCredits(input.cost, "Plan cost");
    } catch {
      return failWith(errors.validation("Plan cost must be a whole number of credits."));
    }

    return ok(
      await this.deps.venues.addPlan(venueId, {
        name: input.name.trim(),
        cost: input.cost,
        config: input.config ?? {},
      }),
    );
  }

  async list(filter: { typeKey?: string; city?: string }, paging: Paging): Promise<Venue[]> {
    return this.deps.venues.list(filter, paging);
  }
}

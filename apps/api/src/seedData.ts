import type { Logger } from "@venue/core";
import type { Container } from "./container.js";
import { UserModel } from "./db/models.js";

/**
 * Demo data so the apps have something to show on a fresh database.
 *
 * Idempotent by design — every step checks before it creates, so running it
 * twice does nothing the second time and it can never overwrite real data.
 */

const DEMO_PASSWORD = "password123";
const OPERATOR_EMAIL = "operator@example.com";
const CUSTOMER_EMAIL = "sathish@example.com";

const VENUES = [
  {
    name: "Iron Works Gym, Velachery",
    typeKey: "gym",
    city: "Chennai",
    plan: {
      name: "Day pass",
      cost: 60,
      config: {
        durationHours: 24,
        maxEntries: 1,
        reEntry: false,
        dailyCapacity: 150,
        peakSurchargeCredits: 15,
      },
    },
  },
  {
    name: "Nexus Coworking, Guindy",
    typeKey: "coworking",
    city: "Chennai",
    plan: {
      name: "Half-day desk",
      cost: 120,
      config: {
        blockMinutes: 240,
        seatCapacity: 60,
        openHour: 9,
        closeHour: 21,
        creditsPerExtraBlock: 90,
      },
    },
  },
  {
    name: "Chennai Trade Centre Expo",
    typeKey: "expo",
    city: "Chennai",
    plan: {
      name: "General admission",
      cost: 200,
      config: {
        doorsOpenHour: 10,
        doorsCloseHour: 18,
        maxEntries: 3,
        reEntry: true,
        totalTickets: 2000,
        earlyBirdDiscountCredits: 40,
        earlyBirdDaysBefore: 7,
      },
    },
  },
] as const;

export async function seedDemoData(c: Container, logger: Logger): Promise<void> {
  const operator = await ensureUser(c, OPERATOR_EMAIL, "Venue Operator", "venue_operator");
  const customer = await ensureUser(c, CUSTOMER_EMAIL, "Sathish", "end_user");

  // Idempotency key is tied to the user, so re-running never mints more credits.
  await c.ledger.append({
    walletId: customer.walletId,
    type: "adjustment",
    amount: 1000,
    reason: "Demo seed credits",
    idempotencyKey: `seed:credits:${customer.id}`,
  });

  for (const spec of VENUES) {
    // Only seed venue types this instance actually has enabled.
    if (!c.registry.get(spec.typeKey)) {
      logger.warn(`Skipping ${spec.name} — "${spec.typeKey}" is not in PLUGINS_ENABLED`);
      continue;
    }

    const existing = await c.venues.list({ typeKey: spec.typeKey }, { page: 1, size: 50 });
    if (existing.some((v) => v.name === spec.name)) {
      logger.info(`Venue already present: ${spec.name}`);
      continue;
    }

    const created = await c.venueService.onboard({
      name: spec.name,
      typeKey: spec.typeKey,
      operatorUserId: operator.id,
      city: spec.city,
    });

    if (!created.ok) {
      logger.error(`Could not create ${spec.name}`, { reason: created.error.message });
      continue;
    }

    await c.venueService.addPlan(created.value.id, operator.id, {
      name: spec.plan.name,
      cost: spec.plan.cost,
      config: { ...spec.plan.config },
    });

    logger.info(`Seeded ${spec.name}`);
  }

  logger.info("Seed complete", {
    operator: `${OPERATOR_EMAIL} / ${DEMO_PASSWORD}`,
    customer: `${CUSTOMER_EMAIL} / ${DEMO_PASSWORD}`,
  });
}

async function ensureUser(
  c: Container,
  email: string,
  displayName: string,
  role: "end_user" | "venue_operator" | "platform_admin",
) {
  const existing = await c.users.byEmail(email);
  if (existing) return existing;

  const created = await c.identity.register({ email, password: DEMO_PASSWORD, displayName });
  if (!created.ok) throw new Error(`Could not seed ${email}: ${created.error.message}`);

  // Seeded accounts skip the email step, and the operator needs their role.
  await UserModel.updateOne({ _id: created.value.id }, { $set: { role, emailVerified: true } });

  const refreshed = await c.users.byId(created.value.id);
  if (!refreshed) throw new Error(`Seeded user ${email} vanished.`);
  return refreshed;
}

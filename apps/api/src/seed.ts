import mongoose from "mongoose";
import { loadConfig } from "./config.js";
import { connectMongo } from "./db/connection.js";
import { buildContainer } from "./container.js";
import { createLogger } from "./logger.js";
import { UserModel } from "./db/models.js";

/**
 * Demo data so the apps have something to show on a fresh database.
 * Safe to re-run: it skips anything that already exists.
 *
 *   pnpm --filter @venue/api seed
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(false);

  await connectMongo(config.MONGODB_URI, logger);
  const c = buildContainer(config, logger);

  const operatorEmail = "operator@example.com";
  const customerEmail = "sathish@example.com";
  const password = "password123";

  const operator = await ensureUser(c, operatorEmail, "Venue Operator", password, "venue_operator");
  const customer = await ensureUser(c, customerEmail, "Sathish", password, "end_user");

  // Give the demo customer something to spend.
  await c.ledger.append({
    walletId: customer.walletId,
    type: "adjustment",
    amount: 1000,
    reason: "Demo seed credits",
    idempotencyKey: `seed:credits:${customer.id}`,
  });

  const venues = [
    {
      name: "Iron Works Gym, Velachery",
      typeKey: "gym",
      city: "Chennai",
      plan: {
        name: "Day pass",
        cost: 60,
        config: { durationHours: 24, maxEntries: 1, reEntry: false, dailyCapacity: 150, peakSurchargeCredits: 15 },
      },
    },
    {
      name: "Nexus Coworking, Guindy",
      typeKey: "coworking",
      city: "Chennai",
      plan: {
        name: "Half-day desk",
        cost: 120,
        config: { blockMinutes: 240, seatCapacity: 60, openHour: 9, closeHour: 21, creditsPerExtraBlock: 90 },
      },
    },
    {
      name: "Chennai Trade Centre Expo",
      typeKey: "expo",
      city: "Chennai",
      plan: {
        name: "General admission",
        cost: 200,
        config: { doorsOpenHour: 10, doorsCloseHour: 18, maxEntries: 3, reEntry: true, totalTickets: 2000, earlyBirdDiscountCredits: 40, earlyBirdDaysBefore: 7 },
      },
    },
  ];

  for (const spec of venues) {
    // Only seed venue types this build actually has enabled.
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

    await c.venueService.addPlan(created.value.id, operator.id, spec.plan);
    logger.info(`Seeded ${spec.name}`);
  }

  logger.info("Seed complete", {
    operator: `${operatorEmail} / ${password}`,
    customer: `${customerEmail} / ${password}`,
  });

  await mongoose.disconnect();
}

async function ensureUser(
  c: ReturnType<typeof buildContainer>,
  email: string,
  displayName: string,
  password: string,
  role: "end_user" | "venue_operator" | "platform_admin",
) {
  const existing = await c.users.byEmail(email);
  if (existing) return existing;

  const created = await c.identity.register({ email, password, displayName });
  if (!created.ok) throw new Error(`Could not seed ${email}: ${created.error.message}`);

  // Seeded accounts skip the email step, and the operator needs their role.
  await UserModel.updateOne({ _id: created.value.id }, { $set: { role, emailVerified: true } });

  const refreshed = await c.users.byId(created.value.id);
  if (!refreshed) throw new Error(`Seeded user ${email} vanished.`);
  return refreshed;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

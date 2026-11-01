import mongoose from "mongoose";
import { loadConfig } from "./config.js";
import { connectMongo } from "./db/connection.js";
import { buildContainer } from "./container.js";
import { createLogger } from "./logger.js";
import { seedDemoData } from "./seedData.js";

/**
 * Standalone seeder:  pnpm --filter @venue/api seed
 *
 * The same routine also runs at boot when SEED_ON_BOOT=true, which is how a
 * hosted environment with no shell access gets its first demo data.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(false);

  await connectMongo(config.MONGODB_URI, logger);
  const container = buildContainer(config, logger);

  await seedDemoData(container, logger);
  await mongoose.disconnect();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

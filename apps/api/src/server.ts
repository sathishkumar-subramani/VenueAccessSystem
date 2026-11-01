import mongoose from "mongoose";
import { loadConfig } from "./config.js";
import { connectMongo } from "./db/connection.js";
import { buildContainer } from "./container.js";
import { createApp } from "./app.js";
import { createLogger } from "./logger.js";
import { seedDemoData } from "./seedData.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.isProduction);

  await connectMongo(config.MONGODB_URI, logger);

  const container = buildContainer(config, logger);

  if (config.SEED_ON_BOOT === "true") {
    logger.warn("SEED_ON_BOOT is set — writing demo data");
    try {
      await seedDemoData(container, logger);
    } catch (error) {
      // Demo data is a convenience. Never let it stop the API from serving.
      logger.error("Seeding failed; continuing to start", { cause: String(error) });
    }
  }

  const app = createApp(container, config, logger);

  const server = app.listen(config.PORT, () => {
    logger.info(`API listening on :${config.PORT}`, { env: config.NODE_ENV });
  });

  // Render sends SIGTERM on deploy. Finish in-flight requests before closing
  // the database, or a payment webhook can be cut off mid-write.
  const shutdown = (signal: string) => {
    logger.info(`${signal} received, shutting down`);

    server.close(() => {
      void mongoose.disconnect().then(() => process.exit(0));
    });

    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

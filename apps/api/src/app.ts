import cors from "cors";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import type { Logger } from "@venue/core";
import type { AppConfig } from "./config.js";
import type { Container } from "./container.js";
import { errorHandler } from "./http/middleware.js";
import { authRoutes } from "./http/routes/auth.js";
import { operatorRoutes, passRoutes } from "./http/routes/passes.js";
import { venueRoutes } from "./http/routes/venues.js";
import { walletRoutes } from "./http/routes/wallet.js";
import { webhookRoutes } from "./http/routes/webhooks.js";

export function createApp(container: Container, config: AppConfig, logger: Logger) {
  const app = express();

  // Render terminates TLS in front of the app, so trust its proxy header —
  // otherwise every client looks like it shares one IP and rate limiting
  // throttles all users together.
  app.set("trust proxy", 1);

  app.disable("x-powered-by");
  app.use(helmet());

  app.use(
    cors({
      origin: config.corsOrigins.length > 0 ? config.corsOrigins : false,
      credentials: false,
    }),
  );

  // Mounted before the JSON parser: signatures are checked against raw bytes.
  app.use("/api/webhooks", webhookRoutes(container.payments, container.wallet, logger));

  app.use(express.json({ limit: "100kb" }));

  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 300,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      // In-process, so this is a per-instance cap. Fine on one Render instance;
      // move to a shared store the day you run more than one.
      message: { error: { code: "rate_limited", message: "Slow down a moment." } },
    }),
  );

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", venueTypes: container.registry.all().map((p) => p.key) });
  });

  app.use("/api/auth", authRoutes({
    identity: container.identity,
    refreshTokens: container.refreshTokens,
    config,
  }));

  app.use("/api/wallet", walletRoutes(container.wallet, config));
  app.use("/api/venues", venueRoutes(container.venueService, config));
  app.use("/api/passes", passRoutes({
    access: container.access,
    venues: container.venues,
    clock: container.clock,
    config,
  }));
  app.use("/api/operator", operatorRoutes(container.access, config));

  app.use((_req, res) => {
    res.status(404).json({ error: { code: "not_found", message: "No such endpoint." } });
  });

  app.use(errorHandler(logger));

  return app;
}

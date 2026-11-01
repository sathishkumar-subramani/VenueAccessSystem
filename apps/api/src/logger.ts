import { createRequire } from "node:module";
import pino from "pino";
import type { Logger } from "@venue/core";

/**
 * Pretty logs are a development convenience, so pino-pretty is a devDependency.
 * Production installs skip devDependencies, and pino throws at startup if a
 * transport target cannot be resolved — so check before asking for it rather
 * than letting the whole API fail to boot over log formatting.
 */
function prettyTransportAvailable(): boolean {
  try {
    createRequire(import.meta.url).resolve("pino-pretty");
    return true;
  } catch {
    return false;
  }
}

export function createLogger(isProduction: boolean): Logger & { raw: pino.Logger } {
  const usePretty = !isProduction && prettyTransportAvailable();

  const raw = pino({
    level: process.env.LOG_LEVEL ?? (isProduction ? "info" : "debug"),
    // Never let a token, a code or a password reach the log stream.
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "*.password",
        "*.code",
        "*.token",
        "*.refreshToken",
        "*.idToken",
      ],
      censor: "[redacted]",
    },
    transport: usePretty ? { target: "pino-pretty", options: { colorize: true } } : undefined,
  });

  return {
    raw,
    info: (message, meta) => raw.info(meta ?? {}, message),
    warn: (message, meta) => raw.warn(meta ?? {}, message),
    error: (message, meta) => raw.error(meta ?? {}, message),
  };
}

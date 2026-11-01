import pino from "pino";
import type { Logger } from "@venue/core";

export function createLogger(isProduction: boolean): Logger & { raw: pino.Logger } {
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
    transport: isProduction ? undefined : { target: "pino-pretty", options: { colorize: true } },
  });

  return {
    raw,
    info: (message, meta) => raw.info(meta ?? {}, message),
    warn: (message, meta) => raw.warn(meta ?? {}, message),
    error: (message, meta) => raw.error(meta ?? {}, message),
  };
}

import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(5080),

  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),

  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  ACCESS_TOKEN_MINUTES: z.coerce.number().int().positive().default(30),
  REFRESH_TOKEN_DAYS: z.coerce.number().int().positive().default(30),

  /** Base64 of at least 32 random bytes: openssl rand -base64 32 */
  PASS_TOKEN_SECRET: z.string().min(32, "PASS_TOKEN_SECRET must be at least 32 characters"),

  PLUGINS_ENABLED: z.string().default("gym,coworking,expo"),
  PLUGIN_SETTINGS: z.string().default("{}"),

  CORS_ORIGINS: z.string().default("http://localhost:5173"),

  GOOGLE_CLIENT_ID: z.string().default(""),

  BREVO_API_KEY: z.string().default(""),
  BREVO_SENDER_EMAIL: z.string().default("no-reply@example.com"),
  BREVO_SENDER_NAME: z.string().default("Venue Access"),

  MSG91_AUTH_KEY: z.string().default(""),
  MSG91_OTP_TEMPLATE_ID: z.string().default(""),

  RAZORPAY_KEY_ID: z.string().default(""),
  RAZORPAY_KEY_SECRET: z.string().default(""),
  RAZORPAY_WEBHOOK_SECRET: z.string().default(""),
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = schema.safeParse(env);

  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    // Fail at boot with the whole list, not one variable at a time.
    throw new Error(`Invalid environment configuration:\n${lines.join("\n")}`);
  }

  const raw = parsed.data;

  let pluginSettings: Record<string, Record<string, unknown>> = {};
  try {
    pluginSettings = JSON.parse(raw.PLUGIN_SETTINGS) as Record<string, Record<string, unknown>>;
  } catch {
    throw new Error("PLUGIN_SETTINGS must be valid JSON, for example {\"gym\":{\"maxDaily\":200}}");
  }

  return {
    ...raw,
    isProduction: raw.NODE_ENV === "production",
    pluginsEnabled: raw.PLUGINS_ENABLED.split(",").map((k) => k.trim()).filter(Boolean),
    pluginSettings,
    corsOrigins: raw.CORS_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean),
    accessTokenMs: raw.ACCESS_TOKEN_MINUTES * 60_000,
    refreshTokenMs: raw.REFRESH_TOKEN_DAYS * 86_400_000,
  };
}

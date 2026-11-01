import {
  AccessService,
  IdentityService,
  VenueService,
  WalletService,
  createRegistry,
  type Logger,
  type PluginModule,
} from "@venue/core";
import coworkingPlugin from "@venue/plugin-coworking";
import expoPlugin from "@venue/plugin-expo";
import gymPlugin from "@venue/plugin-gym";
import type { AppConfig } from "./config.js";
import { MongoLedgerStore } from "./adapters/mongoLedgerStore.js";
import {
  MongoPassRepository,
  MongoUserRepository,
  MongoVenueRepository,
} from "./adapters/repositories.js";
import { MongoRefreshTokenStore, MongoVerificationCodeStore } from "./adapters/stores.js";
import { BrevoEmailSender, Msg91SmsSender, RazorpayGateway } from "./adapters/providers.js";
import {
  CryptoIdGenerator,
  GoogleAuthValidator,
  HmacPassTokenService,
  ScryptPasswordHasher,
  SystemClock,
} from "./adapters/security.js";

/**
 * The composition root. This is the only file that knows which concrete
 * adapters exist — swap MongoDB for something else here and nothing in
 * @venue/core changes.
 *
 * Every venue-type plugin this build can offer is listed below. Which of them
 * actually load is decided by PLUGINS_ENABLED at runtime.
 */
const AVAILABLE_PLUGINS: PluginModule[] = [gymPlugin, coworkingPlugin, expoPlugin];

export function buildContainer(config: AppConfig, logger: Logger) {
  const clock = new SystemClock();
  const ids = new CryptoIdGenerator();

  const ledger = new MongoLedgerStore(logger);
  const users = new MongoUserRepository();
  const venueRepo = new MongoVenueRepository();
  const passes = new MongoPassRepository();
  const codes = new MongoVerificationCodeStore();
  const refreshTokens = new MongoRefreshTokenStore();

  const email = new BrevoEmailSender(
    {
      apiKey: config.BREVO_API_KEY,
      senderEmail: config.BREVO_SENDER_EMAIL,
      senderName: config.BREVO_SENDER_NAME,
    },
    logger,
  );

  const sms = new Msg91SmsSender(
    { authKey: config.MSG91_AUTH_KEY, otpTemplateId: config.MSG91_OTP_TEMPLATE_ID },
    logger,
  );

  const payments = new RazorpayGateway(
    {
      keyId: config.RAZORPAY_KEY_ID,
      keySecret: config.RAZORPAY_KEY_SECRET,
      webhookSecret: config.RAZORPAY_WEBHOOK_SECRET,
    },
    logger,
  );

  const hasher = new ScryptPasswordHasher();
  const tokens = new HmacPassTokenService(config.PASS_TOKEN_SECRET);
  const google = new GoogleAuthValidator(config.GOOGLE_CLIENT_ID);

  // Throws at boot if PLUGINS_ENABLED names a type this build cannot serve.
  const registry = createRegistry(
    AVAILABLE_PLUGINS,
    config.pluginsEnabled,
    { passes, clock, settings: {} },
    (key) => config.pluginSettings[key] ?? {},
  );

  logger.info("Venue types enabled", { keys: registry.all().map((p) => p.key) });

  return {
    clock,
    ledger,
    users,
    venues: venueRepo,
    passes,
    refreshTokens,
    payments,
    registry,

    identity: new IdentityService({
      users,
      ledger,
      hasher,
      google,
      codes,
      ids,
      email,
      sms,
      clock,
      logger,
    }),

    wallet: new WalletService({ ledger, users, payments, clock, logger }),

    venueService: new VenueService({ venues: venueRepo, registry, clock }),

    access: new AccessService({
      registry,
      venues: venueRepo,
      passes,
      users,
      ledger,
      tokens,
      clock,
      logger,
    }),
  };
}

export type Container = ReturnType<typeof buildContainer>;

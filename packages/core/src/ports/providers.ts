import type { AccessPass } from "../domain/entities.js";
import type { Result } from "../domain/result.js";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/** Adapter: Brevo. */
export interface EmailSender {
  send(message: EmailMessage): Promise<Result<true>>;
}

/** Adapter: MSG91. */
export interface SmsSender {
  sendOtp(toE164: string, code: string): Promise<Result<true>>;
}

export interface Money {
  paise: number;
  currency: "INR";
}

export interface PaymentIntent {
  providerOrderId: string;
  amount: Money;
  publicKey: string;
}

export type PaymentEventKind = "captured" | "failed" | "refunded" | "unhandled";

export interface PaymentEvent {
  kind: PaymentEventKind;
  providerOrderId: string;
  providerPaymentId: string;
  amount: Money;
  /** Carries the wallet id. Set by us when the order is created. */
  receiptId: string;
}

/** Adapter: Razorpay. */
export interface PaymentGateway {
  createOrder(amount: Money, receiptId: string): Promise<Result<PaymentIntent>>;
  /**
   * Verifies the signature BEFORE parsing. An unverified body is attacker input.
   * The webhook is the source of truth for money — never the browser callback.
   */
  parseWebhook(rawBody: string, signature: string): Result<PaymentEvent>;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, hash: string): Promise<boolean>;
}

export interface GoogleIdentity {
  subjectId: string;
  email: string;
  displayName: string;
}

export interface GoogleTokenValidator {
  validate(idToken: string): Promise<Result<GoogleIdentity>>;
}

export interface PassClaims {
  passId: string;
  userId: string;
  scanNonce: string;
  expiresAt: Date;
}

/** Short-lived signed token behind the QR. A screenshot is useless once it expires. */
export interface PassTokenService {
  issue(pass: AccessPass, lifetimeMs: number): string;
  validate(token: string): Result<PassClaims>;
}

export interface Clock {
  now(): Date;
}

/**
 * Randomness is infrastructure, not a rule. Keeping it behind a port means
 * @venue/core imports nothing from Node and stays trivially testable: a fake
 * generator makes every id in a test deterministic.
 */
export interface IdGenerator {
  uuid(): string;
  /** Cryptographically random, uniformly distributed. Used for OTP codes. */
  numericCode(digits: number): string;
}

export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

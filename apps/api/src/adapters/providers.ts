import { createHmac, timingSafeEqual } from "node:crypto";
import {
  fail,
  failWith,
  errors,
  ok,
  type EmailMessage,
  type EmailSender,
  type Logger,
  type Money,
  type PaymentEvent,
  type PaymentEventKind,
  type PaymentGateway,
  type PaymentIntent,
  type Result,
  type SmsSender,
} from "@venue/core";

const TIMEOUT_MS = 10_000;

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<{ ok: boolean; status: number; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    return { ok: response.ok, status: response.status, text: await response.text() };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ Brevo */

export interface BrevoOptions {
  apiKey: string;
  senderEmail: string;
  senderName: string;
}

export class BrevoEmailSender implements EmailSender {
  constructor(
    private readonly options: BrevoOptions,
    private readonly logger: Logger,
  ) {}

  async send(message: EmailMessage): Promise<Result<true>> {
    if (!this.options.apiKey) {
      // In development, print the mail instead of silently dropping it.
      this.logger.warn("BREVO_API_KEY not set — email not sent", {
        to: message.to,
        subject: message.subject,
        preview: message.text ?? message.html.replace(/<[^>]+>/g, " ").slice(0, 200),
      });
      return ok(true);
    }

    try {
      const response = await postJson(
        "https://api.brevo.com/v3/smtp/email",
        { "api-key": this.options.apiKey },
        {
          sender: { email: this.options.senderEmail, name: this.options.senderName },
          to: [{ email: message.to }],
          subject: message.subject,
          htmlContent: message.html,
          textContent: message.text,
        },
      );

      if (response.ok) return ok(true);

      this.logger.error("Brevo rejected the message", {
        status: response.status,
        body: response.text.slice(0, 500),
      });
      return fail("provider_unavailable", "The email could not be sent.");
    } catch (cause) {
      this.logger.error("Brevo is unreachable", { cause: String(cause) });
      return fail("provider_unavailable", "The email provider is unreachable.");
    }
  }
}

/* ------------------------------------------------------------------ MSG91 */

export interface Msg91Options {
  authKey: string;
  /** DLT-approved template id. Indian carriers reject anything else. */
  otpTemplateId: string;
}

export class Msg91SmsSender implements SmsSender {
  constructor(
    private readonly options: Msg91Options,
    private readonly logger: Logger,
  ) {}

  async sendOtp(toE164: string, code: string): Promise<Result<true>> {
    if (!this.options.authKey) {
      // Never log the code in production. In development it is the only way in.
      this.logger.warn("MSG91_AUTH_KEY not set — OTP not sent", { to: toE164, devOnlyCode: code });
      return ok(true);
    }

    try {
      const response = await postJson(
        "https://control.msg91.com/api/v5/otp",
        { authkey: this.options.authKey },
        {
          template_id: this.options.otpTemplateId,
          mobile: toE164.replace(/^\+/, ""),
          otp: code,
        },
      );

      if (response.ok) return ok(true);

      this.logger.error("MSG91 rejected the OTP request", {
        status: response.status,
        body: response.text.slice(0, 500),
      });
      return fail("provider_unavailable", "The verification code could not be sent.");
    } catch (cause) {
      this.logger.error("MSG91 is unreachable", { cause: String(cause) });
      return fail("provider_unavailable", "The SMS provider is unreachable.");
    }
  }
}

/* --------------------------------------------------------------- Razorpay */

export interface RazorpayOptions {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
}

export class RazorpayGateway implements PaymentGateway {
  constructor(
    private readonly options: RazorpayOptions,
    private readonly logger: Logger,
  ) {}

  async createOrder(amount: Money, receiptId: string): Promise<Result<PaymentIntent>> {
    if (!this.options.keyId) {
      return fail("provider_unavailable", "Payments are not configured on this server.");
    }

    const basic = Buffer.from(`${this.options.keyId}:${this.options.keySecret}`).toString("base64");

    try {
      const response = await postJson(
        "https://api.razorpay.com/v1/orders",
        { Authorization: `Basic ${basic}` },
        {
          amount: amount.paise,
          currency: amount.currency,
          receipt: receiptId,
          // Echoed back on the webhook, which is how the wallet is found again.
          notes: { receipt: receiptId },
        },
      );

      if (!response.ok) {
        this.logger.error("Razorpay order creation failed", {
          status: response.status,
          body: response.text.slice(0, 500),
        });
        return fail("provider_unavailable", "The payment could not be started.");
      }

      const order = JSON.parse(response.text) as { id: string };
      return ok({ providerOrderId: order.id, amount, publicKey: this.options.keyId });
    } catch (cause) {
      this.logger.error("Razorpay is unreachable", { cause: String(cause) });
      return fail("provider_unavailable", "The payment provider is unreachable.");
    }
  }

  /**
   * Verify the signature BEFORE parsing. Until that check passes, the body is
   * attacker-controlled text that happens to look like JSON.
   *
   * This — not the browser's "payment succeeded" callback — is what credits a
   * wallet. A browser can be told to say anything.
   */
  parseWebhook(rawBody: string, signature: string): Result<PaymentEvent> {
    if (!this.options.webhookSecret) {
      this.logger.error("RAZORPAY_WEBHOOK_SECRET is not set — refusing the webhook");
      return fail("provider_unavailable", "Webhooks are not configured.");
    }

    const expected = Buffer.from(
      createHmac("sha256", this.options.webhookSecret).update(rawBody).digest("hex"),
    );
    const provided = Buffer.from(signature.trim().toLowerCase());

    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
      this.logger.warn("Rejected a Razorpay webhook with a bad signature");
      return failWith(errors.forbidden("Invalid webhook signature."));
    }

    try {
      const parsed = JSON.parse(rawBody) as {
        event?: string;
        payload?: { payment?: { entity?: Record<string, unknown> } };
      };

      const entity = parsed.payload?.payment?.entity;
      if (!entity) return failWith(errors.validation("Unrecognised webhook payload."));

      const kind: PaymentEventKind =
        parsed.event === "payment.captured"
          ? "captured"
          : parsed.event === "payment.failed"
            ? "failed"
            : parsed.event === "refund.processed"
              ? "refunded"
              : "unhandled";

      const notes = (entity.notes ?? {}) as Record<string, unknown>;

      return ok({
        kind,
        providerOrderId: String(entity.order_id ?? ""),
        providerPaymentId: String(entity.id ?? ""),
        amount: { paise: Number(entity.amount ?? 0), currency: "INR" },
        receiptId: typeof notes.receipt === "string" ? notes.receipt : "",
      });
    } catch (cause) {
      this.logger.error("Could not read the Razorpay webhook body", { cause: String(cause) });
      return failWith(errors.validation("Unrecognised webhook payload."));
    }
  }
}

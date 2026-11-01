import { Router, raw } from "express";
import type { Logger, PaymentGateway, WalletService } from "@venue/core";

/**
 * Mounted BEFORE express.json(), because the signature is computed over the
 * exact bytes Razorpay sent. Re-serialising parsed JSON changes those bytes and
 * every signature check then fails.
 */
export function webhookRoutes(
  gateway: PaymentGateway,
  wallet: WalletService,
  logger: Logger,
): Router {
  const router = Router();

  router.post("/razorpay", raw({ type: "*/*" }), (req, res) => {
    const signature = String(req.headers["x-razorpay-signature"] ?? "");
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : String(req.body ?? "");

    const parsed = gateway.parseWebhook(rawBody, signature);
    if (!parsed.ok) {
      res.status(401).json({ error: parsed.error });
      return;
    }

    // Acknowledge immediately. Razorpay retries on anything that is not a 2xx,
    // and a slow handler turns one payment into a retry storm.
    res.status(200).json({ received: true });

    void wallet.confirmTopUp(parsed.value).then((result) => {
      if (!result.ok) {
        logger.error("Top-up confirmation failed after a verified webhook", {
          paymentId: parsed.value.providerPaymentId,
          reason: result.error.message,
        });
      }
    });
  });

  return router;
}

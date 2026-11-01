import { Router } from "express";
import { z } from "zod";
import type { WalletService } from "@venue/core";
import type { AppConfig } from "../../config.js";
import { toLedgerDto } from "../mappers.js";
import { requireAuth, sendError, wrap } from "../middleware.js";

const topUpBody = z.object({ credits: z.number().int().positive().max(100_000) });

export function walletRoutes(wallet: WalletService, config: AppConfig): Router {
  const router = Router();
  router.use(requireAuth(config.JWT_SECRET));

  router.get(
    "/balance",
    wrap(async (req, res) => {
      const result = await wallet.balance(req.user!.id);
      if (!result.ok) return sendError(res, result.error);
      res.json(result.value);
    }),
  );

  router.get(
    "/ledger",
    wrap(async (req, res) => {
      const page = Number(req.query.page ?? 1);
      const size = Number(req.query.size ?? 25);

      const result = await wallet.history(req.user!.id, {
        page: Number.isFinite(page) ? page : 1,
        size: Number.isFinite(size) ? size : 25,
      });

      if (!result.ok) return sendError(res, result.error);
      res.json(result.value.map(toLedgerDto));
    }),
  );

  router.post(
    "/top-up",
    wrap(async (req, res) => {
      const parsed = topUpBody.safeParse(req.body);
      if (!parsed.success) {
        return sendError(res, { code: "validation", message: "Choose how many credits to add." });
      }

      const result = await wallet.startTopUp(req.user!.id, parsed.data.credits);
      if (!result.ok) return sendError(res, result.error);

      // The order only starts the payment. Credits arrive on the webhook.
      res.json({
        providerOrderId: result.value.providerOrderId,
        amountPaise: result.value.amount.paise,
        currency: result.value.amount.currency,
        publicKey: result.value.publicKey,
      });
    }),
  );

  return router;
}

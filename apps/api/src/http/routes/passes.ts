import { Router } from "express";
import { z } from "zod";
import type { AccessService, Clock, VenueRepository } from "@venue/core";
import type { AppConfig } from "../../config.js";
import { toPassDto } from "../mappers.js";
import { requireAuth, requireRole, sendError, wrap } from "../middleware.js";

const purchaseBody = z.object({
  venueId: z.string().min(1),
  accessPlanId: z.string().min(1),
  requestedFor: z.string().datetime(),
  options: z.record(z.string()).default({}),
});

const redeemBody = z.object({ token: z.string().min(1).max(2048) });

export interface PassRouteDeps {
  access: AccessService;
  venues: VenueRepository;
  clock: Clock;
  config: AppConfig;
}

export function passRoutes(deps: PassRouteDeps): Router {
  const router = Router();
  router.use(requireAuth(deps.config.JWT_SECRET));

  router.get(
    "/",
    wrap(async (req, res) => {
      const passes = await deps.access.listForUser(req.user!.id);
      const now = deps.clock.now();

      // Venue names come from a small set; cache them per request.
      const venueCache = new Map<string, { name: string; typeKey: string } | null>();

      const dtos = await Promise.all(
        passes.map(async (pass) => {
          if (!venueCache.has(pass.venueId)) {
            const venue = await deps.venues.byId(pass.venueId);
            venueCache.set(
              pass.venueId,
              venue ? { name: venue.name, typeKey: venue.typeKey } : null,
            );
          }
          return toPassDto(pass, venueCache.get(pass.venueId) ?? null, now);
        }),
      );

      res.json(dtos);
    }),
  );

  router.post(
    "/",
    wrap(async (req, res) => {
      // The client sends this so a retried tap cannot buy a second pass.
      const idempotencyKey = String(req.headers["idempotency-key"] ?? "");
      if (!idempotencyKey) {
        return sendError(res, {
          code: "validation",
          message: "An Idempotency-Key header is required.",
        });
      }

      const parsed = purchaseBody.safeParse(req.body);
      if (!parsed.success) {
        return sendError(res, {
          code: "validation",
          message: parsed.error.issues[0]?.message ?? "Check the booking details.",
        });
      }

      const result = await deps.access.purchase({
        userId: req.user!.id,
        venueId: parsed.data.venueId,
        accessPlanId: parsed.data.accessPlanId,
        requestedFor: new Date(parsed.data.requestedFor),
        options: parsed.data.options,
        idempotencyKey,
      });

      if (!result.ok) return sendError(res, result.error);

      const venue = await deps.venues.byId(result.value.venueId);
      res.status(201).json(
        toPassDto(
          result.value,
          venue ? { name: venue.name, typeKey: venue.typeKey } : null,
          deps.clock.now(),
        ),
      );
    }),
  );

  router.get(
    "/:passId",
    wrap(async (req, res) => {
      const passes = await deps.access.listForUser(req.user!.id);
      const pass = passes.find((p) => p.id === req.params.passId);

      if (!pass) return sendError(res, { code: "not_found", message: "Pass was not found." });

      const venue = await deps.venues.byId(pass.venueId);
      res.json(
        toPassDto(pass, venue ? { name: venue.name, typeKey: venue.typeKey } : null, deps.clock.now()),
      );
    }),
  );

  // Short-lived. The app refetches it every ~25 seconds while the QR is open.
  router.get(
    "/:passId/token",
    wrap(async (req, res) => {
      const result = await deps.access.generateToken(req.user!.id, req.params.passId!);
      if (!result.ok) return sendError(res, result.error);
      res.json(result.value);
    }),
  );

  return router;
}

export function operatorRoutes(access: AccessService, config: AppConfig): Router {
  const router = Router();

  router.post(
    "/redeem",
    requireAuth(config.JWT_SECRET),
    requireRole("venue_operator", "platform_admin"),
    wrap(async (req, res) => {
      const parsed = redeemBody.safeParse(req.body);
      if (!parsed.success) {
        return sendError(res, { code: "validation", message: "No code was scanned." });
      }

      const result = await access.redeem(parsed.data.token, req.user!.id);

      // A refusal is a normal outcome at a door, not a server problem — but the
      // scanner still needs to show red, so keep the 4xx status.
      if (!result.ok) return sendError(res, result.error);
      res.json(result.value);
    }),
  );

  return router;
}

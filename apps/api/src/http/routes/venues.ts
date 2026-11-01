import { Router } from "express";
import { z } from "zod";
import type { VenueService } from "@venue/core";
import type { AppConfig } from "../../config.js";
import { toVenueDto } from "../mappers.js";
import { requireAuth, requireRole, sendError, wrap } from "../middleware.js";

const onboardBody = z.object({
  name: z.string().min(1).max(200),
  typeKey: z.string().min(1).max(50),
  city: z.string().max(100).optional(),
  addressLine: z.string().max(400).optional(),
});

const planBody = z.object({
  name: z.string().min(1).max(150),
  cost: z.number().int().min(0).max(1_000_000),
  config: z.record(z.unknown()).default({}),
});

export function venueRoutes(venues: VenueService, config: AppConfig): Router {
  const router = Router();

  // Public: the catalogue is browsable before signing in.
  router.get("/types", (_req, res) => {
    res.json(venues.availableTypes());
  });

  router.get(
    "/",
    wrap(async (req, res) => {
      const page = Number(req.query.page ?? 1);
      const size = Number(req.query.size ?? 20);

      const found = await venues.list(
        {
          typeKey: typeof req.query.type === "string" ? req.query.type : undefined,
          city: typeof req.query.city === "string" ? req.query.city : undefined,
        },
        { page: Number.isFinite(page) ? page : 1, size: Number.isFinite(size) ? size : 20 },
      );

      res.json(found.map(toVenueDto));
    }),
  );

  router.get(
    "/:venueId",
    wrap(async (req, res) => {
      const found = await venues.list({}, { page: 1, size: 100 });
      const venue = found.find((v) => v.id === req.params.venueId);

      if (!venue) return sendError(res, { code: "not_found", message: "Venue was not found." });
      res.json(toVenueDto(venue));
    }),
  );

  router.post(
    "/",
    requireAuth(config.JWT_SECRET),
    requireRole("venue_operator", "platform_admin"),
    wrap(async (req, res) => {
      const parsed = onboardBody.safeParse(req.body);
      if (!parsed.success) {
        return sendError(res, {
          code: "validation",
          message: parsed.error.issues[0]?.message ?? "Check the venue details.",
        });
      }

      const result = await venues.onboard({ ...parsed.data, operatorUserId: req.user!.id });
      if (!result.ok) return sendError(res, result.error);

      res.status(201).json(toVenueDto(result.value));
    }),
  );

  router.post(
    "/:venueId/plans",
    requireAuth(config.JWT_SECRET),
    requireRole("venue_operator", "platform_admin"),
    wrap(async (req, res) => {
      const parsed = planBody.safeParse(req.body);
      if (!parsed.success) {
        return sendError(res, {
          code: "validation",
          message: parsed.error.issues[0]?.message ?? "Check the plan details.",
        });
      }

      const result = await venues.addPlan(req.params.venueId!, req.user!.id, parsed.data);
      if (!result.ok) return sendError(res, result.error);

      res.status(201).json(result.value);
    }),
  );

  return router;
}

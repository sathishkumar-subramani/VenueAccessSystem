import { Router } from "express";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import type { IdentityService, User } from "@venue/core";
import type { AuthResponse } from "@venue/shared";
import type { AppConfig } from "../../config.js";
import type { MongoRefreshTokenStore } from "../../adapters/stores.js";
import { toUserDto } from "../mappers.js";
import { requireAuth, send, sendError, wrap } from "../middleware.js";

const signUpBody = z.object({
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(8, "Use at least 8 characters."),
  displayName: z.string().min(1, "Tell us your name.").max(120),
});

const signInBody = z.object({ email: z.string().email(), password: z.string().min(1) });
const googleBody = z.object({ idToken: z.string().min(1) });
const refreshBody = z.object({ refreshToken: z.string().min(1) });
const verifyEmailBody = z.object({ email: z.string().email(), code: z.string().min(4).max(10) });
const phoneBody = z.object({ phone: z.string().min(8).max(20) });
const codeBody = z.object({ code: z.string().min(4).max(10) });

export interface AuthDeps {
  identity: IdentityService;
  refreshTokens: MongoRefreshTokenStore;
  config: AppConfig;
}

export function authRoutes(deps: AuthDeps): Router {
  const router = Router();
  const { config } = deps;

  // Credential endpoints are what gets hammered. Cap them harder than the rest.
  const authLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 20,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: { code: "rate_limited", message: "Too many attempts. Try again shortly." } },
  });

  const otpLimiter = rateLimit({
    windowMs: 60 * 60_000,
    limit: 5,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: {
      error: { code: "rate_limited", message: "Too many codes requested. Try again in an hour." },
    },
  });

  const issueAccessToken = (user: User): string =>
    jwt.sign(
      { email: user.email, role: user.role, emailVerified: user.emailVerified },
      config.JWT_SECRET,
      { subject: user.id, expiresIn: `${config.ACCESS_TOKEN_MINUTES}m` },
    );

  const buildSession = async (user: User): Promise<AuthResponse> => ({
    accessToken: issueAccessToken(user),
    refreshToken: await deps.refreshTokens.issue(user.id, config.refreshTokenMs),
    user: toUserDto(user),
  });

  router.post(
    "/signup",
    authLimiter,
    wrap(async (req, res) => {
      const parsed = signUpBody.safeParse(req.body);
      if (!parsed.success) {
        return sendError(res, {
          code: "validation",
          message: parsed.error.issues[0]?.message ?? "Check the details you entered.",
        });
      }

      const result = await deps.identity.register(parsed.data);
      if (!result.ok) return sendError(res, result.error);

      res.status(201).json(await buildSession(result.value));
    }),
  );

  router.post(
    "/signin",
    authLimiter,
    wrap(async (req, res) => {
      const parsed = signInBody.safeParse(req.body);
      if (!parsed.success) {
        return sendError(res, { code: "validation", message: "Enter your email and password." });
      }

      const result = await deps.identity.signIn(parsed.data.email, parsed.data.password);
      if (!result.ok) return sendError(res, result.error);

      res.json(await buildSession(result.value));
    }),
  );

  router.post(
    "/google",
    authLimiter,
    wrap(async (req, res) => {
      const parsed = googleBody.safeParse(req.body);
      if (!parsed.success) {
        return sendError(res, { code: "validation", message: "A Google token is required." });
      }

      const result = await deps.identity.signInWithGoogle(parsed.data.idToken);
      if (!result.ok) return sendError(res, result.error);

      res.json(await buildSession(result.value));
    }),
  );

  router.post(
    "/refresh",
    wrap(async (req, res) => {
      const parsed = refreshBody.safeParse(req.body);
      if (!parsed.success) {
        return sendError(res, { code: "unauthorized", message: "Please sign in again." });
      }

      // Rotating: the presented token dies as the replacement is minted.
      const rotated = await deps.refreshTokens.rotate(parsed.data.refreshToken, config.refreshTokenMs);
      if (!rotated.ok) return sendError(res, rotated.error);

      const user = await deps.identity.userById(rotated.value.userId);
      if (!user) {
        return sendError(res, { code: "unauthorized", message: "Please sign in again." });
      }

      res.json({ accessToken: issueAccessToken(user), refreshToken: rotated.value.token });
    }),
  );

  router.post(
    "/signout",
    wrap(async (req, res) => {
      const parsed = refreshBody.safeParse(req.body);
      if (parsed.success) await deps.refreshTokens.revoke(parsed.data.refreshToken);
      res.status(204).end();
    }),
  );

  router.get(
    "/me",
    requireAuth(config.JWT_SECRET),
    wrap(async (req, res) => {
      const user = await deps.identity.userById(req.user!.id);
      if (!user) return sendError(res, { code: "not_found", message: "User was not found." });
      res.json(toUserDto(user));
    }),
  );

  router.post(
    "/verify-email",
    authLimiter,
    wrap(async (req, res) => {
      const parsed = verifyEmailBody.safeParse(req.body);
      if (!parsed.success) {
        return sendError(res, { code: "validation", message: "Enter the code we emailed you." });
      }

      send(res, await deps.identity.verifyEmail(parsed.data.email, parsed.data.code));
    }),
  );

  router.post(
    "/resend-email-code",
    requireAuth(config.JWT_SECRET),
    otpLimiter,
    wrap(async (req, res) => {
      send(res, await deps.identity.resendEmailCode(req.user!.id));
    }),
  );

  router.post(
    "/phone/send-otp",
    requireAuth(config.JWT_SECRET),
    otpLimiter,
    wrap(async (req, res) => {
      const parsed = phoneBody.safeParse(req.body);
      if (!parsed.success) {
        return sendError(res, { code: "validation", message: "Enter a valid phone number." });
      }

      send(res, await deps.identity.sendPhoneOtp(req.user!.id, parsed.data.phone));
    }),
  );

  router.post(
    "/phone/verify",
    requireAuth(config.JWT_SECRET),
    authLimiter,
    wrap(async (req, res) => {
      const parsed = codeBody.safeParse(req.body);
      if (!parsed.success) {
        return sendError(res, { code: "validation", message: "Enter the 6-digit code." });
      }

      send(res, await deps.identity.verifyPhone(req.user!.id, parsed.data.code));
    }),
  );

  return router;
}

import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { AppError, ErrorCode, Logger, Result } from "@venue/core";
import type { UserRole } from "@venue/shared";

export interface AuthedUser {
  id: string;
  email: string;
  role: UserRole;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthedUser;
    }
  }
}

/** One place maps a domain error code to an HTTP status. */
const STATUS: Record<ErrorCode, number> = {
  not_found: 404,
  validation: 400,
  conflict: 409,
  forbidden: 403,
  unauthorized: 401,
  insufficient_credits: 409,
  duplicate_request: 409,
  pass_expired: 422,
  pass_not_yet_valid: 422,
  pass_not_active: 422,
  no_entries_remaining: 422,
  re_entry_not_allowed: 422,
  invalid_pass_token: 422,
  rate_limited: 429,
  provider_unavailable: 503,
  unexpected: 500,
};

export const statusFor = (error: AppError): number => STATUS[error.code] ?? 500;

export function sendError(res: Response, error: AppError): void {
  res.status(statusFor(error)).json({ error: { code: error.code, message: error.message } });
}

/** Unwraps a Result into a response, or passes the failure to the error shape. */
export function send<T>(res: Response, result: Result<T>, status = 200): void {
  if (!result.ok) return sendError(res, result.error);
  if (result.value === undefined) {
    res.status(204).end();
    return;
  }
  res.status(status).json(result.value);
}

export function requireAuth(jwtSecret: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization;

    if (!header?.startsWith("Bearer ")) {
      res.status(401).json({ error: { code: "unauthorized", message: "Sign in to continue." } });
      return;
    }

    try {
      const payload = jwt.verify(header.slice(7), jwtSecret) as jwt.JwtPayload;

      req.user = {
        id: String(payload.sub),
        email: String(payload.email ?? ""),
        role: (payload.role ?? "end_user") as UserRole,
      };
      next();
    } catch {
      res
        .status(401)
        .json({ error: { code: "unauthorized", message: "Your session has ended." } });
    }
  };
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({
        error: { code: "forbidden", message: "You do not have access to this." },
      });
      return;
    }
    next();
  };
}

export function errorHandler(logger: Logger) {
  return (error: unknown, _req: Request, res: Response, _next: NextFunction): void => {
    logger.error("Unhandled request error", { cause: String(error) });

    if (res.headersSent) return;

    // Never leak a stack trace or a driver message to a client.
    res.status(500).json({
      error: { code: "unexpected", message: "Something went wrong. Please try again." },
    });
  };
}

/** Express 4 does not forward rejected promises, so wrap async handlers. */
export function wrap(
  handler: (req: Request, res: Response) => Promise<unknown>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}

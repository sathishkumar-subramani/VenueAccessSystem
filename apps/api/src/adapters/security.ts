import {
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { OAuth2Client } from "google-auth-library";
import {
  errors,
  fail,
  failWith,
  ok,
  type AccessPass,
  type Clock,
  type GoogleIdentity,
  type GoogleTokenValidator,
  type IdGenerator,
  type PassClaims,
  type PassTokenService,
  type PasswordHasher,
  type Result,
} from "@venue/core";

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

/**
 * scrypt from Node's standard library. No native module to compile, which keeps
 * the Render build simple and fast. Argon2id is a reasonable upgrade later —
 * it goes behind this same port, and nothing above it changes.
 */
export class ScryptPasswordHasher implements PasswordHasher {
  private static readonly PARAMS = { N: 16_384, r: 8, p: 1 };
  private static readonly KEY_LENGTH = 32;

  async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const key = await scrypt(password, salt, ScryptPasswordHasher.KEY_LENGTH, ScryptPasswordHasher.PARAMS);
    const { N, r, p } = ScryptPasswordHasher.PARAMS;

    return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${key.toString("base64")}`;
  }

  async verify(password: string, stored: string): Promise<boolean> {
    const parts = stored.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;

    const [, nRaw, rRaw, pRaw, saltRaw, keyRaw] = parts;
    const N = Number(nRaw);
    const r = Number(rRaw);
    const p = Number(pRaw);
    if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

    const salt = Buffer.from(saltRaw ?? "", "base64");
    const expected = Buffer.from(keyRaw ?? "", "base64");
    if (salt.length === 0 || expected.length === 0) return false;

    const actual = await scrypt(password, salt, expected.length, { N, r, p });
    return timingSafeEqual(actual, expected);
  }
}

/* ------------------------------------------------------------ pass tokens */

interface TokenPayload {
  p: string; // pass id
  u: string; // user id
  n: string; // scan nonce — unique per issued token
  e: number; // expiry, unix seconds
}

/**
 * The QR carries this, not a pass id. It lives ~30 seconds, so a screenshot
 * forwarded to a friend is worthless by the time they reach the door.
 */
export class HmacPassTokenService implements PassTokenService {
  private readonly key: Buffer;

  constructor(secret: string) {
    this.key = Buffer.from(secret, "base64");

    if (this.key.length < 32) {
      // A short key makes the signature forgeable, which means free entry.
      throw new Error(
        "PASS_TOKEN_SECRET must decode to at least 32 bytes. Generate one with: openssl rand -base64 32",
      );
    }
  }

  issue(pass: AccessPass, lifetimeMs: number): string {
    const payload: TokenPayload = {
      p: pass.id,
      u: pass.userId,
      n: randomUUID(),
      e: Math.floor((Date.now() + lifetimeMs) / 1000),
    };

    const body = base64url(Buffer.from(JSON.stringify(payload)));
    return `${body}.${this.sign(body)}`;
  }

  validate(token: string): Result<PassClaims> {
    const [body, signature] = token.split(".");
    if (!body || !signature) return failWith(errors.invalidPassToken);

    const expected = Buffer.from(this.sign(body));
    const provided = Buffer.from(signature);

    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
      return failWith(errors.invalidPassToken);
    }

    let payload: TokenPayload;
    try {
      payload = JSON.parse(fromBase64url(body).toString("utf8")) as TokenPayload;
    } catch {
      return failWith(errors.invalidPassToken);
    }

    const expiresAt = new Date(payload.e * 1000);
    if (expiresAt.getTime() < Date.now()) return failWith(errors.invalidPassToken);

    return ok({ passId: payload.p, userId: payload.u, scanNonce: payload.n, expiresAt });
  }

  private sign(body: string): string {
    return base64url(createHmac("sha256", this.key).update(body).digest());
  }
}

const base64url = (buffer: Buffer): string =>
  buffer.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

const fromBase64url = (value: string): Buffer =>
  Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");

/* ----------------------------------------------------------------- google */

export class GoogleAuthValidator implements GoogleTokenValidator {
  private readonly client: OAuth2Client;

  constructor(private readonly clientId: string) {
    this.client = new OAuth2Client(clientId);
  }

  async validate(idToken: string): Promise<Result<GoogleIdentity>> {
    if (!this.clientId) {
      return fail("provider_unavailable", "Google sign-in is not configured on this server.");
    }

    try {
      // Verifies the signature, the issuer and that the token was minted for us.
      const ticket = await this.client.verifyIdToken({ idToken, audience: this.clientId });
      const payload = ticket.getPayload();

      if (!payload?.email) {
        return failWith(errors.validation("That Google account has no email address."));
      }
      if (!payload.email_verified) {
        return failWith(errors.validation("That Google account has an unverified email address."));
      }

      return ok({
        subjectId: payload.sub,
        email: payload.email,
        displayName: payload.name ?? payload.email,
      });
    } catch {
      return failWith(errors.validation("The Google token could not be verified."));
    }
  }
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class CryptoIdGenerator implements IdGenerator {
  uuid(): string {
    return randomUUID();
  }

  /** randomInt, not Math.random — an OTP a attacker can predict is not an OTP. */
  numericCode(digits: number): string {
    const min = 10 ** (digits - 1);
    return String(randomInt(min, min * 10));
  }
}

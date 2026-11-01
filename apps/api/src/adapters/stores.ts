import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  fail,
  ok,
  type RefreshTokenStore,
  type Result,
  type VerificationCodeStore,
} from "@venue/core";
import { CodeSendLogModel, RefreshTokenModel, VerificationCodeModel } from "../db/models.js";

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

const MAX_ATTEMPTS = 5;

/**
 * Codes are hashed, attempt-capped and expire on their own through a TTL index.
 * A verification code sitting in the database forever is a standing
 * account-takeover risk, so nothing here keeps one.
 */
export class MongoVerificationCodeStore implements VerificationCodeStore {
  async store(purpose: string, subject: string, code: string, ttlMs: number): Promise<void> {
    const expiresAt = new Date(Date.now() + ttlMs);

    await VerificationCodeModel.findOneAndUpdate(
      { purpose, subject },
      { $set: { codeHash: sha256(code), attempts: 0, expiresAt, createdAt: new Date() } },
      { upsert: true },
    );

    await CodeSendLogModel.create({
      purpose,
      subject,
      sentAt: new Date(),
      expiresAt: new Date(Date.now() + 3_600_000),
    });
  }

  async consume(purpose: string, subject: string, code: string): Promise<boolean> {
    // Count the attempt before checking, so brute force burns through the cap.
    const record = await VerificationCodeModel.findOneAndUpdate(
      { purpose, subject },
      { $inc: { attempts: 1 } },
      { new: true },
    );

    if (!record) return false;
    if (record.attempts > MAX_ATTEMPTS) return false;
    if (record.expiresAt.getTime() < Date.now()) return false;

    const expected = Buffer.from(record.codeHash);
    const provided = Buffer.from(sha256(code));
    const matches = expected.length === provided.length && timingSafeEqual(expected, provided);

    if (matches) await VerificationCodeModel.deleteOne({ _id: record._id });
    return matches;
  }

  async sendsInLastHour(purpose: string, subject: string): Promise<number> {
    return CodeSendLogModel.countDocuments({
      purpose,
      subject,
      sentAt: { $gte: new Date(Date.now() - 3_600_000) },
    });
  }
}

/**
 * Refresh tokens are stored hashed and rotated on every use: presenting one
 * invalidates it as the replacement is minted. A stolen token therefore works
 * at most once, and the theft shows up as the real user being signed out.
 */
export class MongoRefreshTokenStore implements RefreshTokenStore {
  async issue(userId: string, ttlMs: number): Promise<string> {
    const token = randomBytes(48).toString("base64url");

    await RefreshTokenModel.create({
      userId,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + ttlMs),
    });

    return token;
  }

  async rotate(token: string, ttlMs: number): Promise<Result<{ userId: string; token: string }>> {
    const existing = await RefreshTokenModel.findOneAndDelete({ tokenHash: sha256(token) });

    if (!existing || existing.expiresAt.getTime() < Date.now()) {
      return fail("unauthorized", "Your session has ended. Please sign in again.");
    }

    const userId = String(existing.userId);
    return ok({ userId, token: await this.issue(userId, ttlMs) });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await RefreshTokenModel.deleteMany({ userId });
  }

  async revoke(token: string): Promise<void> {
    await RefreshTokenModel.deleteOne({ tokenHash: sha256(token) });
  }
}

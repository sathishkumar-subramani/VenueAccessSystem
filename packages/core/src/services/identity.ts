import type { User } from "../domain/entities.js";
import { errors, fail, failWith, ok, type Result } from "../domain/result.js";
import type {
  Clock,
  EmailSender,
  GoogleTokenValidator,
  IdGenerator,
  Logger,
  PasswordHasher,
  SmsSender,
} from "../ports/providers.js";
import type {
  LedgerStore,
  UserRepository,
  VerificationCodeStore,
} from "../ports/repositories.js";

const MAX_OTP_PER_HOUR = 5;
const EMAIL_CODE_TTL_MS = 24 * 60 * 60 * 1000;
const PHONE_CODE_TTL_MS = 10 * 60 * 1000;

const E164 = /^\+[1-9]\d{7,14}$/;

export function normalizePhone(input: string): string | null {
  const trimmed = input.replace(/[\s-()]/g, "");
  return E164.test(trimmed) ? trimmed : null;
}

export interface IdentityDeps {
  users: UserRepository;
  ledger: LedgerStore;
  hasher: PasswordHasher;
  google: GoogleTokenValidator;
  codes: VerificationCodeStore;
  ids: IdGenerator;
  email: EmailSender;
  sms: SmsSender;
  clock: Clock;
  logger: Logger;
}

export class IdentityService {
  constructor(private readonly deps: IdentityDeps) {}

  /** Used by the token refresh path, which has a user id but no password. */
  async userById(id: string): Promise<User | null> {
    return this.deps.users.byId(id);
  }

  async register(input: {
    email: string;
    password: string;
    displayName: string;
  }): Promise<Result<User>> {
    const email = input.email.trim().toLowerCase();

    if (await this.deps.users.byEmail(email)) {
      return failWith(errors.conflict("An account already exists for this email address."));
    }
    if (input.password.length < 8) {
      return failWith(errors.validation("Use at least 8 characters for your password."));
    }

    const walletId = this.deps.ids.uuid();
    const user = await this.deps.users.create({
      email,
      displayName: input.displayName.trim(),
      role: "end_user",
      walletId,
      phoneE164: null,
      emailVerified: false,
      phoneVerified: false,
      googleSubjectId: null,
      passwordHash: await this.deps.hasher.hash(input.password),
    });

    await this.deps.ledger.openWallet(walletId);
    await this.sendEmailCode(user);

    return ok(user);
  }

  async signIn(email: string, password: string): Promise<Result<User>> {
    const found = await this.deps.users.credentialsByEmail(email.trim().toLowerCase());

    // Same message either way: never reveal whether an address is registered.
    const invalid = fail<User>("unauthorized", "That email and password do not match.");
    if (!found?.passwordHash) return invalid;

    return (await this.deps.hasher.verify(password, found.passwordHash))
      ? ok(found.user)
      : invalid;
  }

  async signInWithGoogle(idToken: string): Promise<Result<User>> {
    const identity = await this.deps.google.validate(idToken);
    if (!identity.ok) return failWith(identity.error);

    const existing = await this.deps.users.byGoogleSubject(identity.value.subjectId);
    if (existing) return ok(existing);

    // Signed up with a password earlier under the same address — link, don't duplicate.
    const byEmail = await this.deps.users.byEmail(identity.value.email.toLowerCase());
    if (byEmail) {
      const linked = await this.deps.users.update(byEmail.id, {
        googleSubjectId: identity.value.subjectId,
        emailVerified: true,
      });
      return ok(linked ?? byEmail);
    }

    const walletId = this.deps.ids.uuid();
    const user = await this.deps.users.create({
      email: identity.value.email.toLowerCase(),
      displayName: identity.value.displayName,
      role: "end_user",
      walletId,
      phoneE164: null,
      emailVerified: true, // Google already verified it
      phoneVerified: false,
      googleSubjectId: identity.value.subjectId,
    });

    await this.deps.ledger.openWallet(walletId);
    return ok(user);
  }

  async verifyEmail(email: string, code: string): Promise<Result<true>> {
    const normalized = email.trim().toLowerCase();
    const user = await this.deps.users.byEmail(normalized);
    if (!user) return failWith(errors.notFound("User"));

    if (!(await this.deps.codes.consume("email", normalized, code))) {
      return failWith(errors.validation("That code is invalid or has expired."));
    }

    await this.deps.users.update(user.id, { emailVerified: true });
    return ok(true);
  }

  async resendEmailCode(userId: string): Promise<Result<true>> {
    const user = await this.deps.users.byId(userId);
    if (!user) return failWith(errors.notFound("User"));
    if (user.emailVerified) return ok(true);

    if ((await this.deps.codes.sendsInLastHour("email", user.email)) >= MAX_OTP_PER_HOUR) {
      return fail("rate_limited", "Too many codes requested. Try again in an hour.");
    }

    await this.sendEmailCode(user);
    return ok(true);
  }

  async sendPhoneOtp(userId: string, phoneInput: string): Promise<Result<true>> {
    const phone = normalizePhone(phoneInput);
    if (!phone) {
      return failWith(
        errors.validation("Enter the number in international format, for example +919876543210."),
      );
    }

    const user = await this.deps.users.byId(userId);
    if (!user) return failWith(errors.notFound("User"));

    // OTP endpoints are what gets abused. Cap them per number, not just per account.
    if ((await this.deps.codes.sendsInLastHour("phone", phone)) >= MAX_OTP_PER_HOUR) {
      return fail("rate_limited", "Too many codes requested for this number. Try again in an hour.");
    }

    await this.deps.users.update(user.id, { phoneE164: phone, phoneVerified: false });

    const code = this.deps.ids.numericCode(6);
    await this.deps.codes.store("phone", phone, code, PHONE_CODE_TTL_MS);

    return this.deps.sms.sendOtp(phone, code);
  }

  async verifyPhone(userId: string, code: string): Promise<Result<true>> {
    const user = await this.deps.users.byId(userId);
    if (!user?.phoneE164) return failWith(errors.notFound("Phone number"));

    if (!(await this.deps.codes.consume("phone", user.phoneE164, code))) {
      return failWith(errors.validation("That code is invalid or has expired."));
    }

    await this.deps.users.update(user.id, { phoneVerified: true });
    return ok(true);
  }

  private async sendEmailCode(user: User): Promise<void> {
    const code = this.deps.ids.numericCode(6);
    await this.deps.codes.store("email", user.email, code, EMAIL_CODE_TTL_MS);

    const sent = await this.deps.email.send({
      to: user.email,
      subject: "Your Venue Access verification code",
      html:
        `<p>Hi ${escapeHtml(user.displayName)},</p>` +
        `<p>Your verification code is <strong style="font-size:20px;letter-spacing:3px">${code}</strong></p>` +
        `<p>It expires in 24 hours. If you did not sign up, you can ignore this email.</p>`,
      text: `Your Venue Access verification code is ${code}. It expires in 24 hours.`,
    });

    // A provider outage must not lose the account. The code is already stored,
    // and the user can ask for it again.
    if (!sent.ok) {
      this.deps.logger.error("Verification email failed to send", {
        userId: user.id,
        reason: sent.error.message,
      });
    }
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}

import {
  describePassState,
  entriesRemaining,
  signedValue,
  type AccessPass,
  type LedgerEntry,
  type User,
  type Venue,
} from "@venue/core";
import type { LedgerEntryDto, PassDto, UserDto, VenueDto } from "@venue/shared";

/**
 * The single place entities become responses. Nothing reaches a client except
 * through here, so a credential or an internal field cannot leak by accident.
 */

export const toUserDto = (user: User): UserDto => ({
  id: user.id,
  email: user.email,
  displayName: user.displayName,
  role: user.role,
  emailVerified: user.emailVerified,
  phoneVerified: user.phoneVerified,
  phoneE164: user.phoneE164,
});

export const toVenueDto = (venue: Venue): VenueDto => ({
  id: venue.id,
  name: venue.name,
  typeKey: venue.typeKey,
  city: venue.city,
  addressLine: venue.addressLine,
  plans: venue.plans
    .filter((plan) => plan.isActive)
    .map((plan) => ({ id: plan.id, name: plan.name, cost: plan.cost, config: plan.config })),
});

export const toLedgerDto = (entry: LedgerEntry): LedgerEntryDto => ({
  id: entry.id,
  type: entry.type,
  amount: entry.amount,
  signed: signedValue(entry),
  reason: entry.reason,
  occurredAt: entry.occurredAt.toISOString(),
});

export const toPassDto = (
  pass: AccessPass,
  venue: { name: string; typeKey: string } | null,
  now: Date,
): PassDto => ({
  id: pass.id,
  venueId: pass.venueId,
  venueName: venue?.name ?? "Unknown venue",
  venueTypeKey: venue?.typeKey ?? "",
  validFrom: pass.validFrom.toISOString(),
  validUntil: pass.validUntil.toISOString(),
  maxEntries: pass.maxEntries,
  entriesRemaining: entriesRemaining(pass),
  state: describePassState(pass, now),
  creditsPaid: pass.creditsPaid,
});

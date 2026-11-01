/**
 * Credits are whole numbers. Never floats — 0.1 + 0.2 problems have no place
 * anywhere near a balance. Money going to the payment provider is held in
 * paise for the same reason.
 */
export type Credits = number;

export const PAISE_PER_CREDIT = 100;

export function assertCredits(value: number, what = "credits"): Credits {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${what} must be a non-negative whole number, got ${value}`);
  }
  return value;
}

export const creditsToPaise = (credits: Credits): number => credits * PAISE_PER_CREDIT;

export const paiseToCredits = (paise: number): Credits => Math.floor(paise / PAISE_PER_CREDIT);

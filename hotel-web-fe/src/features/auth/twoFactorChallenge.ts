/**
 * Reading the sign-in second-factor answers off a failed `/auth/login`.
 *
 * The backend answers with stable body codes (never matched on English text,
 * which is translated):
 *
 * - `two_factor_required` — the password was right; the body carries
 *   `mfa_token` (short-lived, single-use; the passkey second factor presents
 *   it) and `available_methods` (`totp`, `passkey`, `backup_code`);
 * - `two_factor_invalid` — the code was wrong and cost a login attempt; the
 *   body carries `attempts_remaining` before the account locks;
 * - `two_factor_expired` — the `mfa_token` a passkey step presented is no
 *   longer live, so the password has to be entered again.
 *
 * Like `twoFactorEnrollment.ts`, the body is read from `details`
 * (`AuthContext` rethrows as `APIError`) or `data` (a raw ky `HTTPError`).
 */
export const TWO_FACTOR_REQUIRED_CODE = 'two_factor_required';
export const TWO_FACTOR_INVALID_CODE = 'two_factor_invalid';
export const TWO_FACTOR_EXPIRED_CODE = 'two_factor_expired';

export type SecondFactorMethod = 'totp' | 'passkey' | 'backup_code';

export interface TwoFactorChallenge {
  /** Empty when an older backend answered without one (no passkey step then). */
  mfaToken: string;
  methods: SecondFactorMethod[];
}

const KNOWN_METHODS: ReadonlySet<string> = new Set(['totp', 'passkey', 'backup_code']);

function errorBody(error: unknown): Record<string, unknown> | null {
  if (!error || typeof error !== 'object') {
    return null;
  }
  for (const candidate of [
    (error as { details?: unknown }).details,
    (error as { data?: unknown }).data,
  ]) {
    if (candidate && typeof candidate === 'object') {
      return candidate as Record<string, unknown>;
    }
  }
  return null;
}

function hasCode(error: unknown, code: string): boolean {
  return errorBody(error)?.code === code;
}

/**
 * The second-factor challenge a sign-in was answered with, or `null` when the
 * failure was something else. A backend from before the stable code (or a
 * stale cached client talking to one) still says "2FA required" in its
 * message; that reads as an authenticator-only challenge.
 */
export function readTwoFactorChallenge(error: unknown): TwoFactorChallenge | null {
  const body = errorBody(error);
  if (body?.code === TWO_FACTOR_REQUIRED_CODE) {
    const methods = Array.isArray(body.available_methods)
      ? (body.available_methods.filter(
          (method): method is SecondFactorMethod =>
            typeof method === 'string' && KNOWN_METHODS.has(method)
        ) as SecondFactorMethod[])
      : [];
    return {
      mfaToken: typeof body.mfa_token === 'string' ? body.mfa_token : '',
      // Never leave the step with nothing to offer.
      methods: methods.some((method) => method !== 'backup_code')
        ? methods
        : ['totp', 'backup_code'],
    };
  }
  const message = error instanceof Error ? error.message : '';
  if (message.includes('2FA required') || message.includes('TOTP code')) {
    return { mfaToken: '', methods: ['totp', 'backup_code'] };
  }
  return null;
}

/** Attempts left before lockout after a wrong code, or `null` when the
 *  failure was not a wrong code. */
export function readTwoFactorAttemptsRemaining(error: unknown): number | null {
  const body = errorBody(error);
  if (body?.code !== TWO_FACTOR_INVALID_CODE) {
    return null;
  }
  const remaining = body.attempts_remaining;
  return typeof remaining === 'number' && Number.isFinite(remaining) ? Math.max(0, remaining) : null;
}

export function isTwoFactorInvalid(error: unknown): boolean {
  return hasCode(error, TWO_FACTOR_INVALID_CODE);
}

export function isTwoFactorExpired(error: unknown): boolean {
  return hasCode(error, TWO_FACTOR_EXPIRED_CODE);
}

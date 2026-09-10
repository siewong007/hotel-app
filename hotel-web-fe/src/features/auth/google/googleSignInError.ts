/**
 * Turns a failed `loginWithGoogle` into the sentence a guest should read.
 *
 * The branching is on the status code AuthContext preserves, never on message
 * text, which can be reworded server-side without breaking this check. Shared
 * because every Google door — the button on `/login`, the One Tap prompt on the
 * public pages — hits the same endpoint and can fail the same four ways.
 */

import { errorMessage } from '../../../utils/errorMessage';

type Translate = (key: string) => string;

/**
 * Whether this failure is "a first-time Google identity arrived with no consent
 * payload", which is the backend's signal that the account does not exist yet
 * and creating it needs the notice agreed to first.
 *
 * Matches on the status plus the word the backend uses, because 400 alone also
 * covers ordinary validation failures. Shared so the message mapper and the
 * caller that recovers from it cannot drift apart on what the signal is.
 */
export function isGoogleConsentRequired(error: unknown): boolean {
  const status = (error as { statusCode?: number }).statusCode;
  if (status !== 400) return false;
  return /consent/i.test(errorMessage(error, ''));
}

export function googleSignInErrorMessage(error: unknown, t: Translate): string {
  const message = errorMessage(error, t('login.googleFailed'));
  const status = (error as { statusCode?: number }).statusCode;

  // 503 is a missing/misconfigured client id or a Google API outage — see
  // hotel-app-be/src/services/google_identity.rs.
  if (status === 503) return t('login.googleUnavailable');
  // 409 is ensure_active_google_guest rejecting a staff or deactivated
  // account. The raw backend sentence does not say what to do instead.
  if (status === 409) return t('login.googleStaffOnly');
  // 400-consent reaching a message at all means the recovery step failed or was
  // never offered — One Tap now answers it with the notice in a dialog. The
  // sign-in page always sends consents, so this is the last-resort sentence.
  if (isGoogleConsentRequired(error)) return t('login.googleNeedsAccount');
  return message;
}

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

export function googleSignInErrorMessage(error: unknown, t: Translate): string {
  const message = errorMessage(error, t('login.googleFailed'));
  const status = (error as { statusCode?: number }).statusCode;

  // 503 is a missing/misconfigured client id or a Google API outage — see
  // hotel-app-be/src/services/google_identity.rs.
  if (status === 503) return t('login.googleUnavailable');
  // 409 is ensure_active_google_guest rejecting a staff or deactivated
  // account. The raw backend sentence does not say what to do instead.
  if (status === 409) return t('login.googleStaffOnly');
  // 400-consent means a first-time Google identity arrived through a door that
  // sends no consent payload — only One Tap and automatic sign-in do, because
  // neither can show the notice that governs account creation. The sign-in page
  // can, so that is where this points.
  if (status === 400 && /consent/i.test(message)) return t('login.googleNeedsAccount');
  return message;
}

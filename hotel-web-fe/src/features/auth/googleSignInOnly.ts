/**
 * The backend refuses a password sign-in on a passwordless (Google sign-in)
 * account with a 401 carrying exactly this text
 * (`auth::service::GOOGLE_SIGN_IN_ONLY_MESSAGE`). Matched here so the sign-in
 * form can show a translated hint instead of the raw English copy.
 */
export const GOOGLE_SIGN_IN_ONLY_MESSAGE = 'This account uses Google sign-in';

export function isGoogleSignInOnly(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const message = (err as { message?: unknown }).message;
  return typeof message === 'string' && message.trim() === GOOGLE_SIGN_IN_ONLY_MESSAGE;
}

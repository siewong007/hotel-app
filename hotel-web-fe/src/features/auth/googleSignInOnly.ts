/**
 * The backend refuses a password sign-in on a passwordless (Google sign-in)
 * account with a 401 carrying exactly this text
 * (`auth::service::GOOGLE_SIGN_IN_ONLY_MESSAGE`). Matched here so the sign-in
 * form can show a translated hint instead of the raw English copy. The API
 * error renderer polishes messages into sentences (adds a trailing period),
 * so that punctuation is ignored.
 */
export const GOOGLE_SIGN_IN_ONLY_MESSAGE = 'This account uses Google sign-in';

export function isGoogleSignInOnly(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const message = (err as { message?: unknown }).message;
  return (
    typeof message === 'string' &&
    message.trim().replace(/\.$/, '') === GOOGLE_SIGN_IN_ONLY_MESSAGE
  );
}

/**
 * Where a guest may be sent after signing in, when a `redirect` query parameter
 * asks for somewhere other than the portal dashboard.
 *
 * This is an allowlist, not a validator. The value arrives from the URL, so
 * anything outside this set is discarded rather than navigated to — that is
 * what stops a crafted `?redirect=` from turning the sign-in pages into an
 * open redirect.
 */
const ALLOWED_GUEST_REDIRECTS = new Set([
  '/guest-portal?view=booking',
  // Older links and bookmarks; the route itself redirects to the line above.
  '/portal/book',
]);

/** The booking flow, as a `redirect` value. */
export const GUEST_BOOKING_REDIRECT = '/guest-portal?view=booking';

/** The redirect to honour, or `null` to fall back to the portal dashboard. */
export function safeGuestRedirect(value: string | null | undefined): string | null {
  return value && ALLOWED_GUEST_REDIRECTS.has(value) ? value : null;
}

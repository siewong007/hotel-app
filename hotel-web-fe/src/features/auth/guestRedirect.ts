import { returnToPreviousPage } from '../../utils/returnNavigation';
import { authRouteDefinitions } from '../../navigation/routeRegistry';

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

/**
 * Where a staff member may be sent after signing in — the destination a
 * ProtectedRoute carried in `?redirect=` when it bounced them to login.
 * Allowlisted to registered auth paths so a crafted value lands on the
 * dashboard rather than an external URL or a dead route. Any query string
 * the attempted page had is preserved.
 */
export function safeStaffRedirect(value: string | null | undefined): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return null;
  const path = value.split('?')[0].split('#')[0];
  return authRouteDefinitions.some((route) => route.path === path) ? value : null;
}

/**
 * Sends the reader back out of a sign-in or registration page.
 *
 * A guest who reached sign-in from the booking flow carries that intent in
 * `?redirect=`, and returning them anywhere else abandons the booking they were
 * part-way through — the same failure the redirect parameter exists to prevent
 * on the way in. So an allowlisted redirect wins over browser history. Every
 * allowlisted destination is a public route, so this cannot bounce a
 * signed-out reader back into the sign-in page it just left.
 *
 * Everything else falls through to ordinary back-navigation, which lands on
 * the hotel home page when the reader arrived directly — from a bookmark, an
 * email link, or the session-expiry redirect, none of which leave anything
 * useful in history.
 */
export function returnFromAuthPage(
  navigate: (to: string) => void,
  redirectParam: string | null | undefined
): void {
  const booking = safeGuestRedirect(redirectParam);
  if (booking) {
    navigate(booking);
    return;
  }
  returnToPreviousPage(navigate);
}

/**
 * Booking-scoped access token for the unauthenticated pre-check-in flow.
 *
 * Distinct from the guest-portal session token (`portalTokenStore.ts`) and
 * from the staff access token. Kept in sessionStorage so it survives a reload
 * of `/guest-checkin/*` without being placed in the page URL (history,
 * Referer, access logs).
 */

const BOOKING_ACCESS_TOKEN_KEY = 'bookingAccessToken';

export function getBookingAccessToken(): string | null {
  try {
    return window.sessionStorage.getItem(BOOKING_ACCESS_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setBookingAccessToken(token: string): void {
  try {
    window.sessionStorage.setItem(BOOKING_ACCESS_TOKEN_KEY, token);
  } catch {
    // sessionStorage unavailable — the token lives only in memory this tab.
  }
}

export function clearBookingAccessToken(): void {
  try {
    window.sessionStorage.removeItem(BOOKING_ACCESS_TOKEN_KEY);
  } catch {
    // no-op
  }
}

/** Prefer a `?token=` query (legacy emailed links), persist it, then fall back
 *  to sessionStorage so later pages can omit the query string. */
export function captureBookingAccessToken(searchParams: URLSearchParams): string | null {
  const fromQuery = searchParams.get('token')?.trim();
  if (fromQuery) {
    setBookingAccessToken(fromQuery);
    return fromQuery;
  }
  return getBookingAccessToken();
}

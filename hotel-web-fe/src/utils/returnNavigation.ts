/**
 * Where a "Back" control goes on a page that can be reached from anywhere.
 *
 * The legal documents, the sign-in page and the registration page are all
 * entered from many directions: an in-app link, a consent checkbox, a bookmark,
 * an email link, or a session-expiry redirect. `history.back()` is safe only
 * when the entry behind this one is another page of this same document —
 * and two ways of arriving here make that untrue in opposite ways:
 *
 * - A `location.replace` bounce off a protected route swaps the guarded page's
 *   entry for this one, so a same-origin `document.referrer` names an entry
 *   that no longer exists — `back()` silently does nothing on a fresh tab.
 * - A push bounce (session expiry navigates to `/login` without `replace`)
 *   leaves the guarded page live one step back — `back()` reloads it, its
 *   guard bounces the reader forward to sign-in again, and the control looks
 *   like it never fired.
 *
 * `document.referrer` cannot tell either apart: it names the document that
 * loaded this page, not what this window's history holds. The router's own
 * index can — TanStack History stamps `__TSR_index` 0 on a fresh document
 * load and counts up on each in-app push, so a value above 0 means a real
 * page of this document sits behind the current one. A reader who arrived by
 * document navigation (the marketing site, an emailed link, a replaced bounce)
 * gets the explicit fallback instead — which resolves to the hotel landing
 * page, the same place plain back-navigation would have gone.
 */
export function hasInAppHistory(): boolean {
  const index = (window.history.state as { __TSR_index?: number } | null)?.__TSR_index;
  return typeof index === 'number' && index > 0;
}

/**
 * Returns the reader to where they came from, or to `fallback` when they
 * arrived with no in-app history.
 */
export function returnToPreviousPage(
  navigate: (to: string) => void,
  fallback = '/'
): void {
  if (hasInAppHistory()) {
    window.history.back();
    return;
  }
  navigate(fallback);
}

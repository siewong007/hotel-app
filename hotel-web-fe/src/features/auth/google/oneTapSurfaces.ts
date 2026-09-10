/**
 * Which guest pages may show the One Tap prompt.
 *
 * One Tap appears without anyone asking for it, so where it may appear is a
 * policy decision, not a rendering detail — hence an allowlist that can be read
 * and tested on its own.
 *
 * Three rules shape the list:
 *
 * 1. Guest bundle only. This module is reachable only from `guest.html`
 *    (see `guest/guestDocumentPaths.ts`); the staff ERP never loads it. A
 *    front-desk browser therefore cannot be shown "Continue as <last guest>",
 *    which is the same shared-machine leak that `disableAutoSelect()` on logout
 *    exists to close.
 * 2. Not on `/login` or `/register`. Those already carry the Google button, and
 *    a prompt over a page whose whole purpose is signing in is noise.
 * 3. Only pages a signed-out visitor actually reaches. The portal dashboard
 *    bounces to `/login` before it renders, so prompting there is dead code;
 *    what is left is the offers page and the anonymous booking flow, where an
 *    account is worth something to the guest (member rates, a saved profile).
 */

/** Which allowlisted page raised the prompt, or `null` for everywhere else. */
export type GoogleOneTapSurface = 'offers' | 'booking';

function pathnameOf(path: string): string {
  const cut = path.split('?')[0] ?? path;
  if (cut.length > 1 && cut.endsWith('/')) return cut.slice(0, -1);
  return cut || '/';
}

export function googleOneTapSurface(
  pathname: string,
  search: string
): GoogleOneTapSurface | null {
  const path = pathnameOf(pathname);
  if (path === '/offers' || path.startsWith('/offers/')) return 'offers';
  // The older booking URL; the route itself redirects to the line below.
  if (path === '/portal/book') return 'booking';
  if (path === '/guest-portal' || path === '/portal') {
    const query = search.startsWith('?') ? search : search ? `?${search}` : '';
    return new URLSearchParams(query).get('view') === 'booking' ? 'booking' : null;
  }
  return null;
}

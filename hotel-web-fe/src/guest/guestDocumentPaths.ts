/**
 * Paths served by the guest HTML document (`guest.html`), not the staff ERP
 * (`index.html`). Nginx and the Vite dev server use this list so a Gmail pay
 * link never boots the admin graph. The origin host is whatever the VPS
 * already is — these are path-only.
 */

const GUEST_EXACT_PATHS = new Set([
  '/login',
  '/register',
  '/verify-email',
  '/complete-profile',
]);

const GUEST_PATH_PREFIXES = [
  '/guest-checkin',
  '/guest-portal',
  '/portal',
  '/offers',
  '/legal',
  '/unsubscribe',
] as const;

function pathnameOf(path: string): string {
  const cut = path.split('?')[0] ?? path;
  if (cut.length > 1 && cut.endsWith('/')) {
    return cut.slice(0, -1);
  }
  return cut || '/';
}

export function isGuestDocumentPath(pathname: string): boolean {
  const path = pathnameOf(pathname);
  if (GUEST_EXACT_PATHS.has(path)) return true;
  return GUEST_PATH_PREFIXES.some(
    prefix => path === prefix || path.startsWith(`${prefix}/`),
  );
}

/**
 * Guest URLs that must render without waiting on `/api/auth/refresh`.
 * The signed-in portal dashboard still waits; anonymous booking does not.
 */
export function isPublicGuestPath(pathname: string, search: string): boolean {
  const path = pathnameOf(pathname);
  const query = search.startsWith('?') ? search : search ? `?${search}` : '';
  if (path === '/guest-portal' || path === '/portal') {
    const params = new URLSearchParams(query);
    return params.get('view') === 'booking';
  }
  if (path === '/portal/book') return true;
  if (GUEST_EXACT_PATHS.has(path)) return true;
  return (
    path === '/guest-checkin' ||
    path.startsWith('/guest-checkin/') ||
    path === '/offers' ||
    path.startsWith('/offers/') ||
    path.startsWith('/legal/') ||
    path.startsWith('/unsubscribe/')
  );
}

export function shouldUseDocumentNavigation(
  toPathname: string,
  fromPathname: string,
): boolean {
  return isGuestDocumentPath(pathnameOf(toPathname)) !== isGuestDocumentPath(pathnameOf(fromPathname));
}

export function hrefFromAppPath(to: string): string {
  const url = new URL(to, 'https://guest.invalid');
  return `${url.pathname}${url.search}${url.hash}`;
}

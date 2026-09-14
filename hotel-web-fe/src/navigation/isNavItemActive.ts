// src/navigation/isNavItemActive.ts
import type { AppRouteDefinition } from './routeRegistry';

/**
 * Active-nav matcher. Dashboard is the only aliased destination: `/admin-portal`
 * renders the same page as `/`, so both highlight the Overview item. Guest
 * Relations is a nested workspace: the directory entry owns the
 * `/guest-relations/guests` subtree (list + Guest 360), and the overview entry
 * lights for the rest (`/guest-relations`, `/guest-relations/follow-ups`), so
 * exactly one item is active anywhere under it. Everything else is exact
 * pathname equality — nav routes are flat and query strings never participate
 * (location.pathname excludes them already).
 */
export function isNavItemActive(pathname: string, route: AppRouteDefinition): boolean {
  if (route.id === 'dashboard') {
    return pathname === '/' || pathname === '/admin-portal';
  }
  if (route.id === 'guest-directory') {
    return pathname === route.path || pathname.startsWith(`${route.path}/`);
  }
  if (route.id === 'guest-relations') {
    return (
      pathname === route.path ||
      (pathname.startsWith(`${route.path}/`) && !pathname.startsWith('/guest-relations/guests'))
    );
  }
  return pathname === route.path;
}

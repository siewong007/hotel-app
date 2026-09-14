// src/navigation/isNavItemActive.ts
import type { AppRouteDefinition } from './routeRegistry';

/**
 * Active-nav matcher. Dashboard is the only aliased destination: `/admin-portal`
 * renders the same page as `/`, so both highlight the Overview item. Guest
 * Relations is the only nested workspace: its nav path `/guest-relations` is a
 * parent of the pages that live one level down (`/guest-relations/guests`,
 * `/guest-relations/guests/{id}`, `/guest-relations/follow-ups`), so the entry
 * lights up for the whole subtree. Everything else is exact pathname equality —
 * nav routes are flat and query strings never participate (location.pathname
 * excludes them already).
 */
export function isNavItemActive(pathname: string, route: AppRouteDefinition): boolean {
  if (route.id === 'dashboard') {
    return pathname === '/' || pathname === '/admin-portal';
  }
  if (route.id === 'guest-relations') {
    return pathname === route.path || pathname.startsWith(`${route.path}/`);
  }
  return pathname === route.path;
}

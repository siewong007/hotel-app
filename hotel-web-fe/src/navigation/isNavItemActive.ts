// src/navigation/isNavItemActive.ts
import type { AppRouteDefinition } from './routeRegistry';

/**
 * Active-nav matcher. Dashboard is the only aliased destination: `/admin-portal`
 * renders the same page as `/`, so both highlight the Overview item. Everything
 * else is exact pathname equality — nav routes are flat and query strings never
 * participate (location.pathname excludes them already).
 */
export function isNavItemActive(pathname: string, route: AppRouteDefinition): boolean {
  if (route.id === 'dashboard') {
    return pathname === '/' || pathname === '/admin-portal';
  }
  return pathname === route.path;
}

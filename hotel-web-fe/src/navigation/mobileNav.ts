import type { AppRouteDefinition } from './routeRegistry';

/**
 * Picks the staff bottom-navigation destinations from the caller's
 * role-visible routes. Preferred order: Overview, Bookings, Guests, then the
 * Ops slot (Rooms first — it is the operational truth; Housekeeping when the
 * user can't manage rooms). Staff missing a preferred destination get the
 * slots filled by the next visible routes in nav order, so the bar always
 * shows up to four destinations plus More. Everything else lives in the
 * More sheet.
 */
export function mobileNavItems(visible: AppRouteDefinition[]): AppRouteDefinition[] {
  const byId = new Map(visible.map((r) => [r.id, r]));
  const picked: AppRouteDefinition[] = [];
  const take = (id: string) => {
    const route = byId.get(id);
    if (route && !picked.includes(route)) picked.push(route);
  };

  take('dashboard');
  take('bookings');
  take('guest-config');
  take('room-management');
  take('housekeeping');

  if (picked.length < 4) {
    for (const route of visible) {
      if (picked.length >= 4) break;
      if (!picked.includes(route)) picked.push(route);
    }
  }
  return picked.slice(0, 4);
}

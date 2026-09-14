import { describe, expect, it } from 'vitest';
import { mobileNavItems } from './mobileNav';
import { navigationRouteDefinitions } from './routeRegistry';

const byId = (id: string) => navigationRouteDefinitions.filter((r) => r.id === id);
const ids = (routes: ReturnType<typeof mobileNavItems>) => routes.map((r) => r.id);

describe('mobileNavItems', () => {
  it('returns the preferred four destinations for a full-access user', () => {
    expect(ids(mobileNavItems(navigationRouteDefinitions))).toEqual([
      'dashboard',
      'bookings',
      'guest-config',
      'room-management',
    ]);
  });

  it('gives the Ops slot to housekeeping when rooms are inaccessible', () => {
    const visible = navigationRouteDefinitions.filter((r) =>
      ['dashboard', 'housekeeping', 'notifications', 'help'].includes(r.id),
    );
    expect(ids(mobileNavItems(visible))).toEqual([
      'dashboard',
      'housekeeping',
      'notifications',
      'help',
    ]);
  });

  it('never exceeds four destinations', () => {
    expect(mobileNavItems(navigationRouteDefinitions).length).toBeLessThanOrEqual(4);
  });

  it('returns what it can when almost nothing is visible', () => {
    expect(ids(mobileNavItems(byId('dashboard')))).toEqual(['dashboard']);
  });
});

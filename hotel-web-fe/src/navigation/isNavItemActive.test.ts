// src/navigation/isNavItemActive.test.ts
import { describe, expect, it } from 'vitest';
import { isNavItemActive } from './isNavItemActive';
import type { AppRouteDefinition } from './routeRegistry';

const route = (over: Partial<AppRouteDefinition>): AppRouteDefinition => ({
  id: 'x', path: '/x', component: {} as never, animationType: 'fade',
  visibility: 'auth', ...over,
});

describe('isNavItemActive', () => {
  it('matches exact paths', () => {
    expect(isNavItemActive('/bookings', route({ path: '/bookings' }))).toBe(true);
    expect(isNavItemActive('/bookings/', route({ path: '/bookings' }))).toBe(false);
    expect(isNavItemActive('/book', route({ path: '/bookings' }))).toBe(false);
  });

  it('treats /admin-portal and / as the dashboard', () => {
    const dash = route({ id: 'dashboard', path: '/' });
    expect(isNavItemActive('/', dash)).toBe(true);
    expect(isNavItemActive('/admin-portal', dash)).toBe(true);
    expect(isNavItemActive('/bookings', dash)).toBe(false);
  });
});

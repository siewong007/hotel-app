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

  it('splits the guest-relations workspace between overview and directory', () => {
    const gr = route({ id: 'guest-relations', path: '/guest-relations' });
    const dir = route({ id: 'guest-directory', path: '/guest-relations/guests' });
    // Overview owns the landing and the follow-ups queue.
    expect(isNavItemActive('/guest-relations', gr)).toBe(true);
    expect(isNavItemActive('/guest-relations/follow-ups', gr)).toBe(true);
    // The directory entry owns the list + Guest 360 subtree.
    expect(isNavItemActive('/guest-relations/guests', dir)).toBe(true);
    expect(isNavItemActive('/guest-relations/guests/7', dir)).toBe(true);
    // …and the overview does not double-light there.
    expect(isNavItemActive('/guest-relations/guests', gr)).toBe(false);
    expect(isNavItemActive('/guest-relations/guests/7', gr)).toBe(false);
    expect(isNavItemActive('/guest-relations', dir)).toBe(false);
    expect(isNavItemActive('/guest-relations/follow-ups', dir)).toBe(false);
    // Prefix-lookalikes outside the subtree must not match.
    expect(isNavItemActive('/guest-relations-old', gr)).toBe(false);
    expect(isNavItemActive('/support', gr)).toBe(false);
    // The exception is scoped to the route ids — other entries keep
    // exact-match semantics even at the same path shape.
    expect(isNavItemActive('/guest-relations/guests', route({ path: '/guest-relations' }))).toBe(false);
    expect(isNavItemActive('/guest-relations', route({ path: '/guest-relations/guests' }))).toBe(false);
  });
});

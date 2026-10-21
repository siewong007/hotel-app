import { describe, expect, it } from 'vitest';
import { accessFor, holdsPermission, policyAdmits, type PageRule } from './routeAccess';

const rule = (
  required_permissions: string[],
  required_roles: string[] = [],
  excluded_roles: string[] = [],
): PageRule => ({ required_permissions, required_roles, excluded_roles });

describe('holdsPermission', () => {
  const held = new Set(['rooms:read', 'bookings:manage']);

  it('matches a held permission, ignoring case and spaces', () => {
    expect(holdsPermission(held, 'rooms:read')).toBe(true);
    expect(holdsPermission(held, ' Rooms:Read ')).toBe(true);
    expect(holdsPermission(held, 'rooms:update')).toBe(false);
  });

  it('treats <resource>:manage as every other action on that resource', () => {
    expect(holdsPermission(held, 'bookings:create')).toBe(true);
    expect(holdsPermission(held, 'bookings:manage')).toBe(true);
    expect(holdsPermission(held, 'rooms:manage')).toBe(false);
  });
});

describe('policyAdmits', () => {
  const frontDesk = accessFor(['bookings:read', 'rooms:read'], ['receptionist']);

  it('admits everyone when the rule names no permission or role', () => {
    expect(policyAdmits(rule([]), accessFor([], []))).toBe(true);
  });

  it('admits on any one listed permission', () => {
    expect(policyAdmits(rule(['audit:read', 'rooms:read']), frontDesk)).toBe(true);
    expect(policyAdmits(rule(['audit:read']), frontDesk)).toBe(false);
  });

  it('admits on a listed role when no listed permission is held', () => {
    expect(policyAdmits(rule(['audit:read'], ['receptionist']), frontDesk)).toBe(true);
  });

  it('needs one of the roles when the rule lists only roles', () => {
    expect(policyAdmits(rule([], ['manager']), frontDesk)).toBe(false);
    expect(policyAdmits(rule([], ['Receptionist']), frontDesk)).toBe(true);
  });

  it('refuses an excluded role even when a permission admits', () => {
    expect(policyAdmits(rule(['rooms:read'], [], ['receptionist']), frontDesk)).toBe(false);
    expect(policyAdmits(rule([], [], ['receptionist']), frontDesk)).toBe(false);
  });
});

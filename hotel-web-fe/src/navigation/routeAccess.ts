/**
 * Who may open a page, decided from its route access policy.
 *
 * `ProtectedRoute` applies this before rendering a page, and the Access
 * Control page's rule editor uses it to preview who a draft rule admits, so
 * the preview cannot drift from the real check. The backend mirrors it in
 * `hotel-app-be/src/modules/rbac/service.rs` (`page_rule_admits`) to stop an
 * edit to the Access Control page's own rule from locking out its editor.
 */

import type { RouteAccessPolicy } from '../types';

/** The fields of a route policy that decide who may open its page. */
export type PageRule = Pick<RouteAccessPolicy, 'required_permissions' | 'required_roles' | 'excluded_roles'>;

export interface AccessCheck {
  hasPermission: (permission: string) => boolean;
  hasRole: (role: string) => boolean;
}

export const normalizeAccessValue = (value: string) => value.trim().toLowerCase();

/**
 * Whether `held` (normalized names) grants `permission`. Holding
 * `<resource>:manage` implies every other action on that resource.
 */
export function holdsPermission(held: ReadonlySet<string>, permission: string): boolean {
  const wanted = normalizeAccessValue(permission);
  if (held.has(wanted)) {
    return true;
  }

  const [resource, action] = wanted.split(':');
  return Boolean(resource && action && action !== 'manage' && held.has(`${resource}:manage`));
}

/** An access check for someone holding exactly these permissions and roles. */
export function accessFor(permissions: Iterable<string>, roles: Iterable<string>): AccessCheck {
  const heldPermissions = new Set(Array.from(permissions, normalizeAccessValue));
  const heldRoles = new Set(Array.from(roles, normalizeAccessValue));
  return {
    hasPermission: (permission) => holdsPermission(heldPermissions, permission),
    hasRole: (role) => heldRoles.has(normalizeAccessValue(role)),
  };
}

/**
 * Whether a page rule lets this person open the page. Any listed permission or
 * any listed role admits; a rule that lists neither admits everyone; an
 * excluded role always refuses.
 */
export function policyAdmits(rule: PageRule, access: AccessCheck): boolean {
  const permissions = rule.required_permissions;
  const roles = rule.required_roles;

  if (permissions.length > 0) {
    const admitted =
      permissions.some((permission) => access.hasPermission(permission)) ||
      roles.some((role) => access.hasRole(role));
    if (!admitted) return false;
  } else if (roles.length > 0 && !roles.some((role) => access.hasRole(role))) {
    return false;
  }

  return !rule.excluded_roles.some((role) => access.hasRole(role));
}

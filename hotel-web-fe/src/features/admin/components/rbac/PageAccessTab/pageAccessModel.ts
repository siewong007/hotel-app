import type { Permission, Role, RouteAccessPolicy, RouteAccessPolicyInput } from '../../../../../types';
import {
  authRouteDefinitions,
  canAccessNavigationRoute,
  FILE_ROUTE_POLICY_IDS,
  type AppRouteDefinition,
  type NavGroup,
} from '../../../../../navigation/routeRegistry';
import { NAV_GROUP_ORDER } from '../../../../../navigation/navGroups';
import { accessFor, policyAdmits, type AccessCheck } from '../../../../../navigation/routeAccess';
import type { RolePermissionMap } from '../types';

/** The lists a page rule is made of; everything else on a policy is kept as stored. */
export const RULE_FIELDS = [
  'required_permissions',
  'required_roles',
  'excluded_roles',
  'nav_permissions',
  'nav_roles',
  'nav_excluded_roles',
] as const;

export type RuleField = (typeof RULE_FIELDS)[number];
export type RuleDraft = Pick<RouteAccessPolicy, RuleField>;

/** The Access Control page itself: a rule that locks its editor out of it can't be undone from the app. */
export const ACCESS_CONTROL_ROUTE_ID = 'rbac';

export interface PageAccessRow {
  policy: RouteAccessPolicy;
  /** The registry page named after this policy, or the first one it gates. */
  route?: AppRouteDefinition;
  /** Menu entries this policy decides (one policy can back several). */
  menuRoutes: AppRouteDefinition[];
  group: NavGroup | 'other';
}

export interface RoleCheck {
  role: Role;
  access: AccessCheck;
}

export interface RuleOutcome {
  canOpen: Role[];
  inMenu: Role[];
}

/**
 * One row per policy that some page checks, in sidebar order: menu pages by
 * menu group, then pages reached only from links. Stored policies no page
 * checks (left behind by pages that now redirect) are left out, since editing
 * them would change nothing.
 */
export function buildPageAccessRows(
  policies: RouteAccessPolicy[],
  routes: AppRouteDefinition[] = authRouteDefinitions,
  filePolicyIds: readonly string[] = FILE_ROUTE_POLICY_IDS,
): PageAccessRow[] {
  const policyIdOf = (route: AppRouteDefinition) => route.policyId ?? route.id;
  const checked = new Set([...routes.map(policyIdOf), ...filePolicyIds]);

  const rows = policies
    .filter((policy) => checked.has(policy.route_id))
    .map((policy): PageAccessRow => {
      const gated = routes.filter((route) => policyIdOf(route) === policy.route_id);
      const menuRoutes = gated.filter((route) => route.navGroup);
      return {
        policy,
        route: gated.find((route) => route.id === policy.route_id) ?? gated[0],
        menuRoutes,
        group: menuRoutes[0]?.navGroup ?? 'other',
      };
    });

  const groupRank = (row: PageAccessRow) =>
    row.group === 'other' ? NAV_GROUP_ORDER.length : NAV_GROUP_ORDER.indexOf(row.group);
  const routeRank = (row: PageAccessRow) =>
    row.menuRoutes[0] ? routes.indexOf(row.menuRoutes[0]) : routes.length;

  return rows.sort(
    (a, b) =>
      groupRank(a) - groupRank(b) ||
      routeRank(a) - routeRank(b) ||
      a.policy.route_id.localeCompare(b.policy.route_id)
  );
}

/** What each role holds, as the access check the app would run for someone with only that role. */
export function roleChecksFor(
  roles: Role[],
  permissions: Permission[],
  rolePermissionMap: RolePermissionMap
): RoleCheck[] {
  const nameById = new Map(permissions.map((permission) => [permission.id, permission.name]));
  return roles.map((role) => {
    const held = Array.from(rolePermissionMap[role.id] ?? [], (id) => nameById.get(id)).filter(
      (name): name is string => Boolean(name)
    );
    return { role, access: accessFor(held, [role.name]) };
  });
}

/** Which roles a rule lets open the page, and which see it in the menu. */
export function ruleOutcome(row: PageAccessRow, draft: RuleDraft, roleChecks: RoleCheck[]): RuleOutcome {
  const policy: RouteAccessPolicy = { ...row.policy, ...draft };
  const canOpen = roleChecks.filter(({ access }) => policyAdmits(draft, access)).map(({ role }) => role);
  const inMenu = roleChecks
    .filter(({ access }) =>
      row.menuRoutes.some((route) =>
        canAccessNavigationRoute(route, { ...access, getRoutePolicy: () => policy })
      )
    )
    .map(({ role }) => role);
  return { canOpen, inMenu };
}

export function draftFrom(policy: RouteAccessPolicy): RuleDraft {
  return {
    required_permissions: [...policy.required_permissions],
    required_roles: [...policy.required_roles],
    excluded_roles: [...policy.excluded_roles],
    nav_permissions: [...policy.nav_permissions],
    nav_roles: [...policy.nav_roles],
    nav_excluded_roles: [...policy.nav_excluded_roles],
  };
}

export function draftChanged(policy: RouteAccessPolicy, draft: RuleDraft): boolean {
  return RULE_FIELDS.some(
    (field) =>
      policy[field].length !== draft[field].length ||
      policy[field].some((value, index) => value !== draft[field][index])
  );
}

/** The full replacement the API takes: the edited lists plus the stored menu metadata. */
export function inputFrom(policy: RouteAccessPolicy, draft: RuleDraft): RouteAccessPolicyInput {
  return {
    nav_label: policy.nav_label,
    nav_group: policy.nav_group,
    is_navigation: policy.is_navigation,
    ...draft,
  };
}

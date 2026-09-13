import type { AppRouteDefinition, NavGroup } from './routeRegistry';

/** Sidebar section order. Single-item groups render without a heading. */
export const NAV_GROUP_ORDER: readonly NavGroup[] = [
  'overview', 'operations', 'finance', 'engagement',
  'property', 'insights', 'administration', 'utility',
];

/** Groups rendered as bare items (no uppercase heading). */
export const LABEL_LESS_GROUPS: ReadonlySet<NavGroup> = new Set([
  'overview', 'insights', 'utility',
]);

export interface NavSection {
  group: NavGroup;
  items: AppRouteDefinition[];
  labeled: boolean;
}

export function navSections(items: AppRouteDefinition[]): NavSection[] {
  return NAV_GROUP_ORDER
    .map((group) => ({
      group,
      items: items.filter((i) => i.navGroup === group),
      labeled: !LABEL_LESS_GROUPS.has(group),
    }))
    .filter((s) => s.items.length > 0);
}

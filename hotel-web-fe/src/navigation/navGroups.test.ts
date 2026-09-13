import { describe, expect, it } from 'vitest';
import { LABEL_LESS_GROUPS, NAV_GROUP_ORDER, navSections } from './navGroups';
import type { AppRouteDefinition } from './routeRegistry';

const item = (id: string, navGroup: AppRouteDefinition['navGroup']) =>
  ({ id, path: `/${id}`, navGroup }) as AppRouteDefinition;

describe('navSections', () => {
  it('orders groups by NAV_GROUP_ORDER and preserves registry order inside', () => {
    const sections = navSections([
      item('b', 'front_office'), item('a', 'finance'), item('c', 'front_office'),
    ]);
    expect(sections.map((s) => s.group)).toEqual(['front_office', 'finance']);
    expect(sections[0].items.map((i) => i.id)).toEqual(['b', 'c']);
  });

  it('marks single-item and utility groups as label-less', () => {
    const sections = navSections([item('dash', 'overview'), item('r', 'insights'), item('s', 'utility')]);
    expect(sections.every((s) => !s.labeled)).toBe(true);
  });
});

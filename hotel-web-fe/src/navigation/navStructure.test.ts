import { describe, expect, it } from 'vitest';
import { navigationRouteDefinitions } from './routeRegistry';
import { NAV_GROUP_ORDER } from './navGroups';

describe('navigation registry integrity', () => {
  it('every nav item has an icon, a label source, and a known group', () => {
    for (const r of navigationRouteDefinitions) {
      expect(r.icon, `${r.id} icon`).toBeTruthy();
      expect(r.navLabel || r.breadcrumbLabel, `${r.id} label`).toBeTruthy();
      expect(NAV_GROUP_ORDER).toContain(r.navGroup);
    }
  });

  it('dashboard is the overview item and is visible to all staff', () => {
    const dash = navigationRouteDefinitions.find((r) => r.id === 'dashboard');
    expect(dash).toBeTruthy();
    expect(dash?.navGroup).toBe('overview');
    expect(dash?.accessControlled).toBe(false);
  });
});

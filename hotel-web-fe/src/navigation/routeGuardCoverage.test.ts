/**
 * A staff page's route access policy only protects it if the page renders
 * behind `ProtectedRoute`. Otherwise the policy hides the menu entry while the
 * page still opens by URL, which is how /rates and /segments shipped. Registry
 * pages get the guard from `RouteById`; file routes outside the registry name
 * their policy with `<ProtectedRoute routeId="…">`, and the Access Control
 * page only offers policies some page checks.
 */
import { describe, expect, it } from 'vitest';
import { authRouteDefinitions, FILE_ROUTE_POLICY_IDS } from './routeRegistry';

const ROUTE_SOURCES = import.meta.glob('../routes/**/*.tsx', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

function idsMatching(pattern: RegExp): Set<string> {
  return new Set(
    Object.values(ROUTE_SOURCES).flatMap((source) =>
      Array.from(source.matchAll(pattern), (match) => match[1]),
    ),
  );
}

describe('route guard coverage', () => {
  it('finds the route files', () => {
    expect(Object.keys(ROUTE_SOURCES).length).toBeGreaterThan(30);
  });

  it('renders every staff page in the registry through RouteById', () => {
    const rendered = idsMatching(/<RouteById\s+id="([a-z0-9-]+)"/g);
    const unguarded = authRouteDefinitions
      .map((route) => route.id)
      .filter((id) => !rendered.has(id));
    expect(unguarded).toEqual([]);
  });

  it('lists every policy a file route outside the registry guards on', () => {
    const registryPolicyIds = new Set(
      authRouteDefinitions.map((route) => route.policyId ?? route.id),
    );
    const fileRoutePolicyIds = [...idsMatching(/<ProtectedRoute\s+routeId="([a-z0-9-]+)"/g)]
      .filter((id) => !registryPolicyIds.has(id))
      .sort();
    expect(fileRoutePolicyIds).toEqual([...FILE_ROUTE_POLICY_IDS].sort());
  });
});

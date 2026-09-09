/**
 * Translated navigation labels.
 *
 * Route definitions keep their English `navLabel`/`breadcrumbLabel` as written
 * source; the translations live in `i18n/resources/<locale>/nav.json` keyed by
 * route id. Keeping the two apart means adding a route needs no translation to
 * ship — the English in the registry is the fallback until someone adds
 * `routes.<id>.label` — and translators work against one flat file instead of
 * hunting through a TSX registry.
 */

import { useCallback } from 'react';
import { useTranslation } from '../i18n';
import type { AppRouteDefinition, NavGroup } from './routeRegistry';

export interface RouteLabelHelpers {
  /** Short label for tabs and sidebars. */
  navLabel: (route: AppRouteDefinition) => string;
  /** Long label for breadcrumbs and page headers. */
  breadcrumbLabel: (route: AppRouteDefinition) => string;
  /** Heading for a navigation group. */
  groupLabel: (group: NavGroup) => string;
}

export const useRouteLabels = (): RouteLabelHelpers => {
  const { tOr } = useTranslation('nav');

  const navLabel = useCallback(
    (route: AppRouteDefinition) =>
      tOr(
        `routes.${route.id}.label`,
        route.navLabel || route.breadcrumbLabel || route.path
      ),
    [tOr]
  );

  const breadcrumbLabel = useCallback(
    (route: AppRouteDefinition) =>
      tOr(
        `routes.${route.id}.breadcrumb`,
        route.breadcrumbLabel || route.navLabel || route.path
      ),
    [tOr]
  );

  const groupLabel = useCallback(
    (group: NavGroup) => tOr(`groups.${group}`, group),
    [tOr]
  );

  return { navLabel, breadcrumbLabel, groupLabel };
};

import React from 'react';
import { Breadcrumbs as MuiBreadcrumbs, Typography } from '@mui/material';
import { Link, useLocation } from '../../router';
import { useTranslation } from '../../i18n';
import {
  findRouteDefinition,
  navigationRouteDefinitions,
  type AppRouteDefinition,
} from '../../navigation/routeRegistry';
import { useRouteLabels } from '../../navigation/routeLabels';

/**
 * `/admin-portal` renders the dashboard (see routes/admin-portal.tsx), and so
 * does `/` inside the staff shell. They must resolve to the dashboard nav item
 * explicitly: `findRouteDefinition('/')` returns the public `landing` route,
 * which is registered earlier at the same path.
 */
const DASHBOARD_PATHS = new Set(['/', '/admin-portal']);

const resolveRoute = (pathname: string): AppRouteDefinition | undefined => {
  if (DASHBOARD_PATHS.has(pathname)) {
    return navigationRouteDefinitions.find((route) => route.id === 'dashboard');
  }
  // Prefer the navigation definition so crumbs carry nav metadata;
  // findRouteDefinition then covers non-nav auth pages such as /profile.
  return (
    navigationRouteDefinitions.find((route) => route.path === pathname) ??
    findRouteDefinition(pathname)
  );
};

/** A registry label can fall back to the raw path — render it as words instead. */
const humanizePath = (path: string): string => {
  const segment = path.split('/').filter(Boolean).pop() ?? '';
  const words = segment.replace(/[-_]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : path;
};

/**
 * Location trail for the staff shell: `Group › Page` for registry routes,
 * `Overview › Page` for auth pages without a nav group (profile, my-rewards),
 * and a single "Overview" crumb on the dashboard itself.
 */
export const Breadcrumbs: React.FC = () => {
  const { pathname } = useLocation();
  const { t: tNav } = useTranslation('nav');
  const { breadcrumbLabel, groupLabel } = useRouteLabels();

  const route = resolveRoute(pathname);
  const dashboardRoute = navigationRouteDefinitions.find((r) => r.id === 'dashboard');
  const overviewLabel = dashboardRoute ? breadcrumbLabel(dashboardRoute) : 'Overview';

  const currentLabel = (): string => {
    if (!route) return humanizePath(pathname);
    const label = breadcrumbLabel(route);
    return label.startsWith('/') ? humanizePath(label) : label;
  };

  // Only the dashboard renders without a parent crumb — every other page
  // trails back to either its nav group label (plain text; groups are not
  // pages) or an Overview link.
  const isDashboard = route?.id === 'dashboard';
  const parent = isDashboard ? null : route?.navGroup ? (
    <Typography sx={{ color: 'text.secondary', fontSize: 'inherit' }}>
      {groupLabel(route.navGroup)}
    </Typography>
  ) : (
    <Typography
      component={Link}
      to="/"
      sx={{
        color: 'text.secondary',
        textDecoration: 'none',
        fontSize: 'inherit',
        '&:hover': { color: 'text.primary', textDecoration: 'underline' },
      }}
    >
      {overviewLabel}
    </Typography>
  );

  return (
    <MuiBreadcrumbs
      aria-label={tNav('aria.breadcrumbs')}
      separator="›"
      sx={{ fontSize: '0.85rem', minWidth: 0 }}
    >
      {parent}
      <Typography
        aria-current="page"
        sx={{ color: 'text.primary', fontSize: 'inherit', fontWeight: 600 }}
      >
        {isDashboard ? overviewLabel : currentLabel()}
      </Typography>
    </MuiBreadcrumbs>
  );
};

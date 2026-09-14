import React from 'react';
import { BottomNavigation, BottomNavigationAction, Paper } from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import { useLocation, useNavigate } from '../../router';
import { useAuth } from '../../auth/AuthContext';
import { useTranslation } from '../../i18n';
import {
  canAccessNavigationRoute,
  navigationRouteDefinitions,
} from '../../navigation/routeRegistry';
import { isNavItemActive } from '../../navigation/isNavItemActive';
import { mobileNavItems } from '../../navigation/mobileNav';
import { useRouteLabels } from '../../navigation/routeLabels';
import { MobileMoreSheet } from './MobileMoreSheet';

export const MOBILE_NAV_HEIGHT = 60;
const MORE_VALUE = '__more';

/** Routes whose full nav label is too long for a bottom-bar slot. */
const SHORT_LABEL_KEYS: Record<string, string> = {
  'guest-relations': 'mobile.guests',
};

/**
 * Staff bottom navigation, rendered below `md` (hidden by CSS on larger
 * screens). Four role-filtered destinations — Overview, Bookings, Guests, and
 * an Ops slot that prefers Rooms and falls back to Housekeeping — plus More,
 * which opens a bottom sheet with every remaining accessible module. Item
 * visibility reuses `canAccessNavigationRoute`, so the bar never shows a
 * module the sidebar would hide. This bar is the only navigation below `md` —
 * there is no drawer.
 */
export const MobileNavBar: React.FC = () => {
  const { hasPermission, hasRole, getRoutePolicy } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { t: tNav } = useTranslation('nav');
  const { navLabel } = useRouteLabels();
  const [moreOpen, setMoreOpen] = React.useState(false);

  const visible = React.useMemo(
    () =>
      navigationRouteDefinitions.filter((item) =>
        canAccessNavigationRoute(item, { hasPermission, hasRole, getRoutePolicy }),
      ),
    [hasPermission, hasRole, getRoutePolicy],
  );
  const tabs = React.useMemo(() => mobileNavItems(visible), [visible]);

  const activeTabPath = tabs.find((r) => isNavItemActive(pathname, r))?.path;
  // Highlight More whenever the current page is a non-tab nav destination
  // (e.g. Audit Log) so the bar still communicates location.
  const nonTabActive = visible.some(
    (r) => !tabs.includes(r) && isNavItemActive(pathname, r),
  );
  const value = activeTabPath ?? (moreOpen || nonTabActive ? MORE_VALUE : false);

  return (
    <>
      <Paper
        component="nav"
        aria-label={tNav('mobile.primary')}
        elevation={0}
        sx={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: (theme) => theme.zIndex.appBar,
          borderTop: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
          paddingBottom: 'var(--sab)',
          display: { md: 'none' },
        }}
      >
        <BottomNavigation
          showLabels
          value={value}
          onChange={(_event, next) => {
            if (next === MORE_VALUE) {
              setMoreOpen(true);
            } else {
              navigate(next);
            }
          }}
          sx={{
            height: MOBILE_NAV_HEIGHT,
            bgcolor: 'transparent',
            '& .MuiBottomNavigationAction-root': { minWidth: 0, color: 'text.secondary' },
            '& .MuiBottomNavigationAction-root.Mui-selected': { color: 'primary.main' },
            '& .MuiBottomNavigationAction-label': {
              fontSize: '0.68rem',
              fontWeight: 650,
              mt: 0.25,
              whiteSpace: 'nowrap',
            },
          }}
        >
          {tabs.map((route) => {
            const Icon = route.icon;
            const active = isNavItemActive(pathname, route);
            return (
              <BottomNavigationAction
                key={route.id}
                value={route.path}
                label={SHORT_LABEL_KEYS[route.id] ? tNav(SHORT_LABEL_KEYS[route.id]) : navLabel(route)}
                icon={Icon ? <Icon fontSize="small" /> : undefined}
                aria-current={active ? 'page' : undefined}
              />
            );
          })}
          <BottomNavigationAction
            value={MORE_VALUE}
            label={tNav('mobile.more')}
            icon={<MenuIcon fontSize="small" />}
          />
        </BottomNavigation>
      </Paper>
      <MobileMoreSheet
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        tabIds={tabs.map((r) => r.id)}
      />
    </>
  );
};

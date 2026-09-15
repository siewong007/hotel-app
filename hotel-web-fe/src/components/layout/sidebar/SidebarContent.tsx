import React from 'react';
import { Box, Divider, IconButton, List, Tooltip, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import HotelIcon from '@mui/icons-material/Hotel';
import { Link, useLocation, useNavigate } from '../../../router';
import { useAuth } from '../../../auth/AuthContext';
import { useTranslation } from '../../../i18n';
import { getHotelSettings } from '../../../utils/hotelSettings';
import {
  canAccessNavigationRoute,
  navigationRouteDefinitions,
  preloadRoute,
} from '../../../navigation/routeRegistry';
import { navSections } from '../../../navigation/navGroups';
import { SidebarSection } from './SidebarSection';

interface SidebarContentProps {
  /** Icon-rail mode (72px). */
  collapsed: boolean;
  onToggleCollapse: () => void;
}

/**
 * The permanent desktop sidebar body: brand, New booking CTA, the grouped
 * registry nav, and the rail collapse toggle. `visibleItems` uses the same
 * `canAccessNavigationRoute` memo as CommandPalette so both surfaces agree
 * on access. Search and the account menu live only in the topbar — the
 * sidebar used to duplicate both.
 */
export const SidebarContent: React.FC<SidebarContentProps> = ({
  collapsed,
  onToggleCollapse,
}) => {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { hasPermission, hasRole, getRoutePolicy } = useAuth();
  const { t: tNav } = useTranslation('nav');

  // The brand name lives in localStorage; `hotelSettingsChange` fires on the
  // boot refresh and whenever Settings is saved (same subscription as
  // RootLayout's document-title sync).
  const [hotelName, setHotelName] = React.useState(() => getHotelSettings().hotel_name);
  React.useEffect(() => {
    const syncHotelName = () => setHotelName(getHotelSettings().hotel_name);
    window.addEventListener('hotelSettingsChange', syncHotelName);
    return () => window.removeEventListener('hotelSettingsChange', syncHotelName);
  }, []);

  const visibleItems = React.useMemo(
    () =>
      navigationRouteDefinitions.filter((item) =>
        canAccessNavigationRoute(item, { hasPermission, hasRole, getRoutePolicy })
      ),
    [hasPermission, hasRole, getRoutePolicy]
  );

  // Warm the first routes once the nav settles — the only preload path for
  // touch users, who never fire the hover/focus preloads below.
  React.useEffect(() => {
    if (visibleItems.length === 0) return;
    const idle = window.requestIdleCallback?.(() => {
      visibleItems.slice(0, 4).forEach((item) => preloadRoute(item.path));
    });
    if (idle !== undefined) return () => window.cancelIdleCallback?.(idle);
    const t = window.setTimeout(() => {
      visibleItems.slice(0, 4).forEach((item) => preloadRoute(item.path));
    }, 300);
    return () => window.clearTimeout(t);
  }, [visibleItems]);

  const sections = React.useMemo(() => navSections(visibleItems), [visibleItems]);
  const bookingsRoute = visibleItems.find((item) => item.path === '/bookings');

  const handleNewBooking = () => {
    // The compat navigate parses the query string into TanStack search params
    // (a `to` string containing '?' would not — see router/compat.tsx).
    navigate('/bookings?create=1');
  };

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        bgcolor: 'background.paper',
      }}
    >
      {/* ── Brand ─────────────────────────────────────────────────── */}
      <Box
        sx={{
          minHeight: 56,
          display: 'flex',
          alignItems: 'center',
          px: collapsed ? 1 : 2,
          justifyContent: collapsed ? 'center' : 'flex-start',
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Box
          component={Link}
          to="/"
          aria-label={hotelName || tNav('aria.brand')}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.25,
            minWidth: 0,
            textDecoration: 'none',
            color: 'inherit',
            '&:hover': { opacity: 0.92 },
          }}
        >
          <Box
            sx={{
              width: 32,
              height: 32,
              borderRadius: 1.5,
              bgcolor: 'primary.main',
              color: 'primary.contrastText',
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0,
            }}
          >
            <HotelIcon sx={{ fontSize: 18 }} />
          </Box>
          {!collapsed && (
            <Typography noWrap sx={{ fontSize: '0.9rem', fontWeight: 700 }}>
              {hotelName}
            </Typography>
          )}
        </Box>
      </Box>

      {/* ── New booking CTA ───────────────────────────────────────── */}
      {bookingsRoute && (
        <Box sx={{ px: collapsed ? 1 : 2, pt: 1.5 }}>
          {collapsed ? (
            <Tooltip title={tNav('mobile.newBooking')} placement="right">
              <IconButton
                aria-label={tNav('mobile.newBooking')}
                onClick={handleNewBooking}
                onMouseEnter={() => preloadRoute('/bookings')}
                onFocus={() => preloadRoute('/bookings')}
                sx={{ display: 'flex', mx: 'auto', color: 'primary.main' }}
              >
                <AddIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          ) : (
            <Box
              component="button"
              type="button"
              onClick={handleNewBooking}
              onMouseEnter={() => preloadRoute('/bookings')}
              onFocus={() => preloadRoute('/bookings')}
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 0.875,
                width: '100%',
                height: 38,
                borderRadius: 1.25,
                border: 'none',
                cursor: 'pointer',
                fontFamily: 'inherit',
                bgcolor: 'primary.main',
                color: 'primary.contrastText',
                fontSize: '0.8rem',
                fontWeight: 700,
                '&:hover': { filter: 'brightness(0.97)' },
              }}
            >
              <AddIcon sx={{ fontSize: 18 }} /> {tNav('mobile.newBooking')}
            </Box>
          )}
        </Box>
      )}

      {/* ── Grouped nav ───────────────────────────────────────────── */}
      <List
        component="nav"
        aria-label={tNav('aria.mainNavigation')}
        disablePadding
        sx={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', py: 1 }}
      >
        {sections.map((section) => (
          <SidebarSection
            key={section.group}
            section={section}
            pathname={pathname}
            collapsed={collapsed}
          />
        ))}
      </List>

      <Divider />

      {/* ── Rail toggle ───────────────────────────────────────────── */}
      {/* The rail toggle is a desktop affordance — the temporary drawer is
          always expanded, so it stays hidden below md. */}
      <Box
        sx={{
          display: { xs: 'none', md: 'flex' },
          justifyContent: collapsed ? 'center' : 'flex-end',
          px: collapsed ? 1 : 1.5,
          pb: 1.5,
        }}
      >
        <Tooltip
          title={collapsed ? tNav('aria.expandSidebar') : tNav('aria.collapseSidebar')}
          placement="right"
        >
          <IconButton
            aria-label={collapsed ? tNav('aria.expandSidebar') : tNav('aria.collapseSidebar')}
            onClick={onToggleCollapse}
            size="small"
          >
            {collapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  );
};

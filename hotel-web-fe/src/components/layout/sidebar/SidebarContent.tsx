import React from 'react';
import { Box, Divider, IconButton, List, Tooltip, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import HotelIcon from '@mui/icons-material/Hotel';
import SearchIcon from '@mui/icons-material/Search';
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
import { useCommandPalette } from '../CommandPalette';
import { UserMenu } from '../UserMenu';
import { SidebarSection } from './SidebarSection';

interface SidebarContentProps {
  /**
   * Icon-rail mode (72px). `AppSidebar` only passes `true` on ≥md — the
   * temporary mobile drawer always renders expanded.
   */
  collapsed: boolean;
  onToggleCollapse: () => void;
  /** Closes the mobile drawer after a destination is picked. */
  onNavigate?: () => void;
}

/**
 * The full sidebar body shared by the permanent desktop drawer and the
 * temporary mobile drawer: brand, command-palette trigger, New booking CTA,
 * the grouped registry nav, the account card, and the rail collapse toggle.
 * `visibleItems` uses the same `canAccessNavigationRoute` memo as
 * CommandPalette so both surfaces agree on access.
 */
export const SidebarContent: React.FC<SidebarContentProps> = ({
  collapsed,
  onToggleCollapse,
  onNavigate,
}) => {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { hasPermission, hasRole, getRoutePolicy } = useAuth();
  const { t: tNav } = useTranslation('nav');
  const { open: openPalette } = useCommandPalette();

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
  const sections = React.useMemo(() => navSections(visibleItems), [visibleItems]);
  const bookingsRoute = visibleItems.find((item) => item.path === '/bookings');

  const handleNewBooking = () => {
    onNavigate?.();
    // The compat navigate parses the query string into TanStack search params
    // (a `to` string containing '?' would not — see router/compat.tsx).
    navigate('/bookings?create=1');
  };

  const searchLabel = tNav('aria.search');

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
          onClick={onNavigate}
          aria-label={hotelName}
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

      {/* ── Command-palette trigger ───────────────────────────────── */}
      <Box sx={{ px: collapsed ? 1 : 2, pt: 1.5 }}>
        {collapsed ? (
          <Tooltip title={searchLabel} placement="right">
            <IconButton
              aria-label={searchLabel}
              onClick={openPalette}
              sx={{ display: 'flex', mx: 'auto' }}
            >
              <SearchIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ) : (
          <Box
            component="button"
            type="button"
            role="button"
            aria-label={searchLabel}
            onClick={openPalette}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') openPalette();
            }}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.25,
              width: '100%',
              height: 40,
              px: 1.75,
              borderRadius: 2.5,
              border: '1px solid',
              borderColor: 'divider',
              bgcolor: 'action.hover',
              color: 'text.secondary',
              fontFamily: 'inherit',
              cursor: 'text',
              '&:hover': { borderColor: 'text.disabled' },
            }}
          >
            <SearchIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
            <Typography
              sx={{
                fontSize: '0.84rem',
                flex: 1,
                textAlign: 'left',
                color: 'text.secondary',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {searchLabel}
            </Typography>
            {/* The ⌘K hint only fits once the rail has room — ≥lg. */}
            <Box
              sx={{
                display: { xs: 'none', lg: 'block' },
                fontFamily: 'monospace',
                fontSize: '0.66rem',
                px: 0.875,
                py: '2px',
                borderRadius: 0.75,
                bgcolor: 'background.paper',
                color: 'text.secondary',
                fontWeight: 600,
              }}
            >
              ⌘K
            </Box>
          </Box>
        )}
      </Box>

      {/* ── New booking CTA ───────────────────────────────────────── */}
      {bookingsRoute && (
        <Box sx={{ px: collapsed ? 1 : 2, pt: 1 }}>
          {collapsed ? (
            <Tooltip title="New booking" placement="right">
              <IconButton
                aria-label="New booking"
                onClick={handleNewBooking}
                onMouseEnter={() => preloadRoute('/bookings')}
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
              <AddIcon sx={{ fontSize: 18 }} /> New booking
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
            onNavigate={onNavigate}
          />
        ))}
      </List>

      <Divider />

      {/* ── Account card + rail toggle ────────────────────────────── */}
      <Box
        sx={
          collapsed
            ? {
                p: 1,
                // In the 72px rail the card trigger shrinks to just the
                // avatar: drop the border/padding and hide the name block and
                // chevron inside UserMenu's trigger.
                '& > button': { px: 0, justifyContent: 'center', border: 'none' },
                '& > button > .MuiBox-root': { display: 'none' },
                '& > button > .MuiSvgIcon-root': { display: 'none' },
              }
            : { p: 1.5 }
        }
      >
        <UserMenu variant="card" />
      </Box>
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

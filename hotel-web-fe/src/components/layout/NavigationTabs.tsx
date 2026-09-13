import React from 'react';
import {
  Box,
  Typography,
  Avatar,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Divider,
  IconButton,
  Drawer,
  List,
  ListItemButton,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import LogoutIcon from '@mui/icons-material/Logout';
import PersonIcon from '@mui/icons-material/Person';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import ManageAccountsIcon from '@mui/icons-material/ManageAccounts';
import HelpOutlineIcon from '@mui/icons-material/HelpOutlined';
import SearchIcon from '@mui/icons-material/Search';
import AddIcon from '@mui/icons-material/Add';
import HotelIcon from '@mui/icons-material/Hotel';
import { Link, useLocation, useNavigate } from '../../router';
import { useAuth } from '../../auth/AuthContext';
import { getHotelSettings } from '../../utils/hotelSettings';
import { NotificationCenter } from './NotificationCenter';
import { useCommandPalette } from './CommandPalette';
import {
  canAccessNavigationRoute,
  navigationRouteDefinitions,
  preloadRoute,
  type NavGroup,
} from '../../navigation/routeRegistry';
import { useRouteLabels } from '../../navigation/routeLabels';
import { useTranslation } from '../../i18n';
import { LanguageSwitcher } from '../common/LanguageSwitcher';

interface NavigationTabsProps {
  darkBg?: boolean;
}

// Temporary bridge: old topbar buckets until sidebar replaces this file.
// Maps the new registry navGroups onto the legacy main/operations/admin/config
// sections so the pill bar + two dropdowns keep their exact current behavior.
type LegacyNavBucket = 'main' | 'operations' | 'admin' | 'config';
const LEGACY_GROUP_BUCKET: Record<NavGroup, LegacyNavBucket> = {
  overview: 'main',
  operations: 'main',
  finance: 'operations',
  engagement: 'operations',
  property: 'operations',
  insights: 'operations',
  administration: 'admin',
  utility: 'config',
};
const NAV_GROUP_ORDER: LegacyNavBucket[] = ['main', 'operations', 'admin', 'config'];
const legacyBucket = (item: { navGroup?: NavGroup }): LegacyNavBucket =>
  LEGACY_GROUP_BUCKET[item.navGroup ?? 'overview'];

export const NavigationTabs: React.FC<NavigationTabsProps> = React.memo(function NavigationTabs({
  darkBg = false,
}: NavigationTabsProps) {
  const theme = useTheme();
  const isNarrowNav = useMediaQuery(theme.breakpoints.down('md'));
  const accentDeep = theme.palette.primary.dark;
  const accentLight = theme.palette.primary.light;
  const location = useLocation();
  const navigate = useNavigate();
  const { hasPermission, hasRole, getRoutePolicy, logout, user } = useAuth();
  const isGuest = hasRole('guest') || user?.user_type === 'guest';
  const displayEmail = user?.email?.endsWith('@no-email.invalid') ? '' : user?.email;
  const hotelName = getHotelSettings().hotel_name;

  const { navLabel: navLabelFor, groupLabel } = useRouteLabels();
  const { t: tNav } = useTranslation('nav');
  const visibleItems = React.useMemo(
    () =>
      navigationRouteDefinitions.filter((item) =>
        canAccessNavigationRoute(item, { hasPermission, hasRole, getRoutePolicy })
      ),
    [hasPermission, hasRole, getRoutePolicy]
  );

  // Operational destinations stay one-click pills; the low-frequency admin and
  // configuration groups collapse into labelled dropdowns so a wide admin nav
  // fits the viewport instead of scrolling off it.
  const opsItems = visibleItems.filter(
    (i) => legacyBucket(i) === 'main' || legacyBucket(i) === 'operations'
  );
  const adminItems = visibleItems.filter((i) => legacyBucket(i) === 'admin');
  const configItems = visibleItems.filter((i) => legacyBucket(i) === 'config');
  const dropdownGroups = (
    [
      ['admin', adminItems],
      ['config', configItems],
    ] as [LegacyNavBucket, typeof visibleItems][]
  ).filter(([, items]) => items.length > 0);
  const [groupMenuAnchor, setGroupMenuAnchor] = React.useState<null | {
    group: LegacyNavBucket;
    el: HTMLElement;
  }>(null);

  // Below `md` the pill bar is replaced by a drawer; keep the same registry but
  // split sections by their real navGroup so labels stay accurate.
  const [navDrawerOpen, setNavDrawerOpen] = React.useState(false);
  const drawerGroups = React.useMemo(
    () =>
      NAV_GROUP_ORDER.map((group) => ({
        group,
        items: visibleItems.filter((i) => legacyBucket(i) === group),
      })).filter((g) => g.items.length > 0),
    [visibleItems]
  );

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

  const getUserInitials = () => {
    if (user?.full_name) {
      const names = user.full_name.split(' ');
      return names.length > 1
        ? `${names[0][0]}${names[names.length - 1][0]}`.toUpperCase()
        : names[0][0].toUpperCase();
    }
    return user?.username?.[0]?.toUpperCase() || 'U';
  };

  const [userMenuAnchor, setUserMenuAnchor] = React.useState<null | HTMLElement>(null);
  const userMenuOpen = Boolean(userMenuAnchor);
  const handleUserMenuClose = () => setUserMenuAnchor(null);
  const handleMenuItemClick = (path: string) => {
    handleUserMenuClose();
    navigate(path);
  };
  const handleLogout = () => {
    handleUserMenuClose();
    logout();
    navigate('/login');
  };

  const renderNavIcon = React.useCallback(
    (item: (typeof visibleItems)[number], size: number) => {
      const Icon = item.icon;
      return Icon ? <Icon sx={{ fontSize: size }} /> : null;
    },
    []
  );

  /* ---------------- Command palette ---------------- */
  // State, search and the Popover itself live in CommandPaletteProvider
  // (mounted by RootLayout around this shell); the trigger below only opens it.
  const { open: openPalette } = useCommandPalette();
  const bookingsRoute = visibleItems.find((i) => i.path === '/bookings');

  const onText = darkBg ? '#fff' : '#fff';
  const subText = 'rgba(255,255,255,0.78)';

  return (
    <Box sx={{ width: '100%' }}>
      {/* ---------- Row 1: brand · command bar · actions ---------- */}
      <Box
        sx={{
          height: 64,
          px: { xs: 2, sm: 2.5 },
          display: 'flex',
          alignItems: 'center',
          gap: { xs: 1, sm: 2.5 },
          color: onText,
        }}
      >
        {isNarrowNav && (
          <IconButton
            color="inherit"
            aria-label={tNav('aria.openMenu')}
            onClick={() => setNavDrawerOpen(true)}
            sx={{ mr: -1, flexShrink: 0 }}
          >
            <MenuIcon />
          </IconButton>
        )}
        <Box
          component={Link}
          to="/"
          sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexShrink: 0, textDecoration: 'none', color: 'inherit', '&:hover': { opacity: 0.92 } }}
        >
          <Box sx={{ width: 30, height: 30, borderRadius: 1, bgcolor: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.20)', display: 'grid', placeItems: 'center' }}>
            <HotelIcon sx={{ fontSize: 18 }} />
          </Box>
          <Typography sx={{ fontSize: '0.875rem', fontWeight: 700, display: { xs: 'none', sm: 'block' } }}>
            {hotelName}
          </Typography>
        </Box>

        {/* Command bar — a 40px search button on phones so the bell, language
            and user menu stay on-screen; the full field from `sm` up. */}
        <Box sx={{ flex: 1, display: 'flex', justifyContent: { xs: 'flex-start', sm: 'center' } }}>
          <Box
            onClick={openPalette}
            role="button"
            tabIndex={0}
            aria-label={tNav('aria.search')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') openPalette();
            }}
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: { xs: 'center', sm: 'flex-start' },
              gap: 1.25,
              width: { xs: 40, sm: 'min(620px, 100%)' },
              height: 40,
              px: { xs: 0, sm: 1.75 },
              borderRadius: 2.5,
              bgcolor: 'rgba(255,255,255,0.95)',
              color: 'text.primary',
              cursor: 'text',
              boxShadow: '0 2px 6px rgba(0,0,0,0.10), 0 8px 24px rgba(0,0,0,0.10)',
              flexShrink: 0,
            }}
          >
            <SearchIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
            <Typography sx={{ display: { xs: 'none', sm: 'block' }, fontSize: '0.84rem', flex: 1, color: 'text.secondary', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              Search pages &amp; actions — or type{' '}
              <Box component="span" sx={{ fontFamily: 'monospace', fontSize: '0.75rem', px: 0.75, py: '1px', borderRadius: 0.75, bgcolor: 'action.hover', color: 'text.secondary' }}>
                /new
              </Box>{' '}
              for actions
            </Typography>
            <Box sx={{ display: { xs: 'none', sm: 'block' }, fontFamily: 'monospace', fontSize: '0.66rem', px: 0.875, py: '2px', borderRadius: 0.75, bgcolor: 'action.hover', color: 'text.secondary', fontWeight: 600 }}>
              ⌘K
            </Box>
          </Box>
        </Box>

        {bookingsRoute && (
          <Box
            component="button"
            onClick={() => navigate('/bookings')}
            onMouseEnter={() => preloadRoute('/bookings')}
            sx={{
              display: { xs: 'none', sm: 'inline-flex' },
              alignItems: 'center',
              gap: 0.875,
              height: 36,
              px: 1.75,
              borderRadius: 1.25,
              border: 'none',
              cursor: 'pointer',
              bgcolor: '#fff',
              color: accentDeep,
              fontSize: '0.8rem',
              fontWeight: 700,
              boxShadow: '0 4px 12px rgba(0,0,0,0.18)',
              flexShrink: 0,
              '&:hover': { filter: 'brightness(0.97)' },
            }}
          >
            <AddIcon sx={{ fontSize: 18 }} /> New booking
          </Box>
        )}

        <LanguageSwitcher color="inherit" size="small" />

        <NotificationCenter darkBg={darkBg} />

        {/* User pill */}
        <Box
          onClick={(e) => setUserMenuAnchor(e.currentTarget)}
          sx={{
            display: 'flex', alignItems: 'center', gap: 1, pl: 0.5, pr: 1.25, py: 0.5,
            borderRadius: 999, flexShrink: 0, cursor: 'pointer', userSelect: 'none',
            bgcolor: userMenuOpen ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.10)',
            border: '1px solid rgba(255,255,255,0.16)',
            '&:hover': { bgcolor: 'rgba(255,255,255,0.18)' },
          }}
        >
          <Avatar sx={{ width: 28, height: 28, fontSize: '0.75rem', fontWeight: 800, background: `linear-gradient(135deg,#fff,${accentLight})`, color: accentDeep }}>
            {getUserInitials()}
          </Avatar>
          <Box sx={{ display: { xs: 'none', md: 'flex' }, flexDirection: 'column', lineHeight: 1.1 }}>
            <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: onText }}>
              {user?.full_name || user?.username}
            </Typography>
            <Typography sx={{ fontSize: '0.62rem', color: subText, textTransform: 'capitalize' }}>
              {user?.username || 'Staff'}
            </Typography>
          </Box>
          <KeyboardArrowDownIcon sx={{ fontSize: 18, color: subText, transition: 'transform 0.2s', transform: userMenuOpen ? 'rotate(180deg)' : 'none' }} />
        </Box>

        <Menu
          anchorEl={userMenuAnchor}
          open={userMenuOpen}
          onClose={handleUserMenuClose}
          onClick={handleUserMenuClose}
          transformOrigin={{ horizontal: 'right', vertical: 'top' }}
          anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
          slotProps={{ paper: { elevation: 8, sx: { mt: 1, minWidth: 220, borderRadius: 2 } } }}
        >
          <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>{user?.full_name || user?.username}</Typography>
            <Typography variant="caption" sx={{
              color: "text.secondary"
            }}>{displayEmail || user?.username}</Typography>
          </Box>
          <MenuItem onClick={() => handleMenuItemClick('/profile?edit=true')} sx={{ py: 1.25 }} onMouseEnter={() => preloadRoute('/profile')}>
            <ListItemIcon><PersonIcon fontSize="small" /></ListItemIcon>
            <ListItemText>My Profile</ListItemText>
          </MenuItem>
          {!isGuest && (
            <MenuItem onClick={() => handleMenuItemClick('/settings')} sx={{ py: 1.25 }} onMouseEnter={() => preloadRoute('/settings')}>
              <ListItemIcon><ManageAccountsIcon fontSize="small" /></ListItemIcon>
              <ListItemText>Hotel Settings</ListItemText>
            </MenuItem>
          )}
          <MenuItem onClick={() => handleMenuItemClick('/help')} sx={{ py: 1.25 }} onMouseEnter={() => preloadRoute('/help')}>
            <ListItemIcon><HelpOutlineIcon fontSize="small" /></ListItemIcon>
            <ListItemText>Help &amp; Support</ListItemText>
          </MenuItem>
          <Divider sx={{ my: 1 }} />
          <MenuItem onClick={handleLogout} sx={{ py: 1.25, color: 'error.main' }}>
            <ListItemIcon><LogoutIcon fontSize="small" sx={{ color: 'error.main' }} /></ListItemIcon>
            <ListItemText>Sign Out</ListItemText>
          </MenuItem>
        </Menu>

        {/* ---------- Narrow screens: drawer replaces the pill bar ---------- */}
        <Drawer
          anchor="left"
          open={navDrawerOpen}
          onClose={() => setNavDrawerOpen(false)}
          slotProps={{ paper: { sx: { width: 300, maxWidth: '85vw' } } }}
        >
          <Box component="nav" aria-label={tNav('aria.mainNavigation')} sx={{ pt: 1, pb: 2 }}>
            <Box sx={{ px: 2, py: 1.5, display: 'flex', alignItems: 'center', gap: 1.25 }}>
              <Box
                sx={{
                  width: 28,
                  height: 28,
                  borderRadius: 1,
                  bgcolor: 'primary.main',
                  color: 'primary.contrastText',
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                <HotelIcon sx={{ fontSize: 16 }} />
              </Box>
              <Typography sx={{ fontWeight: 700, fontSize: '0.9rem' }}>{hotelName}</Typography>
            </Box>
            {bookingsRoute && (
              <Box sx={{ px: 2, pb: 0.5 }}>
                <Box
                  component="button"
                  onClick={() => {
                    setNavDrawerOpen(false);
                    navigate('/bookings');
                  }}
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
                    bgcolor: 'primary.main',
                    color: 'primary.contrastText',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                  }}
                >
                  <AddIcon sx={{ fontSize: 18 }} /> New booking
                </Box>
              </Box>
            )}
            {drawerGroups.map(({ group, items }) => (
              <Box key={group} sx={{ mt: 1 }}>
                <Typography
                  sx={{
                    px: 2,
                    py: 0.5,
                    fontSize: '0.66rem',
                    fontWeight: 700,
                    color: 'text.secondary',
                    textTransform: 'uppercase',
                    letterSpacing: 0.6,
                  }}
                >
                  {/* legacy bucket id; nav.json still carries the old group keys */}
                  {groupLabel(group as NavGroup)}
                </Typography>
                <List dense disablePadding>
                  {items.map((item) => {
                    const active = location.pathname === item.path;
                    return (
                      <ListItemButton
                        key={item.id}
                        selected={active}
                        onClick={() => {
                          setNavDrawerOpen(false);
                          navigate(item.path);
                        }}
                        onMouseEnter={() => preloadRoute(item.path)}
                        sx={{ mx: 1, borderRadius: 1 }}
                      >
                        <ListItemIcon sx={{ minWidth: 34 }}>
                          {renderNavIcon(item, 18)}
                        </ListItemIcon>
                        <ListItemText
                          primary={navLabelFor(item)}
                          slotProps={{
                            primary: {
                              sx: { fontSize: '0.85rem', fontWeight: active ? 700 : 500 },
                            },
                          }}
                        />
                      </ListItemButton>
                    );
                  })}
                </List>
              </Box>
            ))}
          </Box>
        </Drawer>
      </Box>
      {/* ---------- Row 2: grouped pill tabs ---------- */}
      {!isNarrowNav && (
      <Box
        sx={{
          height: 46,
          px: { xs: 2, sm: 2.5 },
          display: 'flex',
          alignItems: 'center',
          gap: 2.25,
          bgcolor: 'background.paper',
          borderBottom: '1px solid',
          borderColor: 'divider',
          overflowX: 'auto',
        }}
      >
        {opsItems.length > 0 && (
          <Box sx={{ display: 'inline-flex', gap: 0.25, alignItems: 'center' }}>
            {opsItems.map((item) => {
              const active = location.pathname === item.path;
              return (
                <Box
                  key={item.id}
                  component={Link}
                  to={item.path}
                  onMouseEnter={() => preloadRoute(item.path)}
                  onFocus={() => preloadRoute(item.path)}
                  sx={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 0.75,
                    height: 30,
                    px: 1.375,
                    borderRadius: 1,
                    fontSize: '0.78rem',
                    fontWeight: active ? 600 : 500,
                    whiteSpace: 'nowrap',
                    textDecoration: 'none',
                    color: active ? 'text.primary' : 'text.secondary',
                    bgcolor: active ? 'action.selected' : 'transparent',
                    '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
                  }}
                >
                  {renderNavIcon(item, 16)}
                  {navLabelFor(item)}
                </Box>
              );
            })}
          </Box>
        )}
        {dropdownGroups.map(([group, items]) => {
          const groupActive = items.some((i) => i.path === location.pathname);
          return (
            <React.Fragment key={group}>
              <Box sx={{ width: '1px', height: 22, bgcolor: 'divider', flexShrink: 0 }} />
              <Box
                component="button"
                aria-haspopup="menu"
                aria-expanded={groupMenuAnchor?.group === group ? 'true' : undefined}
                onClick={(e) => setGroupMenuAnchor({ group, el: e.currentTarget })}
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 0.5,
                  height: 30,
                  px: 1.375,
                  borderRadius: 1,
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '0.78rem',
                  fontWeight: groupActive ? 600 : 500,
                  whiteSpace: 'nowrap',
                  color: groupActive ? 'text.primary' : 'text.secondary',
                  bgcolor: groupActive ? 'action.selected' : 'transparent',
                  '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
                }}
              >
                {groupLabel(group as NavGroup)}
                <KeyboardArrowDownIcon sx={{ fontSize: 16 }} />
              </Box>
            </React.Fragment>
          );
        })}
        <Menu
          anchorEl={groupMenuAnchor?.el}
          open={Boolean(groupMenuAnchor)}
          onClose={() => setGroupMenuAnchor(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
          transformOrigin={{ vertical: 'top', horizontal: 'left' }}
          slotProps={{ paper: { elevation: 8, sx: { mt: 0.5, minWidth: 220, borderRadius: 2 } } }}
        >
          {(dropdownGroups.find(([g]) => g === groupMenuAnchor?.group)?.[1] ?? []).map((item) => {
            const active = location.pathname === item.path;
            return (
              <MenuItem
                key={item.id}
                selected={active}
                onClick={() => {
                  setGroupMenuAnchor(null);
                  navigate(item.path);
                }}
                onMouseEnter={() => preloadRoute(item.path)}
                sx={{ py: 1 }}
              >
                <ListItemIcon sx={{ minWidth: 34 }}>{renderNavIcon(item, 18)}</ListItemIcon>
                <ListItemText
                  primary={navLabelFor(item)}
                  slotProps={{ primary: { sx: { fontSize: '0.85rem', fontWeight: active ? 700 : 500 } } }}
                />
              </MenuItem>
            );
          })}
        </Menu>
      </Box>
      )}
    </Box>
  );
});

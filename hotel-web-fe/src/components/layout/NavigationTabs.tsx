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
  Popover,
  InputBase,
  CircularProgress,
  IconButton,
  Drawer,
  List,
  ListItemButton,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import LogoutIcon from '@mui/icons-material/Logout';
import HistoryIcon from '@mui/icons-material/History';
import PersonIcon from '@mui/icons-material/Person';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import ManageAccountsIcon from '@mui/icons-material/ManageAccounts';
import HelpOutlineIcon from '@mui/icons-material/HelpOutlined';
import SearchIcon from '@mui/icons-material/Search';
import AddIcon from '@mui/icons-material/Add';
import HotelIcon from '@mui/icons-material/Hotel';
import { Link, useLocation, useNavigate } from '../../router';
import { useAuth } from '../../auth/AuthContext';
import { storage } from '../../utils/storage';
import { getHotelSettings } from '../../utils/hotelSettings';
import { useGlobalSearch } from '../../hooks/useGlobalSearch';
import { searchArticles } from '../../features/help/utils';
import { useHelpArticles } from '../../features/help/hooks/useHelpArticles';
import { NotificationCenter } from './NotificationCenter';
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

const NAV_GROUP_ORDER: NavGroup[] = ['main', 'operations', 'admin', 'config'];

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
  const helpArticles = useHelpArticles();
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
    (i) => i.navGroup === 'main' || i.navGroup === 'operations'
  );
  const adminItems = visibleItems.filter((i) => i.navGroup === 'admin');
  const configItems = visibleItems.filter((i) => i.navGroup === 'config');
  const dropdownGroups = (
    [
      ['admin', adminItems],
      ['config', configItems],
    ] as [NavGroup, typeof visibleItems][]
  ).filter(([, items]) => items.length > 0);
  const [groupMenuAnchor, setGroupMenuAnchor] = React.useState<null | {
    group: NavGroup;
    el: HTMLElement;
  }>(null);

  // Below `md` the pill bar is replaced by a drawer; keep the same registry but
  // split sections by their real navGroup so labels stay accurate.
  const [navDrawerOpen, setNavDrawerOpen] = React.useState(false);
  const drawerGroups = React.useMemo(
    () =>
      NAV_GROUP_ORDER.map((group) => ({
        group,
        items: visibleItems.filter((i) => i.navGroup === group),
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
  const bookingsRoute = visibleItems.find((i) => i.path === '/bookings');
  const cmdBoxRef = React.useRef<HTMLDivElement | null>(null);
  const cmdInputRef = React.useRef<HTMLInputElement | null>(null);
  const [cmdOpen, setCmdOpen] = React.useState(false);
  const [cmdQuery, setCmdQuery] = React.useState('');
  const [scope, setScope] = React.useState<'all' | 'bookings' | 'guests' | 'ledgers' | 'rooms' | 'pages' | 'help'>('all');
  const [activeIndex, setActiveIndex] = React.useState(0);

  type Recent = { title: string; subtitle?: string; route: string; kind: string };
  const [recents, setRecents] = React.useState<Recent[]>(
    () => (isGuest ? [] : storage.getItem<Recent[]>('cmdRecents') || [])
  );

  React.useEffect(() => {
    if (!isGuest) return;
    setRecents([]);
    storage.removeItem('cmdRecents');
  }, [isGuest]);

  const term = cmdQuery.trim();
  const slash = term.startsWith('/');
  const lowTerm = (slash ? term.slice(1) : term).toLowerCase();

  // Server-side federated search (skipped for /commands or the client-only scopes)
  const serverEnabled = !isGuest && cmdOpen && !slash && scope !== 'pages' && scope !== 'help';
  const serverTypes =
    scope === 'bookings' || scope === 'guests' || scope === 'ledgers' || scope === 'rooms' ? [scope] : undefined;
  const { groups: serverGroups, loading: serverLoading } = useGlobalSearch(
    serverEnabled ? cmdQuery : '',
    { types: serverTypes, enabled: serverEnabled }
  );

  type SelectItem = {
    key: string;
    title: string;
    subtitle?: string;
    icon: React.ReactNode;
    route: string;
  };
  type Group = { key: string; label: string; items: SelectItem[] };

  const dot = React.useMemo(
    () => <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'text.disabled' }} />,
    []
  );

  const persistRecent = (r: Recent) => {
    const next = [r, ...recents.filter((x) => !(x.route === r.route && x.title === r.title))].slice(0, 6);
    setRecents(next);
    storage.setItem('cmdRecents', next);
  };

  const bookingSearchValueFromTitle = (title: string) => {
    const trimmed = title.trim();
    if (/^BK-[A-Za-z0-9-]+$/i.test(trimmed)) return trimmed;
    const numericId = trimmed.match(/^#(\d+)$/);
    return numericId?.[1] || null;
  };

  const routeForSelection = (item: SelectItem) => {
    const [path, rawSearch = ''] = item.route.split('?');
    const title = item.title.trim();
    const ledgerIdTitle = title.match(/^Ledger #(\d+)$/i);
    const searchValue = item.route.startsWith('/bookings')
      ? bookingSearchValueFromTitle(title)
      : item.route.startsWith('/guest-config')
        ? title
        : item.route.startsWith('/company-ledger')
          ? (ledgerIdTitle?.[1] || title)
          : null;
    if (!searchValue) return item.route;

    const params = new URLSearchParams(rawSearch);
    const existingSearch = params.get('search');
    params.set('search', searchValue);
    if (path === '/bookings' && existingSearch !== searchValue) params.delete('booking_id');
    return `${path}?${params.toString()}`;
  };

  const openCmd = () => {
    setCmdOpen(true);
    setActiveIndex(0);
    window.setTimeout(() => cmdInputRef.current?.focus(), 0);
  };
  const closeCmd = () => {
    setCmdOpen(false);
    setCmdQuery('');
    setScope('all');
  };

  const groups: Group[] = React.useMemo(() => {
    const showClient = scope === 'all' || scope === 'pages';
    const out: Group[] = [];

    if (!isGuest && !term && recents.length > 0 && scope === 'all') {
      out.push({
        key: 'recents',
        label: 'Recent',
        items: recents.map((r, i) => ({
          key: `recent-${i}`,
          title: r.title,
          subtitle: r.subtitle,
          icon: <HistoryIcon sx={{ fontSize: 16 }} />,
          route: r.route,
        })),
      });
    }

    if (showClient && bookingsRoute) {
      const m =
        !lowTerm ||
        'new booking'.includes(lowTerm) ||
        'booking'.includes(lowTerm) ||
        'create'.includes(lowTerm);
      if (m) {
        out.push({
          key: 'actions',
          label: 'Actions',
          items: [
            {
              key: 'act-new-booking',
              title: 'New booking',
              subtitle: 'Create a reservation',
              icon: <AddIcon sx={{ fontSize: 16 }} />,
              route: '/bookings',
            },
          ],
        });
      }
    }

    serverGroups.forEach((g) => {
      out.push({
        key: g.type,
        label: g.label,
        items: g.results.map((h) => ({
          key: `${g.type}-${h.id}`,
          title: h.title,
          subtitle: h.subtitle,
          icon: dot,
          route: h.route,
        })),
      });
    });

    if (showClient) {
      const pages = visibleItems
        .filter((item) => {
          const label = navLabelFor(item);
          return (
            !lowTerm ||
            label.toLowerCase().includes(lowTerm) ||
            item.path.toLowerCase().includes(lowTerm)
          );
        })
        .slice(0, term ? 6 : 12)
        .map((item) => ({
          key: `pg-${item.id}`,
          title: navLabelFor(item),
          subtitle: item.path,
          icon: renderNavIcon(item, 16) || dot,
          route: item.path,
        }));
      if (pages.length) out.push({ key: 'pages', label: 'Pages', items: pages });
    }

    // Help articles are client-side: the same weighted search that powers the
    // Help Centre, so ⌘K can surface guides without a backend endpoint.
    const showHelp = !isGuest && (scope === 'all' || scope === 'pages' || scope === 'help');
    if (showHelp && lowTerm.length >= 2) {
      const helpItems = searchArticles(helpArticles, lowTerm, 5).map((hit) => ({
        key: `help-${hit.article.slug}`,
        title: hit.article.title,
        subtitle: hit.article.summary,
        icon: <HelpOutlineIcon sx={{ fontSize: 16 }} />,
        route: `/help/${hit.article.slug}`,
      }));
      if (helpItems.length) out.push({ key: 'help', label: 'Help', items: helpItems });
    }

    return out;
  }, [term, lowTerm, scope, recents, serverGroups, visibleItems, bookingsRoute, dot, renderNavIcon, isGuest, navLabelFor, helpArticles]);

  const flatItems = React.useMemo(() => groups.flatMap((g) => g.items), [groups]);

  React.useEffect(() => {
    setActiveIndex(0);
  }, [cmdQuery, scope, serverGroups]);

  const select = (item: SelectItem) => {
    const route = routeForSelection(item);
    if (!isGuest) {
      persistRecent({ title: item.title, subtitle: item.subtitle, route, kind: 'nav' });
    }
    closeCmd();
    navigate(route);
  };

  const onPaletteKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeCmd();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(flatItems.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      const item = flatItems[activeIndex] || flatItems[0];
      if (item) select(item);
    }
  };

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openCmd();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
            ref={cmdBoxRef}
            onClick={openCmd}
            role="button"
            tabIndex={0}
            aria-label={tNav('aria.search')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') openCmd();
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

        <Popover
          open={cmdOpen}
          anchorEl={cmdBoxRef.current}
          onClose={closeCmd}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
          transformOrigin={{ vertical: 'top', horizontal: 'center' }}
          slotProps={{ paper: { sx: { mt: 1, width: 'min(620px, 92vw)', borderRadius: 2, overflow: 'hidden' } } }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.75, py: 1.25, borderBottom: '1px solid', borderColor: 'divider' }}>
            <SearchIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
            <InputBase
              inputRef={cmdInputRef}
              value={cmdQuery}
              onChange={(e) => setCmdQuery(e.target.value)}
              onKeyDown={onPaletteKeyDown}
              placeholder={isGuest ? 'Search pages…' : 'Search bookings, guests, rooms, pages…'}
              sx={{ flex: 1, fontSize: '0.9rem' }}
            />
            {serverLoading && <CircularProgress size={14} />}
            <Box sx={{ fontFamily: 'monospace', fontSize: '0.66rem', px: 0.875, py: '2px', borderRadius: 0.75, bgcolor: 'action.hover', color: 'text.secondary', fontWeight: 600 }}>
              esc
            </Box>
          </Box>

          {!isGuest && (
            <Box sx={{ display: 'flex', gap: 0.75, px: 1.5, py: 1, borderBottom: '1px solid', borderColor: 'divider', flexWrap: 'wrap' }}>
              {([
                ['all', 'All'],
                ['bookings', 'Bookings'],
                ['guests', 'Guests'],
                ['ledgers', 'Ledger'],
                ['rooms', 'Rooms'],
                ['pages', 'Pages'],
                ['help', 'Help'],
              ] as const).map(([k, lb]) => {
                const on = scope === k;
                return (
                  <Box
                    key={k}
                    component="button"
                    onClick={() => setScope(k)}
                    sx={{
                      px: 1.25, py: 0.5, borderRadius: 999, border: '1px solid',
                      borderColor: on ? 'text.primary' : 'divider', cursor: 'pointer',
                      fontSize: '0.72rem', fontWeight: 600,
                      color: on ? 'background.paper' : 'text.secondary',
                      bgcolor: on ? 'text.primary' : 'transparent',
                    }}
                  >
                    {lb}
                  </Box>
                );
              })}
            </Box>
          )}

          <Box sx={{ maxHeight: 380, overflowY: 'auto', py: 0.5 }}>
            {flatItems.length === 0 && (
              <Box sx={{ px: 2, py: 4, textAlign: 'center', color: 'text.secondary', fontSize: '0.85rem' }}>
                {term.length >= 2 ? 'No matches' : serverLoading ? 'Searching…' : 'Type at least 2 characters, or browse below'}
              </Box>
            )}
            {(() => {
              let idx = -1;
              return groups.map((g) => (
                <Box key={g.key}>
                  <Typography sx={{ px: 1.75, pt: 1, pb: 0.5, fontSize: '0.66rem', fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.6 }}>
                    {g.label}
                  </Typography>
                  {g.items.map((item) => {
                    idx += 1;
                    const myIdx = idx;
                    const active = myIdx === activeIndex;
                    return (
                      <Box
                        key={item.key}
                        onMouseEnter={() => setActiveIndex(myIdx)}
                        onClick={() => select(item)}
                        sx={{
                          display: 'flex', alignItems: 'center', gap: 1.25, px: 1.75, py: 1, cursor: 'pointer',
                          bgcolor: active ? 'action.selected' : 'transparent',
                        }}
                      >
                        <Box sx={{ display: 'grid', placeItems: 'center', width: 26, height: 26, borderRadius: 1, bgcolor: 'action.hover', color: 'text.secondary', flexShrink: 0 }}>
                          {item.icon}
                        </Box>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography sx={{ fontSize: '0.86rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {item.title}
                          </Typography>
                          {item.subtitle && (
                            <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {item.subtitle}
                            </Typography>
                          )}
                        </Box>
                        {active && (
                          <Box sx={{ fontFamily: 'monospace', fontSize: '0.62rem', color: 'text.secondary' }}>↵</Box>
                        )}
                      </Box>
                    );
                  })}
                </Box>
              ));
            })()}
          </Box>
        </Popover>

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
                  {groupLabel(group)}
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
                {groupLabel(group)}
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

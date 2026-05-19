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
  Tooltip,
  Popover,
  InputBase,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import LogoutIcon from '@mui/icons-material/Logout';
import PersonIcon from '@mui/icons-material/Person';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import ManageAccountsIcon from '@mui/icons-material/ManageAccounts';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import SearchIcon from '@mui/icons-material/Search';
import AddIcon from '@mui/icons-material/Add';
import HotelIcon from '@mui/icons-material/Hotel';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import NightsStayIcon from '@mui/icons-material/NightsStay';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import type { ThemeMode } from '../../theme';
import {
  canAccessNavigationRoute,
  navigationRouteDefinitions,
  preloadRoute,
} from '../../navigation/routeRegistry';

interface NavigationTabsProps {
  darkBg?: boolean;
  themeMode?: ThemeMode;
  onThemeModeChange?: (mode: ThemeMode) => void;
}

const EMERALD = '#10A47C';
const EMERALD_DEEP = '#0E8C6A';

export const NavigationTabs = React.memo(function NavigationTabs({
  darkBg = false,
  themeMode,
  onThemeModeChange,
}: NavigationTabsProps = {}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { hasPermission, hasRole, logout, user } = useAuth();

  const visibleItems = navigationRouteDefinitions.filter((item) =>
    canAccessNavigationRoute(item, { hasPermission, hasRole })
  );

  // Option D: destinations split into visual groups (no "More" dropdown)
  const opsItems = visibleItems.filter(
    (i) => i.navGroup === 'main' || i.navGroup === 'operations'
  );
  const adminItems = visibleItems.filter((i) => i.navGroup === 'admin');
  const configItems = visibleItems.filter((i) => i.navGroup === 'config');
  const pillGroups = [opsItems, adminItems, configItems].filter((g) => g.length > 0);

  const preloadSignature = visibleItems.map((item) => item.path).join('|');

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
  }, [preloadSignature]);

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

  const renderNavIcon = (item: (typeof visibleItems)[number], size: number) => {
    const Icon = item.icon;
    return Icon ? <Icon sx={{ fontSize: size }} /> : null;
  };

  /* ---------------- Command palette ---------------- */
  const bookingsRoute = visibleItems.find((i) => i.path === '/bookings');
  const cmdBoxRef = React.useRef<HTMLDivElement | null>(null);
  const cmdInputRef = React.useRef<HTMLInputElement | null>(null);
  const [cmdOpen, setCmdOpen] = React.useState(false);
  const [cmdQuery, setCmdQuery] = React.useState('');

  type CmdResult = { key: string; label: string; hint: string; run: () => void; icon: React.ReactNode };
  const cmdResults: CmdResult[] = React.useMemo(() => {
    const q = cmdQuery.trim().toLowerCase();
    const slash = q.startsWith('/');
    const term = slash ? q.slice(1) : q;
    const out: CmdResult[] = [];
    if (bookingsRoute && ('new booking'.includes(term) || 'create'.includes(term) || term === '')) {
      out.push({
        key: 'act-new-booking',
        label: 'New booking',
        hint: 'Action',
        icon: <AddIcon sx={{ fontSize: 16 }} />,
        run: () => navigate('/bookings'),
      });
    }
    visibleItems.forEach((item) => {
      const label = item.navLabel || item.breadcrumbLabel || item.path;
      if (!term || label.toLowerCase().includes(term) || item.path.toLowerCase().includes(term)) {
        out.push({
          key: item.id,
          label,
          hint: 'Go to',
          icon: renderNavIcon(item, 16),
          run: () => navigate(item.path),
        });
      }
    });
    return out.slice(0, 8);
  }, [cmdQuery, visibleItems, bookingsRoute]);

  const openCmd = () => {
    setCmdOpen(true);
    window.setTimeout(() => cmdInputRef.current?.focus(), 0);
  };
  const closeCmd = () => {
    setCmdOpen(false);
    setCmdQuery('');
  };
  const runResult = (r: CmdResult) => {
    closeCmd();
    r.run();
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
          gap: 2.5,
          color: onText,
        }}
      >
        <Box
          component={Link}
          to="/"
          sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexShrink: 0, textDecoration: 'none', color: 'inherit', '&:hover': { opacity: 0.92 } }}
        >
          <Box sx={{ width: 30, height: 30, borderRadius: 1, bgcolor: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.20)', display: 'grid', placeItems: 'center' }}>
            <HotelIcon sx={{ fontSize: 18 }} />
          </Box>
          <Typography sx={{ fontSize: '0.875rem', fontWeight: 700, display: { xs: 'none', sm: 'block' } }}>
            Salim Inn
          </Typography>
        </Box>

        {/* Command bar */}
        <Box sx={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
          <Box
            ref={cmdBoxRef}
            onClick={openCmd}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') openCmd();
            }}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.25,
              width: 'min(620px, 100%)',
              height: 40,
              px: 1.75,
              borderRadius: 2.5,
              bgcolor: 'rgba(255,255,255,0.95)',
              color: 'text.primary',
              cursor: 'text',
              boxShadow: '0 2px 6px rgba(0,0,0,0.10), 0 8px 24px rgba(0,0,0,0.10)',
            }}
          >
            <SearchIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
            <Typography sx={{ fontSize: '0.84rem', flex: 1, color: 'text.secondary', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              Search pages &amp; actions — or type{' '}
              <Box component="span" sx={{ fontFamily: 'monospace', fontSize: '0.75rem', px: 0.75, py: '1px', borderRadius: 0.75, bgcolor: 'action.hover', color: 'text.secondary' }}>
                /new
              </Box>{' '}
              for actions
            </Typography>
            <Box sx={{ fontFamily: 'monospace', fontSize: '0.66rem', px: 0.875, py: '2px', borderRadius: 0.75, bgcolor: 'action.hover', color: 'text.secondary', fontWeight: 600 }}>
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
              onKeyDown={(e) => {
                if (e.key === 'Escape') closeCmd();
                if (e.key === 'Enter' && cmdResults[0]) runResult(cmdResults[0]);
              }}
              placeholder="Search pages, or type /new …"
              sx={{ flex: 1, fontSize: '0.9rem' }}
            />
            <Box sx={{ fontFamily: 'monospace', fontSize: '0.66rem', px: 0.875, py: '2px', borderRadius: 0.75, bgcolor: 'action.hover', color: 'text.secondary', fontWeight: 600 }}>
              esc
            </Box>
          </Box>
          <Box sx={{ maxHeight: 360, overflowY: 'auto', py: 0.5 }}>
            {cmdResults.length === 0 && (
              <Box sx={{ px: 2, py: 3, textAlign: 'center', color: 'text.secondary', fontSize: '0.85rem' }}>
                No matches
              </Box>
            )}
            {cmdResults.map((r) => (
              <Box
                key={r.key}
                onClick={() => runResult(r)}
                sx={{
                  display: 'flex', alignItems: 'center', gap: 1.25, px: 1.75, py: 1.1, cursor: 'pointer',
                  '&:hover': { bgcolor: 'action.hover' },
                }}
              >
                <Box sx={{ display: 'grid', placeItems: 'center', width: 26, height: 26, borderRadius: 1, bgcolor: 'action.hover', color: 'text.secondary' }}>
                  {r.icon}
                </Box>
                <Typography sx={{ flex: 1, fontSize: '0.88rem', fontWeight: 600 }}>{r.label}</Typography>
                <Typography sx={{ fontSize: '0.7rem', color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {r.hint}
                </Typography>
              </Box>
            ))}
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
              color: EMERALD_DEEP,
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

        {themeMode && onThemeModeChange && (
          <ToggleButtonGroup
            exclusive
            size="small"
            value={themeMode}
            onChange={(_, value) => {
              if (value === 'light' || value === 'dark' || value === 'night') onThemeModeChange(value);
            }}
            sx={{
              bgcolor: 'rgba(255,255,255,0.10)',
              borderRadius: 999,
              p: 0.25,
              flexShrink: 0,
              display: { xs: 'none', md: 'flex' },
              '& .MuiToggleButton-root': {
                color: 'rgba(255,255,255,0.85)',
                border: 'none',
                borderRadius: '999px !important',
                px: 1,
                '&.Mui-selected': { color: '#1f5a36', bgcolor: 'rgba(255,255,255,0.95)' },
                '&.Mui-selected:hover': { bgcolor: 'rgba(255,255,255,0.85)' },
                '&:hover': { bgcolor: 'rgba(255,255,255,0.18)' },
              },
            }}
          >
            <ToggleButton value="light" aria-label="Light mode">
              <Tooltip title="Light mode"><LightModeIcon fontSize="small" /></Tooltip>
            </ToggleButton>
            <ToggleButton value="dark" aria-label="Dark mode">
              <Tooltip title="Dark mode"><DarkModeIcon fontSize="small" /></Tooltip>
            </ToggleButton>
            <ToggleButton value="night" aria-label="Night mode">
              <Tooltip title="Night mode"><NightsStayIcon fontSize="small" /></Tooltip>
            </ToggleButton>
          </ToggleButtonGroup>
        )}

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
          <Avatar sx={{ width: 28, height: 28, fontSize: '0.75rem', fontWeight: 800, background: 'linear-gradient(135deg,#fff,#B8E5D5)', color: EMERALD_DEEP }}>
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
            <Typography variant="caption" color="text.secondary">{user?.email || user?.username}</Typography>
          </Box>
          <MenuItem onClick={() => handleMenuItemClick('/profile?edit=true')} sx={{ py: 1.25 }} onMouseEnter={() => preloadRoute('/profile')}>
            <ListItemIcon><PersonIcon fontSize="small" /></ListItemIcon>
            <ListItemText>My Profile</ListItemText>
          </MenuItem>
          <MenuItem onClick={() => handleMenuItemClick('/settings')} sx={{ py: 1.25 }} onMouseEnter={() => preloadRoute('/settings')}>
            <ListItemIcon><ManageAccountsIcon fontSize="small" /></ListItemIcon>
            <ListItemText>Account Settings</ListItemText>
          </MenuItem>
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
      </Box>

      {/* ---------- Row 2: grouped pill tabs ---------- */}
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
        {pillGroups.map((group, gi) => (
          <React.Fragment key={gi}>
            {gi > 0 && <Box sx={{ width: '1px', height: 22, bgcolor: 'divider', flexShrink: 0 }} />}
            <Box sx={{ display: 'inline-flex', gap: 0.25, alignItems: 'center' }}>
              {group.map((item) => {
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
                    {item.navLabel || item.breadcrumbLabel}
                  </Box>
                );
              })}
            </Box>
          </React.Fragment>
        ))}
      </Box>
    </Box>
  );
});

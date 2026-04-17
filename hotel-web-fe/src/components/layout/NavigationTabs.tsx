import React from 'react';
import { Box, Tabs, Tab, Typography, Avatar, Menu, MenuItem, ListItemIcon, ListItemText, Divider, IconButton, Tooltip } from '@mui/material';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import EventNoteIcon from '@mui/icons-material/EventNote';
import PeopleIcon from '@mui/icons-material/People';
import MeetingRoomIcon from '@mui/icons-material/MeetingRoom';
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser';
import SecurityIcon from '@mui/icons-material/Security';
import SettingsIcon from '@mui/icons-material/Settings';
import AssessmentIcon from '@mui/icons-material/Assessment';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import CardGiftcardIcon from '@mui/icons-material/CardGiftcard';
import CategoryIcon from '@mui/icons-material/Category';
import HomeWorkIcon from '@mui/icons-material/HomeWork';
import HistoryIcon from '@mui/icons-material/History';
import NightsStayIcon from '@mui/icons-material/NightsStay';
import SyncAltIcon from '@mui/icons-material/SyncAlt';
import LogoutIcon from '@mui/icons-material/Logout';
import PersonIcon from '@mui/icons-material/Person';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import ManageAccountsIcon from '@mui/icons-material/ManageAccounts';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';

const navIcons: Record<string, React.ReactElement> = {
  'timeline': <CalendarMonthIcon sx={{ fontSize: 18 }} />,
  'my-bookings': <EventNoteIcon sx={{ fontSize: 18 }} />,
  'guest-config': <PeopleIcon sx={{ fontSize: 18 }} />,
  'bookings': <EventNoteIcon sx={{ fontSize: 18 }} />,
  'room-management': <HomeWorkIcon sx={{ fontSize: 18 }} />,
  'ekyc-admin': <VerifiedUserIcon sx={{ fontSize: 18 }} />,
  'rbac': <SecurityIcon sx={{ fontSize: 18 }} />,
  'room-config': <MeetingRoomIcon sx={{ fontSize: 18 }} />,
  'room-type-config': <CategoryIcon sx={{ fontSize: 18 }} />,
  'company-ledger': <AccountBalanceIcon sx={{ fontSize: 18 }} />,
  'complimentary': <CardGiftcardIcon sx={{ fontSize: 18 }} />,
  'audit-log': <HistoryIcon sx={{ fontSize: 18 }} />,
  'night-audit': <NightsStayIcon sx={{ fontSize: 18 }} />,
  'data-transfer': <SyncAltIcon sx={{ fontSize: 18 }} />,
  'reports': <AssessmentIcon sx={{ fontSize: 18 }} />,
  'settings': <SettingsIcon sx={{ fontSize: 18 }} />,
};

type NavGroup = 'main' | 'operations' | 'admin' | 'config';

interface NavItem {
  id: string;
  label: string;
  path: string;
  permissions: string[];
  roles?: string[];
  excludeRoles?: string[];
  group: NavGroup;
}

const navigationItems: NavItem[] = [
  { id: 'timeline', label: 'Timeline', path: '/timeline', permissions: ['navigation_timeline:read', 'bookings:read'], roles: ['admin', 'receptionist', 'manager'], group: 'main' },
  { id: 'my-bookings', label: 'My Bookings', path: '/my-bookings', permissions: ['navigation_my_bookings:read'], excludeRoles: ['admin', 'receptionist', 'manager'], group: 'main' },
  { id: 'room-management', label: 'Rooms', path: '/room-management', permissions: ['navigation_room_management:read', 'rooms:read', 'rooms:manage'], roles: ['admin', 'receptionist', 'manager'], group: 'main' },
  { id: 'bookings', label: 'Bookings', path: '/bookings', permissions: ['navigation_bookings:read', 'bookings:manage'], roles: ['admin', 'receptionist', 'manager'], group: 'main' },
  { id: 'guest-config', label: 'Guests', path: '/guest-config', permissions: ['navigation_guest_config:read', 'guests:read', 'guests:manage'], roles: ['admin', 'receptionist', 'manager'], group: 'main' },
  { id: 'company-ledger', label: 'Ledger', path: '/company-ledger', permissions: ['ledgers:read', 'ledgers:manage'], roles: ['admin', 'receptionist', 'manager'], group: 'operations' },
  { id: 'reports', label: 'Reports', path: '/reports', permissions: [], group: 'operations' },
  { id: 'rbac', label: 'Access Control', path: '/rbac', permissions: ['rbac:manage', 'rbac:read', 'users:manage', 'users:read'], roles: ['admin', 'superadmin'], group: 'admin' },
  { id: 'ekyc-admin', label: 'eKYC Admin', path: '/ekyc-admin', permissions: ['ekyc:manage'], group: 'admin' },
  { id: 'complimentary', label: 'Complimentary Nights', path: '/complimentary', permissions: ['bookings:read', 'bookings:update'], roles: ['admin', 'manager', 'receptionist'], group: 'admin' },
  { id: 'audit-log', label: 'Audit Log', path: '/audit-log', permissions: ['audit:read'], roles: ['admin', 'superadmin'], group: 'admin' },
  { id: 'night-audit', label: 'Night Audit', path: '/night-audit', permissions: ['night_audit:read', 'night_audit:execute'], roles: ['admin', 'manager', 'receptionist'], group: 'admin' },
  { id: 'data-transfer', label: 'Data Transfer', path: '/data-transfer', permissions: ['settings:manage'], roles: ['admin'], group: 'admin' },
  { id: 'room-config', label: 'Room Configuration', path: '/room-config', permissions: ['navigation_room_config:read', 'rooms:update', 'rooms:manage'], roles: ['admin', 'receptionist', 'manager'], group: 'config' },
  { id: 'room-type-config', label: 'Room Types', path: '/room-type-config', permissions: ['rooms:write', 'rooms:manage'], roles: ['admin', 'manager'], group: 'config' },
  { id: 'settings', label: 'Settings', path: '/settings', permissions: ['navigation_settings:read', 'settings:read', 'settings:manage'], group: 'config' },
];

export const NavigationTabs = React.memo(function NavigationTabs() {
  const location = useLocation();
  const navigate = useNavigate();
  const { hasPermission, hasRole, logout, user } = useAuth();

  const canSeeItem = (item: NavItem): boolean => {
    const isExcluded = item.excludeRoles?.some(role =>
      hasRole(role) || hasRole(role.toLowerCase()) || hasRole(role.charAt(0).toUpperCase() + role.slice(1).toLowerCase())
    ) ?? false;
    if (isExcluded) return false;

    const noRestrictions = item.permissions.length === 0 && (!item.roles || item.roles.length === 0);
    if (noRestrictions) return true;

    const hasRequiredPermission = item.permissions.some(perm => hasPermission(perm));
    const hasRequiredRole = item.roles?.some(role =>
      hasRole(role) || hasRole(role.toLowerCase()) || hasRole(role.charAt(0).toUpperCase() + role.slice(1).toLowerCase())
    ) ?? false;

    return hasRequiredPermission || hasRequiredRole;
  };

  const visibleItems = navigationItems.filter(canSeeItem);
  const mainNavItems = visibleItems.filter(item => item.group === 'main' || item.group === 'operations');
  const moreMenuItems = visibleItems.filter(item => item.group === 'admin' || item.group === 'config');

  const visibleTabs = mainNavItems.map(item => item.path);
  const currentTab = visibleTabs.indexOf(location.pathname);
  const isMoreMenuActive = moreMenuItems.some(item => item.path === location.pathname);
  const activeTab = currentTab >= 0 ? currentTab : false;

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
  const [moreMenuAnchor, setMoreMenuAnchor] = React.useState<null | HTMLElement>(null);
  const moreMenuOpen = Boolean(moreMenuAnchor);

  const handleUserMenuOpen = (event: React.MouseEvent<HTMLElement>) => setUserMenuAnchor(event.currentTarget);
  const handleUserMenuClose = () => setUserMenuAnchor(null);
  const handleMoreMenuOpen = (event: React.MouseEvent<HTMLElement>) => setMoreMenuAnchor(event.currentTarget);
  const handleMoreMenuClose = () => setMoreMenuAnchor(null);

  const handleMenuItemClick = (path: string) => {
    handleUserMenuClose();
    handleMoreMenuClose();
    navigate(path);
  };

  const handleLogout = () => {
    handleUserMenuClose();
    logout();
    navigate('/login');
  };

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', gap: 1 }}>
      <Tabs
        value={activeTab}
        textColor="inherit"
        variant="scrollable"
        scrollButtons="auto"
        sx={{
          flexGrow: 1,
          minHeight: 56,
          '& .MuiTab-root': {
            color: 'rgba(255, 255, 255, 0.75)',
            fontWeight: 500,
            minHeight: 56,
            px: 2,
            fontSize: '0.85rem',
            textTransform: 'none',
            '&.Mui-selected': { color: 'white', fontWeight: 600 },
            '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.08)', color: 'white' },
          },
          '& .MuiTabs-indicator': { backgroundColor: 'white', height: 3, borderRadius: '3px 3px 0 0' },
          '& .MuiTabs-scrollButtons': { color: 'white', '&.Mui-disabled': { opacity: 0.3 } },
        }}
      >
        {mainNavItems.map(item => (
          <Tab
            key={item.id}
            icon={navIcons[item.id] || undefined}
            iconPosition="start"
            label={item.label}
            component={Link}
            to={item.path}
            sx={{ gap: 0.75, '& .MuiTab-iconWrapper': { marginRight: 0, marginBottom: 0 } }}
          />
        ))}
      </Tabs>

      {moreMenuItems.length > 0 && (
        <>
          <Tooltip title="More options">
            <IconButton
              onClick={handleMoreMenuOpen}
              sx={{
                color: isMoreMenuActive ? 'white' : 'rgba(255, 255, 255, 0.75)',
                bgcolor: isMoreMenuActive || moreMenuOpen ? 'rgba(255, 255, 255, 0.15)' : 'transparent',
                borderRadius: 2,
                px: 1.5,
                '&:hover': { bgcolor: 'rgba(255, 255, 255, 0.15)', color: 'white' },
              }}
            >
              <MoreHorizIcon sx={{ fontSize: 20 }} />
              <Typography variant="body2" sx={{ ml: 0.5, fontSize: '0.85rem', fontWeight: isMoreMenuActive ? 600 : 500, display: { xs: 'none', sm: 'block' } }}>
                More
              </Typography>
            </IconButton>
          </Tooltip>

          <Menu
            anchorEl={moreMenuAnchor}
            open={moreMenuOpen}
            onClose={handleMoreMenuClose}
            transformOrigin={{ horizontal: 'right', vertical: 'top' }}
            anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
            slotProps={{ paper: { elevation: 8, sx: { mt: 1, minWidth: 220, borderRadius: 2, overflow: 'visible', '&::before': { content: '""', display: 'block', position: 'absolute', top: 0, right: 20, width: 10, height: 10, bgcolor: 'background.paper', transform: 'translateY(-50%) rotate(45deg)', zIndex: 0 } } } }}
          >
            {moreMenuItems.filter(item => item.group === 'admin').length > 0 && (
              <Box sx={{ px: 2, py: 1, bgcolor: 'grey.50' }}>
                <Typography variant="caption" color="text.secondary" fontWeight={600}>ADMINISTRATION</Typography>
              </Box>
            )}
            {moreMenuItems.filter(item => item.group === 'admin').map(item => (
              <MenuItem key={item.id} onClick={() => handleMenuItemClick(item.path)} selected={location.pathname === item.path} sx={{ py: 1.25 }}>
                <ListItemIcon>{navIcons[item.id]}</ListItemIcon>
                <ListItemText>{item.label}</ListItemText>
              </MenuItem>
            ))}
            {moreMenuItems.filter(item => item.group === 'admin').length > 0 && moreMenuItems.filter(item => item.group === 'config').length > 0 && <Divider />}
            {moreMenuItems.filter(item => item.group === 'config').length > 0 && (
              <Box sx={{ px: 2, py: 1, bgcolor: 'grey.50' }}>
                <Typography variant="caption" color="text.secondary" fontWeight={600}>CONFIGURATION</Typography>
              </Box>
            )}
            {moreMenuItems.filter(item => item.group === 'config').map(item => (
              <MenuItem key={item.id} onClick={() => handleMenuItemClick(item.path)} selected={location.pathname === item.path} sx={{ py: 1.25 }}>
                <ListItemIcon>{navIcons[item.id]}</ListItemIcon>
                <ListItemText>{item.label}</ListItemText>
              </MenuItem>
            ))}
          </Menu>
        </>
      )}

      <Box sx={{ display: 'flex', alignItems: 'center', ml: 'auto' }}>
        <Box
          onClick={handleUserMenuOpen}
          sx={{
            display: 'flex', alignItems: 'center', gap: 1, pl: 0.75, pr: 1.5, py: 0.5, borderRadius: 3,
            backgroundColor: userMenuOpen ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.08)',
            border: '1px solid', borderColor: userMenuOpen ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.12)',
            cursor: 'pointer', userSelect: 'none',
            '&:hover': { backgroundColor: 'rgba(255,255,255,0.15)', borderColor: 'rgba(255,255,255,0.25)' },
          }}
        >
          <Box sx={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Avatar sx={{ width: 32, height: 32, fontSize: '0.8rem', fontWeight: 700, background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: 'white', boxShadow: '0 2px 8px rgba(102,126,234,0.4)' }}>
              {getUserInitials()}
            </Avatar>
            <Box sx={{ position: 'absolute', bottom: -1, right: -1, width: 10, height: 10, borderRadius: '50%', bgcolor: '#4caf50', border: '2px solid #1a1a2e' }} />
          </Box>
          <Box sx={{ display: { xs: 'none', md: 'flex' }, flexDirection: 'column', alignItems: 'flex-start' }}>
            <Typography variant="body2" sx={{ color: 'white', fontWeight: 600, fontSize: '0.8rem', lineHeight: 1.2 }}>
              {user?.full_name || user?.username}
            </Typography>
            <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.65rem', lineHeight: 1, textTransform: 'capitalize' }}>
              {user?.username || 'Staff'}
            </Typography>
          </Box>
          <KeyboardArrowDownIcon sx={{ fontSize: 18, color: 'rgba(255,255,255,0.6)', transition: 'transform 0.2s', transform: userMenuOpen ? 'rotate(180deg)' : 'rotate(0deg)' }} />
        </Box>

        <Menu
          anchorEl={userMenuAnchor}
          open={userMenuOpen}
          onClose={handleUserMenuClose}
          onClick={handleUserMenuClose}
          transformOrigin={{ horizontal: 'right', vertical: 'top' }}
          anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
          slotProps={{ paper: { elevation: 8, sx: { mt: 1, minWidth: 200, borderRadius: 2, overflow: 'visible', '&::before': { content: '""', display: 'block', position: 'absolute', top: 0, right: 20, width: 10, height: 10, bgcolor: 'background.paper', transform: 'translateY(-50%) rotate(45deg)', zIndex: 0 } } } }}
        >
          <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>{user?.full_name || user?.username}</Typography>
            <Typography variant="caption" color="text.secondary">{user?.email || user?.username}</Typography>
          </Box>
          <MenuItem onClick={() => handleMenuItemClick('/profile?edit=true')} sx={{ py: 1.25 }}>
            <ListItemIcon><PersonIcon fontSize="small" /></ListItemIcon>
            <ListItemText>My Profile</ListItemText>
          </MenuItem>
          <MenuItem onClick={() => handleMenuItemClick('/settings')} sx={{ py: 1.25 }}>
            <ListItemIcon><ManageAccountsIcon fontSize="small" /></ListItemIcon>
            <ListItemText>Account Settings</ListItemText>
          </MenuItem>
          <MenuItem onClick={() => handleMenuItemClick('/help')} sx={{ py: 1.25 }}>
            <ListItemIcon><HelpOutlineIcon fontSize="small" /></ListItemIcon>
            <ListItemText>Help & Support</ListItemText>
          </MenuItem>
          <Divider sx={{ my: 1 }} />
          <MenuItem onClick={handleLogout} sx={{ py: 1.25, color: 'error.main', '&:hover': { backgroundColor: 'error.lighter' } }}>
            <ListItemIcon><LogoutIcon fontSize="small" sx={{ color: 'error.main' }} /></ListItemIcon>
            <ListItemText>Sign Out</ListItemText>
          </MenuItem>
        </Menu>
      </Box>
    </Box>
  );
});

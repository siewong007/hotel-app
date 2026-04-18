import React from 'react';
import { Box, Tabs, Tab, Typography, Avatar, Menu, MenuItem, ListItemIcon, ListItemText, Divider, IconButton, Tooltip } from '@mui/material';
import LogoutIcon from '@mui/icons-material/Logout';
import PersonIcon from '@mui/icons-material/Person';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import ManageAccountsIcon from '@mui/icons-material/ManageAccounts';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { canAccessNavigationRoute, navigationRouteDefinitions, preloadRoute } from '../../navigation/routeRegistry';

export const NavigationTabs = React.memo(function NavigationTabs() {
  const location = useLocation();
  const navigate = useNavigate();
  const { hasPermission, hasRole, logout, user } = useAuth();

  const visibleItems = navigationRouteDefinitions.filter((item) =>
    canAccessNavigationRoute(item, { hasPermission, hasRole })
  );
  const mainNavItems = visibleItems.filter((item) => item.navGroup === 'main' || item.navGroup === 'operations');
  const moreMenuItems = visibleItems.filter((item) => item.navGroup === 'admin' || item.navGroup === 'config');
  const preloadSignature = visibleItems.map((item) => item.path).join('|');

  React.useEffect(() => {
    if (visibleItems.length === 0) {
      return;
    }

    const idleCallback = window.requestIdleCallback?.(() => {
      visibleItems.slice(0, 4).forEach((item) => preloadRoute(item.path));
    });

    if (idleCallback !== undefined) {
      return () => window.cancelIdleCallback?.(idleCallback);
    }

    const timeoutId = window.setTimeout(() => {
      visibleItems.slice(0, 4).forEach((item) => preloadRoute(item.path));
    }, 300);

    return () => window.clearTimeout(timeoutId);
  }, [preloadSignature]);

  const visibleTabs = mainNavItems.map((item) => item.path);
  const currentTab = visibleTabs.indexOf(location.pathname);
  const isMoreMenuActive = moreMenuItems.some((item) => item.path === location.pathname);
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

  const renderNavIcon = (item: (typeof visibleItems)[number], size: number) => {
    const Icon = item.icon;
    return Icon ? <Icon sx={{ fontSize: size }} /> : undefined;
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
            icon={renderNavIcon(item, 18)}
            iconPosition="start"
            label={item.navLabel || item.breadcrumbLabel}
            component={Link}
            to={item.path}
            sx={{ gap: 0.75, '& .MuiTab-iconWrapper': { marginRight: 0, marginBottom: 0 } }}
            onMouseEnter={() => preloadRoute(item.path)}
            onFocus={() => preloadRoute(item.path)}
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
            {moreMenuItems.filter(item => item.navGroup === 'admin').length > 0 && (
              <Box sx={{ px: 2, py: 1, bgcolor: 'grey.50' }}>
                <Typography variant="caption" color="text.secondary" fontWeight={600}>ADMINISTRATION</Typography>
              </Box>
            )}
            {moreMenuItems.filter(item => item.navGroup === 'admin').map(item => (
              <MenuItem
                key={item.id}
                onClick={() => handleMenuItemClick(item.path)}
                selected={location.pathname === item.path}
                sx={{ py: 1.25 }}
                onMouseEnter={() => preloadRoute(item.path)}
                onFocus={() => preloadRoute(item.path)}
              >
                <ListItemIcon>{renderNavIcon(item, 18)}</ListItemIcon>
                <ListItemText>{item.navLabel || item.breadcrumbLabel}</ListItemText>
              </MenuItem>
            ))}
            {moreMenuItems.filter(item => item.navGroup === 'admin').length > 0 && moreMenuItems.filter(item => item.navGroup === 'config').length > 0 && <Divider />}
            {moreMenuItems.filter(item => item.navGroup === 'config').length > 0 && (
              <Box sx={{ px: 2, py: 1, bgcolor: 'grey.50' }}>
                <Typography variant="caption" color="text.secondary" fontWeight={600}>CONFIGURATION</Typography>
              </Box>
            )}
            {moreMenuItems.filter(item => item.navGroup === 'config').map(item => (
              <MenuItem
                key={item.id}
                onClick={() => handleMenuItemClick(item.path)}
                selected={location.pathname === item.path}
                sx={{ py: 1.25 }}
                onMouseEnter={() => preloadRoute(item.path)}
                onFocus={() => preloadRoute(item.path)}
              >
                <ListItemIcon>{renderNavIcon(item, 18)}</ListItemIcon>
                <ListItemText>{item.navLabel || item.breadcrumbLabel}</ListItemText>
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
          <MenuItem
            onClick={() => handleMenuItemClick('/profile?edit=true')}
            sx={{ py: 1.25 }}
            onMouseEnter={() => preloadRoute('/profile')}
            onFocus={() => preloadRoute('/profile')}
          >
            <ListItemIcon><PersonIcon fontSize="small" /></ListItemIcon>
            <ListItemText>My Profile</ListItemText>
          </MenuItem>
          <MenuItem
            onClick={() => handleMenuItemClick('/settings')}
            sx={{ py: 1.25 }}
            onMouseEnter={() => preloadRoute('/settings')}
            onFocus={() => preloadRoute('/settings')}
          >
            <ListItemIcon><ManageAccountsIcon fontSize="small" /></ListItemIcon>
            <ListItemText>Account Settings</ListItemText>
          </MenuItem>
          <MenuItem
            onClick={() => handleMenuItemClick('/help')}
            sx={{ py: 1.25 }}
            onMouseEnter={() => preloadRoute('/help')}
            onFocus={() => preloadRoute('/help')}
          >
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

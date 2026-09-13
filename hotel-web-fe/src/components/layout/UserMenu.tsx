import React from 'react';
import {
  Avatar,
  Box,
  Divider,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Typography,
  useTheme,
} from '@mui/material';
import HelpOutlineIcon from '@mui/icons-material/HelpOutlined';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import LogoutIcon from '@mui/icons-material/Logout';
import ManageAccountsIcon from '@mui/icons-material/ManageAccounts';
import PersonIcon from '@mui/icons-material/Person';
import { useNavigate } from '../../router';
import { useAuth } from '../../auth/AuthContext';
import { useTranslation } from '../../i18n';
import { preloadRoute } from '../../navigation/routeRegistry';

interface UserMenuProps {
  /**
   * `avatar` — compact pill for the topbar. `card` — the roomier expanded
   * sidebar bottom card; identical menu either way.
   */
  variant?: 'avatar' | 'card';
}

/**
 * Account menu: profile, hotel settings (staff only), help, sign out.
 * Extracted from NavigationTabs' user pill — the trigger is a real <button>
 * so it is keyboard-focusable, which the div-onClick original was not.
 */
export const UserMenu: React.FC<UserMenuProps> = ({ variant = 'avatar' }) => {
  const theme = useTheme();
  const navigate = useNavigate();
  const { logout, user, hasRole, roles } = useAuth();
  const { t: tNav, tOr } = useTranslation('nav');
  const isGuest = hasRole('guest') || user?.user_type === 'guest';
  const displayEmail = user?.email?.endsWith('@no-email.invalid') ? '' : user?.email;

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

  const getUserInitials = () => {
    if (user?.full_name) {
      const names = user.full_name.split(' ');
      return names.length > 1
        ? `${names[0][0]}${names[names.length - 1][0]}`.toUpperCase()
        : names[0][0].toUpperCase();
    }
    return user?.username?.[0]?.toUpperCase() || 'U';
  };

  const avatar = (
    <Avatar
      sx={{
        width: variant === 'card' ? 32 : 28,
        height: variant === 'card' ? 32 : 28,
        fontSize: '0.75rem',
        fontWeight: 800,
        background: `linear-gradient(135deg,#fff,${theme.palette.primary.light})`,
        color: theme.palette.primary.dark,
        flexShrink: 0,
      }}
    >
      {getUserInitials()}
    </Avatar>
  );

  const chevron = (
    <KeyboardArrowDownIcon
      sx={{
        fontSize: 18,
        color: 'text.secondary',
        transition: 'transform 0.2s',
        transform: userMenuOpen ? 'rotate(180deg)' : 'none',
        flexShrink: 0,
      }}
    />
  );

  const trigger =
    variant === 'card' ? (
      <Box
        component="button"
        type="button"
        aria-haspopup="menu"
        aria-expanded={userMenuOpen}
        aria-label={tNav('aria.userMenu')}
        onClick={(e) => setUserMenuAnchor(e.currentTarget)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.25,
          width: '100%',
          px: 1.25,
          py: 1,
          borderRadius: 2,
          textAlign: 'left',
          cursor: 'pointer',
          userSelect: 'none',
          fontFamily: 'inherit',
          color: 'text.primary',
          border: '1px solid',
          borderColor: 'divider',
          bgcolor: userMenuOpen ? 'action.selected' : 'background.paper',
          '&:hover': { bgcolor: 'action.hover' },
        }}
      >
        {avatar}
        <Box sx={{ flex: 1, minWidth: 0, lineHeight: 1.2 }}>
          <Typography noWrap sx={{ fontSize: '0.8rem', fontWeight: 600 }}>
            {user?.full_name || user?.username}
          </Typography>
          <Typography
            noWrap
            sx={{ fontSize: '0.66rem', color: 'text.secondary', textTransform: 'capitalize' }}
          >
            {roles[0]?.replace(/[_-]+/g, ' ') || user?.username || 'Staff'}
          </Typography>
        </Box>
        {chevron}
      </Box>
    ) : (
      <Box
        component="button"
        type="button"
        aria-haspopup="menu"
        aria-expanded={userMenuOpen}
        aria-label={tNav('aria.userMenu')}
        onClick={(e) => setUserMenuAnchor(e.currentTarget)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          pl: 0.5,
          pr: 1.25,
          py: 0.5,
          borderRadius: 999,
          flexShrink: 0,
          cursor: 'pointer',
          userSelect: 'none',
          fontFamily: 'inherit',
          color: 'text.primary',
          border: '1px solid',
          borderColor: 'divider',
          bgcolor: userMenuOpen ? 'action.selected' : 'transparent',
          '&:hover': { bgcolor: 'action.hover' },
        }}
      >
        {avatar}
        <Box
          sx={{
            display: { xs: 'none', md: 'flex' },
            flexDirection: 'column',
            lineHeight: 1.1,
            textAlign: 'left',
          }}
        >
          <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: 'text.primary' }}>
            {user?.full_name || user?.username}
          </Typography>
          <Typography
            sx={{ fontSize: '0.62rem', color: 'text.secondary', textTransform: 'capitalize' }}
          >
            {user?.username || 'Staff'}
          </Typography>
        </Box>
        {chevron}
      </Box>
    );

  return (
    <>
      {trigger}
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
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
            {user?.full_name || user?.username}
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {displayEmail || user?.username}
          </Typography>
        </Box>
        <MenuItem
          onClick={() => handleMenuItemClick('/profile?edit=true')}
          sx={{ py: 1.25 }}
          onMouseEnter={() => preloadRoute('/profile')}
        >
          <ListItemIcon>
            <PersonIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{tOr('userMenu.profile', 'My Profile')}</ListItemText>
        </MenuItem>
        {!isGuest && (
          <MenuItem
            onClick={() => handleMenuItemClick('/settings')}
            sx={{ py: 1.25 }}
            onMouseEnter={() => preloadRoute('/settings')}
          >
            <ListItemIcon>
              <ManageAccountsIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{tOr('routes.settings.breadcrumb', 'Hotel Settings')}</ListItemText>
          </MenuItem>
        )}
        <MenuItem
          onClick={() => handleMenuItemClick('/help')}
          sx={{ py: 1.25 }}
          onMouseEnter={() => preloadRoute('/help')}
        >
          <ListItemIcon>
            <HelpOutlineIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{tOr('routes.help.breadcrumb', 'Help & Support')}</ListItemText>
        </MenuItem>
        <Divider sx={{ my: 1 }} />
        <MenuItem onClick={handleLogout} sx={{ py: 1.25, color: 'error.main' }}>
          <ListItemIcon>
            <LogoutIcon fontSize="small" sx={{ color: 'error.main' }} />
          </ListItemIcon>
          <ListItemText>{tOr('userMenu.logout', 'Sign Out')}</ListItemText>
        </MenuItem>
      </Menu>
    </>
  );
};

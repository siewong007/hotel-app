import React from 'react';
import { Box, IconButton, Tooltip, Typography } from '@mui/material';
import LogoutIcon from '@mui/icons-material/Logout';
import SearchIcon from '@mui/icons-material/Search';
import { useNavigate } from '../../router';
import { useAuth } from '../../auth/AuthContext';
import { useTranslation } from '../../i18n';
import { LanguageSwitcher } from '../common/LanguageSwitcher';
import { Breadcrumbs, CurrentPageTitle } from './Breadcrumbs';
import { useCommandPalette } from './CommandPalette';
import { NotificationCenter } from './NotificationCenter';
import { UserMenu } from './UserMenu';

/**
 * The staff shell's 56px header: breadcrumbs on the left (current page title
 * below `sm`, where the trail does not fit); command-palette trigger,
 * notification bell, language, account menu and a one-tap sign-out on the
 * right. Below `md` navigation lives in the bottom bar — there is no drawer,
 * so the header carries no menu button.
 */
export const AppTopbar: React.FC = () => {
  const { open: openPalette } = useCommandPalette();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const { t: tNav, tOr } = useTranslation('nav');

  // Same path as the account menu's Sign Out: end the session, then leave the
  // staff document for the login page. `logout` settles any in-flight attempt
  // itself, so a double tap cannot wedge the session.
  const handleLogout = () => {
    logout();
    navigate('/login');
  };
  const logoutLabel = tOr('userMenu.logout', 'Log out');

  return (
    <Box
      component="header"
      sx={(theme) => ({
        height: 56,
        px: { xs: 1.5, sm: 2.5 },
        display: 'flex',
        alignItems: 'center',
        gap: { xs: 0.5, sm: 1.5 },
        bgcolor: 'background.paper',
        borderBottom: '1px solid',
        borderColor: 'divider',
        position: 'sticky',
        top: 0,
        zIndex: theme.zIndex.appBar,
      })}
    >
      <Box sx={{ display: { xs: 'flex', sm: 'none' }, minWidth: 0, flex: 1 }}>
        <CurrentPageTitle />
      </Box>
      <Box sx={{ display: { xs: 'none', sm: 'block' }, minWidth: 0, flex: 1 }}>
        <Breadcrumbs />
      </Box>

      {/* Command-palette trigger: field-style ≥sm. On phones the FAB's
          quick-actions sheet already carries Search, so an xs icon here would
          be a duplicate control the header cannot afford at 320px. */}
      <Box
        component="button"
        type="button"
        aria-label={tNav('aria.search')}
        onClick={openPalette}
        sx={{
          display: { xs: 'none', sm: 'flex' },
          alignItems: 'center',
          gap: 1.25,
          width: 'min(320px, 100%)',
          height: 40,
          px: 1.75,
          borderRadius: 2.5,
          border: '1px solid',
          borderColor: 'divider',
          bgcolor: 'action.hover',
          color: 'text.secondary',
          fontFamily: 'inherit',
          cursor: 'text',
          flexShrink: 0,
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
          {tNav('aria.search')}
        </Typography>
        <Box
          sx={{
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

      <NotificationCenter />
      <LanguageSwitcher color="inherit" size="small" />
      <UserMenu variant="avatar" />
      {/* One-tap sign-out beside the account pill — the menu's Sign Out stays
          as the discoverable path, this is the direct one. */}
      <Tooltip title={logoutLabel}>
        <IconButton
          aria-label={logoutLabel}
          onClick={handleLogout}
          sx={{ flexShrink: 0, color: 'text.secondary' }}
        >
          <LogoutIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  );
};

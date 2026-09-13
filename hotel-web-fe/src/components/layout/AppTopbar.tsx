import React from 'react';
import { Box, IconButton, Typography } from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import SearchIcon from '@mui/icons-material/Search';
import { useTranslation } from '../../i18n';
import { LanguageSwitcher } from '../common/LanguageSwitcher';
import { Breadcrumbs } from './Breadcrumbs';
import { useCommandPalette } from './CommandPalette';
import { NotificationCenter } from './NotificationCenter';
import { UserMenu } from './UserMenu';

interface AppTopbarProps {
  /** Opens the mobile navigation drawer; the hamburger renders only when `isNarrow`. */
  onMenuClick: () => void;
  /** Below the sidebar breakpoint — no drawer means the nav needs a hamburger. */
  isNarrow: boolean;
}

/**
 * The staff shell's 56px header: breadcrumbs on the left; command-palette
 * trigger, notification bell, language and account menu on the right.
 * RootLayout wires `onMenuClick`/`isNarrow` to the sidebar drawer.
 */
export const AppTopbar: React.FC<AppTopbarProps> = ({ onMenuClick, isNarrow }) => {
  const { open: openPalette } = useCommandPalette();
  const { t: tNav } = useTranslation('nav');

  return (
    <Box
      component="header"
      sx={(theme) => ({
        height: 56,
        px: { xs: 1.5, sm: 2.5 },
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        bgcolor: 'background.paper',
        borderBottom: '1px solid',
        borderColor: 'divider',
        position: 'sticky',
        top: 0,
        zIndex: theme.zIndex.appBar,
      })}
    >
      {isNarrow && (
        <IconButton
          color="inherit"
          aria-label={tNav('aria.openMenu')}
          onClick={onMenuClick}
          sx={{ mr: -1, flexShrink: 0 }}
        >
          <MenuIcon />
        </IconButton>
      )}

      <Box sx={{ display: { xs: 'none', sm: 'block' }, minWidth: 0 }}>
        <Breadcrumbs />
      </Box>
      <Box sx={{ flex: 1 }} />

      {/* Command-palette trigger: a compact icon button on xs so the bell,
          language and user menu stay on-screen; a field-style trigger ≥sm. */}
      <IconButton
        aria-label={tNav('aria.search')}
        onClick={openPalette}
        sx={{ display: { xs: 'inline-flex', sm: 'none' }, flexShrink: 0 }}
      >
        <SearchIcon fontSize="small" />
      </IconButton>
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
    </Box>
  );
};

import React from 'react';
import { Drawer, useMediaQuery, useTheme } from '@mui/material';
import { storage } from '../../../utils/storage';
import { SidebarContent } from './SidebarContent';

export const SIDEBAR_WIDTH_EXPANDED = 264;
export const SIDEBAR_WIDTH_COLLAPSED = 72;

interface AppSidebarProps {
  /** Opens the temporary drawer below `md`. */
  mobileOpen: boolean;
  onMobileClose: () => void;
}

/**
 * The staff shell's left navigation host. ≥md renders a permanent drawer
 * whose 264↔72 rail width persists in `storage` under 'navCollapsed'; below
 * `md` it becomes a temporary drawer driven by the topbar hamburger. Both
 * host the same `SidebarContent` — the rail is a desktop-only mode, so the
 * mobile drawer is always expanded.
 */
export const AppSidebar: React.FC<AppSidebarProps> = ({ mobileOpen, onMobileClose }) => {
  const theme = useTheme();
  const isNarrow = useMediaQuery(theme.breakpoints.down('md'));
  const [collapsed, setCollapsed] = React.useState(
    () => storage.getItem<boolean>('navCollapsed') ?? false
  );

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    storage.setItem('navCollapsed', next);
  };

  const content = (
    <SidebarContent
      collapsed={!isNarrow && collapsed}
      onToggleCollapse={toggle}
      onNavigate={onMobileClose}
    />
  );

  if (isNarrow) {
    return (
      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={onMobileClose}
        ModalProps={{ keepMounted: true }}
        sx={{
          '& .MuiDrawer-paper': {
            width: SIDEBAR_WIDTH_EXPANDED,
            maxWidth: '85vw',
            boxSizing: 'border-box',
            bgcolor: 'background.paper',
            borderRight: '1px solid',
            borderColor: 'divider',
          },
        }}
      >
        {content}
      </Drawer>
    );
  }

  const width = collapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED;
  return (
    <Drawer
      variant="permanent"
      open
      sx={{
        width,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
          width,
          boxSizing: 'border-box',
          bgcolor: 'background.paper',
          borderRight: '1px solid',
          borderColor: 'divider',
          overflowX: 'hidden',
          transition: 'width 0.2s',
        },
      }}
    >
      {content}
    </Drawer>
  );
};

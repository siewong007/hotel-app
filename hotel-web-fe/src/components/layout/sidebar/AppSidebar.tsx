import React from 'react';
import { Drawer, useMediaQuery, useTheme } from '@mui/material';
import { storage } from '../../../utils/storage';
import { SidebarContent } from './SidebarContent';

export const SIDEBAR_WIDTH_EXPANDED = 264;
export const SIDEBAR_WIDTH_COLLAPSED = 72;

/**
 * The staff shell's left navigation host. ≥md renders a permanent drawer
 * whose 264↔72 rail width persists in `storage` under 'navCollapsed'. Below
 * `md` it renders nothing: phone/tablet navigation is the bottom bar plus its
 * More sheet (see `MobileNavBar`), which already exposes every module the
 * drawer used to — a second full menu would duplicate it.
 */
export const AppSidebar: React.FC = () => {
  const theme = useTheme();
  // `noSsr` resolves the query client-side on first render — without it the
  // mobile first paint flashes the permanent desktop drawer for a frame.
  const isNarrow = useMediaQuery(theme.breakpoints.down('md'), { noSsr: true });
  const [collapsed, setCollapsed] = React.useState(
    () => storage.getItem<boolean>('navCollapsed') ?? false
  );

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    storage.setItem('navCollapsed', next);
  };

  if (isNarrow) return null;

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
      <SidebarContent collapsed={collapsed} onToggleCollapse={toggle} />
    </Drawer>
  );
};

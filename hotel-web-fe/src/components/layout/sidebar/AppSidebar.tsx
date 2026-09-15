import React from 'react';
import { Drawer, useMediaQuery, useTheme } from '@mui/material';
import { storage } from '../../../utils/storage';
import { SidebarContent } from './SidebarContent';

export const SIDEBAR_WIDTH_EXPANDED = 264;
export const SIDEBAR_WIDTH_COLLAPSED = 72;

/**
 * The staff shell's left navigation host, in three states:
 *
 *   <sm  (phones)   nothing — navigation is the bottom bar plus its More
 *                   sheet (see `MobileNavBar`), which already exposes every
 *                   module the drawer would; a second full menu would
 *                   duplicate it.
 *   sm-lg (tablets) a permanent 72px icon rail, forced regardless of the
 *                   stored preference. An expanded 264px drawer would eat 34%
 *                   of an iPad portrait viewport, and the previous behaviour —
 *                   no sidebar at all until 900px — gave iPad Mini (744),
 *                   iPad (768) and iPad Air (820) the phone shell.
 *   >=lg (desktop)  permanent drawer at the user's 264<->72 preference,
 *                   persisted in `storage` under 'navCollapsed'.
 *
 * `sm` is the phone/tablet boundary the rest of the shell already uses —
 * `AppTopbar` switches its search field, language control and sign-out there —
 * so the sidebar and bottom bar now agree with the header instead of
 * switching 300px later.
 */
export const AppSidebar: React.FC = () => {
  const theme = useTheme();
  // `noSsr` resolves the query client-side on first render — without it the
  // mobile first paint flashes the permanent desktop drawer for a frame.
  const isPhone = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });
  // Tablets get the rail whatever the stored preference says; the toggle is
  // hidden there so the user is never shown a control that cannot take effect.
  const railLocked = useMediaQuery(theme.breakpoints.down('lg'), { noSsr: true });
  const [collapsed, setCollapsed] = React.useState(
    () => storage.getItem<boolean>('navCollapsed') ?? false
  );

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    storage.setItem('navCollapsed', next);
  };

  if (isPhone) return null;

  const showRail = collapsed || railLocked;
  const width = showRail ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED;
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
      <SidebarContent
        collapsed={showRail}
        onToggleCollapse={toggle}
        railLocked={railLocked}
      />
    </Drawer>
  );
};

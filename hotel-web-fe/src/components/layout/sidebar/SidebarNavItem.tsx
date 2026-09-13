import React from 'react';
import { ListItemButton, ListItemIcon, ListItemText, Tooltip } from '@mui/material';
import { Link } from '../../../router';
import { isNavItemActive } from '../../../navigation/isNavItemActive';
import { preloadRoute, type AppRouteDefinition } from '../../../navigation/routeRegistry';
import { useRouteLabels } from '../../../navigation/routeLabels';

interface SidebarNavItemProps {
  item: AppRouteDefinition;
  /** Current location pathname — threaded down so all rows share one useLocation. */
  pathname: string;
  /** Icon-rail mode: labels hide and each row gains a right-side tooltip. */
  collapsed: boolean;
  /** Lets the mobile drawer close itself after a destination is picked. */
  onNavigate?: () => void;
}

/**
 * One sidebar row: icon + translated label, active state from
 * `isNavItemActive` (Task 1), and a 3px primary bar as the non-color active
 * indicator. In the collapsed rail the label drops and a Tooltip carries it.
 */
export const SidebarNavItem: React.FC<SidebarNavItemProps> = ({
  item,
  pathname,
  collapsed,
  onNavigate,
}) => {
  const { navLabel } = useRouteLabels();
  const active = isNavItemActive(pathname, item);
  const Icon = item.icon;
  const label = navLabel(item);

  const button = (
    <ListItemButton
      component={Link}
      to={item.path}
      selected={active}
      aria-current={active ? 'page' : undefined}
      aria-label={collapsed ? label : undefined}
      onClick={onNavigate}
      onMouseEnter={() => preloadRoute(item.path)}
      onFocus={() => preloadRoute(item.path)}
      sx={{
        mx: 1,
        borderRadius: 1.5,
        minHeight: 40,
        px: 1.25,
        gap: 0,
        justifyContent: collapsed ? 'center' : 'flex-start',
        color: active ? 'text.primary' : 'text.secondary',
        '&.Mui-selected': { bgcolor: 'action.selected' },
        '&.Mui-selected::before': {
          // Non-color active indicator: a 3px bar keeps the current page
          // legible without relying on the fill alone.
          content: '""',
          position: 'absolute',
          left: -8,
          top: 8,
          bottom: 8,
          width: 3,
          borderRadius: 2,
          bgcolor: 'primary.main',
        },
        position: 'relative',
      }}
    >
      <ListItemIcon
        sx={{ minWidth: collapsed ? 0 : 36, color: active ? 'primary.main' : 'text.secondary' }}
      >
        {Icon && <Icon sx={{ fontSize: 20 }} />}
      </ListItemIcon>
      {!collapsed && (
        <ListItemText
          primary={label}
          slotProps={{
            primary: {
              noWrap: true,
              sx: { fontSize: '0.85rem', fontWeight: active ? 700 : 500 },
            },
          }}
        />
      )}
    </ListItemButton>
  );

  return collapsed ? (
    <Tooltip title={label} placement="right">
      {button}
    </Tooltip>
  ) : (
    button
  );
};

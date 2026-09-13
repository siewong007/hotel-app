import React from 'react';
import {
  Box,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
} from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { useLocation, useNavigate } from '../../router';
import { useAuth } from '../../auth/AuthContext';
import { useTranslation } from '../../i18n';
import { BottomSheet } from '../common/BottomSheet';
import {
  canAccessNavigationRoute,
  findRouteDefinition,
  navigationRouteDefinitions,
} from '../../navigation/routeRegistry';
import { navSections } from '../../navigation/navGroups';
import { isNavItemActive } from '../../navigation/isNavItemActive';
import { useRouteLabels } from '../../navigation/routeLabels';

interface MobileMoreSheetProps {
  open: boolean;
  onClose: () => void;
  /** Route ids already on the bottom bar — excluded so the sheet holds the rest. */
  tabIds: string[];
}

/**
 * The "More" destination of the staff bottom nav: every remaining
 * role-visible route grouped exactly like the sidebar (navGroups order +
 * labels), plus the non-nav account pages (Profile). Item visibility reuses
 * `canAccessNavigationRoute`, so the sheet can never expose a module the
 * sidebar would hide.
 */
export const MobileMoreSheet: React.FC<MobileMoreSheetProps> = ({ open, onClose, tabIds }) => {
  const { hasPermission, hasRole, getRoutePolicy } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { t: tNav } = useTranslation('nav');
  const { navLabel, groupLabel } = useRouteLabels();

  const sections = React.useMemo(() => {
    const remaining = navigationRouteDefinitions.filter(
      (item) =>
        !tabIds.includes(item.id) &&
        canAccessNavigationRoute(item, { hasPermission, hasRole, getRoutePolicy }),
    );
    return navSections(remaining);
  }, [hasPermission, hasRole, getRoutePolicy, tabIds]);

  const profileRoute = findRouteDefinition('/profile');

  const go = (path: string) => {
    onClose();
    navigate(path);
  };

  const renderItem = (id: string, path: string, label: string, Icon?: React.ElementType) => {
    const active = pathname === path;
    return (
      <ListItemButton
        key={id}
        onClick={() => go(path)}
        selected={active}
        aria-current={active ? 'page' : undefined}
        sx={{ borderRadius: 2 }}
      >
        {Icon ? (
          <ListItemIcon sx={{ minWidth: 40 }}>
            <Icon fontSize="small" />
          </ListItemIcon>
        ) : null}
        <ListItemText
          primary={label}
          slotProps={{ primary: { sx: { fontWeight: active ? 700 : 550, fontSize: '0.95rem' } } }}
        />
        <ChevronRightIcon fontSize="small" sx={{ color: 'text.disabled' }} />
      </ListItemButton>
    );
  };

  return (
    <BottomSheet open={open} onClose={onClose} title={tNav('mobile.menu')}>
      <List disablePadding>
        {sections.map((section) => (
          <Box key={section.group} component="li" sx={{ listStyle: 'none' }}>
            {section.labeled ? (
              <Typography
                variant="overline"
                component="div"
                sx={{ display: 'block', px: 1, pt: 1.5, color: 'text.secondary', fontSize: '0.68rem' }}
              >
                {groupLabel(section.group)}
              </Typography>
            ) : null}
            {section.items.map((item) => renderItem(item.id, item.path, navLabel(item), item.icon))}
          </Box>
        ))}
        {profileRoute ? (
          <Box component="li" sx={{ listStyle: 'none' }}>
            {renderItem(profileRoute.id, profileRoute.path, navLabel(profileRoute), profileRoute.icon)}
          </Box>
        ) : null}
      </List>
    </BottomSheet>
  );
};

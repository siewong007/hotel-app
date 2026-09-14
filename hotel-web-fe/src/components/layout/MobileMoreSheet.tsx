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
import { CollapsibleSection } from '../common/CollapsibleSection';
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
 * labels), plus the non-nav account pages (Profile). Labeled groups collapse
 * behind a section header — the first two stay open so the ~25-row list does
 * not open as a wall of rows; label-less groups render bare as before. Item
 * visibility reuses `canAccessNavigationRoute`, so the sheet can never
 * expose a module the sidebar would hide.
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

  const renderItem = (route: (typeof navigationRouteDefinitions)[number], label: string) => {
    // Shared matcher, not exact equality: `/admin-portal` must still highlight
    // the Overview row the way the bottom bar does.
    const active = isNavItemActive(pathname, route);
    const Icon = route.icon;
    return (
      <ListItemButton
        key={route.id}
        onClick={() => go(route.path)}
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
        {sections.map((section, index) => (
          <Box key={section.group} component="li" sx={{ listStyle: 'none' }}>
            {section.labeled ? (
              <CollapsibleSection
                title={
                  <Typography
                    variant="overline"
                    component="span"
                    sx={{ color: 'text.secondary', fontSize: '0.68rem' }}
                  >
                    {groupLabel(section.group)}
                  </Typography>
                }
                defaultExpanded={index < 2}
              >
                {section.items.map((item) => renderItem(item, navLabel(item)))}
              </CollapsibleSection>
            ) : (
              section.items.map((item) => renderItem(item, navLabel(item)))
            )}
          </Box>
        ))}
        {profileRoute ? (
          <Box component="li" sx={{ listStyle: 'none' }}>
            {renderItem(profileRoute, navLabel(profileRoute))}
          </Box>
        ) : null}
      </List>
    </BottomSheet>
  );
};

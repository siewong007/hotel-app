import React from 'react';
import {
  Box,
  Typography,
  Switch,
  FormControlLabel,
  Divider,
  alpha,
  Tooltip,
  Collapse,
} from '@mui/material';
import {
  EventNote as EventNoteIcon,
  People as PeopleIcon,
  Hotel as HotelIcon,
  Category as CategoryIcon,
  CalendarMonth as CalendarIcon,
  HomeWork as HomeWorkIcon,
  AccountBalance as AccountBalanceIcon,
  CardGiftcard as CardGiftcardIcon,
  Star as StarIcon,
  Assessment as AssessmentIcon,
  VerifiedUser as VerifiedUserIcon,
  Security as SecurityIcon,
  Settings as SettingsIcon,
} from '@mui/icons-material';
import type { RouteAccessPolicy } from '../../../../../types';

// Icon mapping by backend route id.
const NAV_ICON_MAP: Record<string, React.ElementType> = {
  timeline: EventNoteIcon,
  'guest-config': PeopleIcon,
  bookings: CalendarIcon,
  'room-management': HomeWorkIcon,
  'room-config': HotelIcon,
  'company-ledger': AccountBalanceIcon,
  complimentary: CardGiftcardIcon,
  loyalty: StarIcon,
  reports: AssessmentIcon,
  'ekyc-admin': VerifiedUserIcon,
  rbac: SecurityIcon,
  settings: SettingsIcon,
};

const NAVIGATION_CATEGORY_LABELS: Record<string, string> = {
  main: 'Main',
  operations: 'Operations',
  admin: 'Administration',
  config: 'Configuration',
};

interface NavigationAccessSectionProps {
  selectedNavItems: string[];
  routePolicies: RouteAccessPolicy[];
  onToggleNavItem: (navId: string, enabled: boolean) => void;
  disabled?: boolean;
}

const NavigationAccessSection: React.FC<NavigationAccessSectionProps> = ({
  selectedNavItems,
  routePolicies,
  onToggleNavItem,
  disabled = false,
}) => {
  // Group navigation items by category
  const navByCategory = routePolicies
    .filter((policy) => policy.is_navigation)
    .reduce((acc, policy) => {
    const category = policy.nav_group || 'config';
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(policy);
    return acc;
  }, {} as Record<string, RouteAccessPolicy[]>);

  const categories = ['main', 'operations', 'admin', 'config'];

  return (
    <Box>
      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
        Which tabs can this role access?
      </Typography>

      {categories.map((category) => {
        const items = navByCategory[category] || [];
        if (items.length === 0) return null;

        return (
          <Box key={category} sx={{ mb: 2 }}>
            <Typography
              variant="caption"
              fontWeight={600}
              color="text.secondary"
              sx={{
                display: 'block',
                mb: 1,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
              }}
            >
              {NAVIGATION_CATEGORY_LABELS[category]}
            </Typography>

            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: 0.5,
                pl: 1,
              }}
            >
              {items.map((item) => {
                const isEnabled = selectedNavItems.includes(item.route_id);
                const IconComponent = NAV_ICON_MAP[item.route_id] || SettingsIcon;
                const requiredPerms = Array.from(new Set([
                  ...item.nav_permissions,
                  ...item.required_permissions,
                ]));

                return (
                  <Tooltip
                    key={item.route_id}
                    title={
                      requiredPerms.length > 0
                        ? `Also grants: ${requiredPerms.join(', ')}`
                        : item.path
                    }
                    placement="right"
                    arrow
                  >
                    <FormControlLabel
                      control={
                        <Switch
                          size="small"
                          checked={isEnabled}
                          onChange={(e) => onToggleNavItem(item.route_id, e.target.checked)}
                          disabled={disabled}
                        />
                      }
                      label={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <IconComponent
                            sx={{
                              fontSize: 18,
                              color: isEnabled ? 'primary.main' : 'text.disabled',
                            }}
                          />
                          <Typography
                            variant="body2"
                            sx={{
                              color: isEnabled ? 'text.primary' : 'text.secondary',
                              fontWeight: isEnabled ? 500 : 400,
                            }}
                          >
                            {item.nav_label || item.route_id}
                          </Typography>
                        </Box>
                      }
                      sx={{
                        mx: 0,
                        py: 0.5,
                        px: 1,
                        borderRadius: 1,
                        '&:hover': {
                          backgroundColor: 'action.hover',
                        },
                      }}
                    />
                  </Tooltip>
                );
              })}
            </Box>

            {category !== 'system' && <Divider sx={{ mt: 2 }} />}
          </Box>
        );
      })}
    </Box>
  );
};

export default NavigationAccessSection;

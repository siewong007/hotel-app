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
  Book as BookIcon,
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
import { NAVIGATION_ITEMS, NAVIGATION_CATEGORY_LABELS, NAVIGATION_PERMISSION_MAPPING } from '../constants';
import type { NavigationItem } from '../types';

// Icon mapping
const NAV_ICON_MAP: Record<string, React.ElementType> = {
  EventNote: EventNoteIcon,
  Book: BookIcon,
  People: PeopleIcon,
  Hotel: HotelIcon,
  Category: CategoryIcon,
  CalendarMonth: CalendarIcon,
  HomeWork: HomeWorkIcon,
  AccountBalance: AccountBalanceIcon,
  CardGiftcard: CardGiftcardIcon,
  Star: StarIcon,
  Assessment: AssessmentIcon,
  VerifiedUser: VerifiedUserIcon,
  Security: SecurityIcon,
  Settings: SettingsIcon,
};

interface NavigationAccessSectionProps {
  selectedNavItems: string[];
  onToggleNavItem: (navId: string, enabled: boolean) => void;
  disabled?: boolean;
}

const NavigationAccessSection: React.FC<NavigationAccessSectionProps> = ({
  selectedNavItems,
  onToggleNavItem,
  disabled = false,
}) => {
  // Group navigation items by category
  const navByCategory = NAVIGATION_ITEMS.reduce((acc, item) => {
    if (!acc[item.category]) {
      acc[item.category] = [];
    }
    acc[item.category].push(item);
    return acc;
  }, {} as Record<string, NavigationItem[]>);

  const categories: Array<'core' | 'management' | 'analytics' | 'system'> = [
    'core',
    'management',
    'analytics',
    'system',
  ];

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
                const isEnabled = selectedNavItems.includes(item.id);
                const IconComponent = NAV_ICON_MAP[item.icon] || SettingsIcon;
                const requiredPerms = NAVIGATION_PERMISSION_MAPPING[item.id] || [];

                return (
                  <Tooltip
                    key={item.id}
                    title={
                      requiredPerms.length > 0
                        ? `Also grants: ${requiredPerms.map((p) => p.name).join(', ')}`
                        : item.description
                    }
                    placement="right"
                    arrow
                  >
                    <FormControlLabel
                      control={
                        <Switch
                          size="small"
                          checked={isEnabled}
                          onChange={(e) => onToggleNavItem(item.id, e.target.checked)}
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
                            {item.label}
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

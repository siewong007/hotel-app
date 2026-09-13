import React, { useMemo } from 'react';
import {
  Box,
  Typography,
  Switch,
  FormControlLabel,
  Divider,
  Tooltip,
} from '@mui/material';
import { Settings as SettingsIcon } from '@mui/icons-material';
import type { RouteAccessPolicy } from '../../../../../types';
import {
  navigationRouteDefinitions,
  type NavGroup,
} from '../../../../../navigation/routeRegistry';
import { NAV_GROUP_ORDER } from '../../../../../navigation/navGroups';
import { useRouteLabels } from '../../../../../navigation/routeLabels';
import { useTranslation } from '../../../../../i18n';

interface NavigationAccessSectionProps {
  selectedNavItems: string[];
  routePolicies: RouteAccessPolicy[];
  onToggleNavItem: (navId: string, enabled: boolean) => void;
  disabled?: boolean;
}

type NavPolicySection = {
  group: NavGroup | 'other';
  label: string;
  items: RouteAccessPolicy[];
};

const NavigationAccessSection: React.FC<NavigationAccessSectionProps> = ({
  selectedNavItems,
  routePolicies,
  onToggleNavItem,
  disabled = false,
}) => {
  const { groupLabel } = useRouteLabels();
  const { tOr } = useTranslation('nav');

  // Group policies by the registry's navGroup so this matrix mirrors the
  // sidebar — the DB's nav_group column still holds the legacy
  // 'main'/'admin'/'config' vocabulary and must not drive grouping.
  const navByGroup = useMemo(() => {
    const byId = new Map(navigationRouteDefinitions.map((r) => [r.id, r]));
    const sections: NavPolicySection[] = NAV_GROUP_ORDER.map((group) => ({
      group,
      // The sidebar suppresses headings for label-less groups, but this
      // matrix needs a caption for every section — nav.json labels all 8.
      label: groupLabel(group),
      items: routePolicies.filter(
        (policy) =>
          policy.is_navigation &&
          byId.get(policy.route_id)?.navGroup === group
      ),
    })).filter((section) => section.items.length > 0);

    // A policy whose route_id is absent from the registry (e.g. the seeded
    // 'teams' row, which has no frontend route) matches no group — surface it
    // under a catch-all instead of silently hiding the toggle.
    const orphans = routePolicies.filter(
      (policy) => policy.is_navigation && !byId.get(policy.route_id)?.navGroup
    );
    if (orphans.length > 0) {
      sections.push({ group: 'other', label: tOr('groups.other', 'Other'), items: orphans });
    }

    return { sections, byId };
  }, [routePolicies, groupLabel, tOr]);

  return (
    <Box>
      <Typography
        variant="subtitle2"
        sx={{
          color: "text.secondary",
          mb: 2
        }}>
        Which tabs can this role access?
      </Typography>
      {navByGroup.sections.map((section) => (
        <Box key={section.group} sx={{ mb: 2 }}>
          <Typography
            variant="caption"
            sx={{
              fontWeight: 600,
              color: "text.secondary",
              display: 'block',
              mb: 1,
              textTransform: 'uppercase',
              letterSpacing: 0.5
            }}>
            {section.label}
          </Typography>
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: 0.5,
              pl: 1,
            }}
          >
            {section.items.map((item) => {
              const isEnabled = selectedNavItems.includes(item.route_id);
              const IconComponent =
                navByGroup.byId.get(item.route_id)?.icon ?? SettingsIcon;
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
          <Divider sx={{ mt: 2 }} />
        </Box>
      ))}
    </Box>
  );
};

export default NavigationAccessSection;

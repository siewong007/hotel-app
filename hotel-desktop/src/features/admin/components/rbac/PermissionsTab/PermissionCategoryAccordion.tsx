import React from 'react';
import {
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Typography,
  Box,
  Chip,
  LinearProgress,
  alpha,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import {
  Hotel as HotelIcon,
  EventNote as EventNoteIcon,
  People as PeopleIcon,
  Navigation as NavigationIcon,
  Settings as SettingsIcon,
  VerifiedUser as VerifiedUserIcon,
  Security as SecurityIcon,
  CardGiftcard as CardGiftcardIcon,
  Star as StarIcon,
  AccountBalance as AccountBalanceIcon,
  Assessment as AssessmentIcon,
  VpnKey as VpnKeyIcon,
} from '@mui/icons-material';
import type { Permission, Role } from '../../../../../types';
import type { PermissionCategory } from '../types';
import PermissionRow from './PermissionRow';

// Icon mapping
const ICON_MAP: Record<string, React.ElementType> = {
  Hotel: HotelIcon,
  EventNote: EventNoteIcon,
  People: PeopleIcon,
  Navigation: NavigationIcon,
  Settings: SettingsIcon,
  VerifiedUser: VerifiedUserIcon,
  Security: SecurityIcon,
  CardGiftcard: CardGiftcardIcon,
  Star: StarIcon,
  AccountBalance: AccountBalanceIcon,
  Assessment: AssessmentIcon,
  VpnKey: VpnKeyIcon,
};

interface PermissionCategoryAccordionProps {
  category: PermissionCategory;
  roles: Role[];
  rolePermissionMap: Record<number, Set<number>>;
  onAddRole: (permission: Permission, role: Role) => Promise<void>;
  onRemoveRole: (permission: Permission, role: Role) => Promise<void>;
  defaultExpanded?: boolean;
  disabled?: boolean;
}

const PermissionCategoryAccordion: React.FC<PermissionCategoryAccordionProps> = ({
  category,
  roles,
  rolePermissionMap,
  onAddRole,
  onRemoveRole,
  defaultExpanded = false,
  disabled = false,
}) => {
  const IconComponent = ICON_MAP[category.icon] || VpnKeyIcon;

  // Calculate coverage: how many roles have at least one permission in this category
  const rolesWithCategoryPermission = roles.filter((role) =>
    category.permissions.some((p) => rolePermissionMap[role.id]?.has(p.id))
  ).length;
  const coveragePercent = roles.length > 0 ? (rolesWithCategoryPermission / roles.length) * 100 : 0;

  // Get roles that have a specific permission
  const getRolesForPermission = (permission: Permission): Role[] => {
    return roles.filter((role) => rolePermissionMap[role.id]?.has(permission.id));
  };

  return (
    <Accordion
      defaultExpanded={defaultExpanded}
      disableGutters
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        mb: 1.5,
        '&:before': { display: 'none' },
        '&.Mui-expanded': {
          margin: 0,
          mb: 1.5,
        },
      }}
    >
      <AccordionSummary
        expandIcon={<ExpandMoreIcon />}
        sx={{
          backgroundColor: alpha(category.color, 0.05),
          borderRadius: 2,
          '&.Mui-expanded': {
            borderBottomLeftRadius: 0,
            borderBottomRightRadius: 0,
          },
          '& .MuiAccordionSummary-content': {
            alignItems: 'center',
            gap: 1.5,
          },
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 36,
            height: 36,
            borderRadius: 1,
            backgroundColor: alpha(category.color, 0.15),
            color: category.color,
          }}
        >
          <IconComponent fontSize="small" />
        </Box>

        <Box sx={{ flex: 1 }}>
          <Typography variant="subtitle1" fontWeight={600}>
            {category.displayName}
          </Typography>
        </Box>

        <Chip
          label={`${category.permissions.length} permission${category.permissions.length !== 1 ? 's' : ''}`}
          size="small"
          sx={{
            backgroundColor: alpha(category.color, 0.1),
            color: category.color,
            fontWeight: 500,
          }}
        />

        <Box sx={{ width: 80, ml: 1 }}>
          <LinearProgress
            variant="determinate"
            value={coveragePercent}
            sx={{
              height: 6,
              borderRadius: 3,
              backgroundColor: alpha(category.color, 0.1),
              '& .MuiLinearProgress-bar': {
                backgroundColor: category.color,
                borderRadius: 3,
              },
            }}
          />
        </Box>
      </AccordionSummary>

      <AccordionDetails sx={{ p: 0 }}>
        {category.permissions.map((permission) => (
          <PermissionRow
            key={permission.id}
            permission={permission}
            assignedRoles={getRolesForPermission(permission)}
            allRoles={roles}
            onAddRole={onAddRole}
            onRemoveRole={onRemoveRole}
            disabled={disabled}
          />
        ))}
      </AccordionDetails>
    </Accordion>
  );
};

export default PermissionCategoryAccordion;

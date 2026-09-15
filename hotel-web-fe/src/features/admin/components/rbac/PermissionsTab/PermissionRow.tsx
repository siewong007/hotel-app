import React, { useState } from 'react';
import {
  Box,
  Typography,
  IconButton,
  Stack,
  Tooltip,
  CircularProgress,
} from '@mui/material';
import { Add as AddIcon } from '@mui/icons-material';
import type { Permission, Role } from '../../../../../types';
import RoleChip from './RoleChip';
import AddRolePopover from './AddRolePopover';
import { verbLabel } from '../constants';
import { useTranslation } from '../../../../../i18n';

interface PermissionRowProps {
  permission: Permission;
  assignedRoles: Role[];
  allRoles: Role[];
  onAddRole: (permission: Permission, role: Role) => Promise<void>;
  onRemoveRole: (permission: Permission, role: Role) => Promise<void>;
  disabled?: boolean;
}

const PermissionRow: React.FC<PermissionRowProps> = ({
  permission,
  assignedRoles,
  allRoles,
  onAddRole,
  onRemoveRole,
  disabled = false,
}) => {
  const { t } = useTranslation('admin');
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [removingRoleId, setRemovingRoleId] = useState<number | null>(null);

  // Roles that don't have this permission yet
  const availableRoles = allRoles.filter(
    (role) => !assignedRoles.some((ar) => ar.id === role.id)
  );

  const handleRemoveRole = async (role: Role) => {
    setRemovingRoleId(role.id);
    try {
      await onRemoveRole(permission, role);
    } finally {
      setRemovingRoleId(null);
    }
  };

  const handleAddRole = async (role: Role) => {
    await onAddRole(permission, role);
  };

  // Localized fallback when a permission carries no description — the action
  // verb translates, the resource code stays verbatim (it is a DB identifier).
  const actionPart = permission.name.includes(':')
    ? permission.name.split(':')[1]
    : permission.name;
  const fallbackDescription = t('rbac.permissionFallback', {
    action: verbLabel(t, actionPart),
    resource: permission.resource,
  });

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        py: 1.5,
        px: 2,
        borderBottom: '1px solid',
        borderColor: 'divider',
        '&:last-child': {
          borderBottom: 'none',
        },
        '&:hover': {
          backgroundColor: 'action.hover',
        },
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0, mr: 2 }}>
        <Typography
          variant="body2"
          sx={{
            fontWeight: 600,
            mb: 0.25
          }}>
          {permission.name}
        </Typography>
        <Typography variant="caption" sx={{
          color: "text.secondary"
        }}>
          {permission.description || fallbackDescription}
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.5 }}>
        <Stack direction="row" spacing={0.5} useFlexGap sx={{
          flexWrap: "wrap"
        }}>
          {assignedRoles.map((role) => (
            <RoleChip
              key={role.id}
              role={role}
              onRemove={
                disabled || removingRoleId === role.id
                  ? undefined
                  : () => handleRemoveRole(role)
              }
              disabled={disabled || removingRoleId === role.id}
            />
          ))}

          {assignedRoles.length === 0 && (
            <Typography
              variant="caption"
              sx={{
                color: "text.disabled",
                fontStyle: 'italic'
              }}>
              {t('rbac.noRolesAssigned')}
            </Typography>
          )}
        </Stack>

        <Tooltip title={t('rbac.addRole')}>
          <span>
            <IconButton
              size="small"
              onClick={(e) => setAnchorEl(e.currentTarget)}
              disabled={disabled || availableRoles.length === 0}
              sx={{
                ml: 0.5,
                border: '1px dashed',
                borderColor: 'divider',
                borderRadius: 1,
                '&:hover': {
                  borderColor: 'primary.main',
                  backgroundColor: 'primary.50',
                },
              }}
            >
              <AddIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>

        <AddRolePopover
          anchorEl={anchorEl}
          onClose={() => setAnchorEl(null)}
          availableRoles={availableRoles}
          onAddRole={handleAddRole}
          loading={disabled}
        />
      </Box>
    </Box>
  );
};

export default PermissionRow;

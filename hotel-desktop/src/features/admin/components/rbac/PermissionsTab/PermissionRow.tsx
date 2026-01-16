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

  // Format permission name for display
  const formatPermissionName = (name: string) => {
    // e.g., "rooms:read" -> "Read", "bookings:manage" -> "Manage"
    const parts = name.split(':');
    if (parts.length === 2) {
      return parts[1].charAt(0).toUpperCase() + parts[1].slice(1);
    }
    return name;
  };

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
        <Typography variant="body2" fontWeight={600} sx={{ mb: 0.25 }}>
          {permission.name}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {permission.description || `${formatPermissionName(permission.name)} access for ${permission.resource}`}
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.5 }}>
        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
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
            <Typography variant="caption" color="text.disabled" sx={{ fontStyle: 'italic' }}>
              No roles assigned
            </Typography>
          )}
        </Stack>

        <Tooltip title="Add role">
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

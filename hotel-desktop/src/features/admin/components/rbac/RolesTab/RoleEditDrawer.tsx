import React, { useState, useEffect } from 'react';
import {
  Drawer,
  Box,
  Typography,
  TextField,
  Button,
  IconButton,
  Divider,
  CircularProgress,
  Alert,
  alpha,
} from '@mui/material';
import { Close as CloseIcon, Save as SaveIcon } from '@mui/icons-material';
import type { Permission, Role, RoleInput } from '../../../../../types';
import type { RoleWithStats } from '../types';
import { getRoleColor, NAVIGATION_PERMISSION_MAPPING } from '../constants';
import NavigationAccessSection from './NavigationAccessSection';
import PermissionSummarySection from './PermissionSummarySection';
import { HotelAPIService } from '../../../../../api';

interface RoleEditDrawerProps {
  open: boolean;
  role: RoleWithStats | null;
  allPermissions: Permission[];
  onClose: () => void;
  onSave: (role: Role, updatedPermissions: Permission[]) => void;
}

const RoleEditDrawer: React.FC<RoleEditDrawerProps> = ({
  open,
  role,
  allPermissions,
  onClose,
  onSave,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedNavItems, setSelectedNavItems] = useState<string[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  // Initialize form when role changes
  useEffect(() => {
    if (role) {
      setName(role.name);
      setDescription(role.description || '');
      setSelectedNavItems(role.navigationItems || []);
      setPermissions(role.permissions || []);
      setHasChanges(false);
      setError(null);
    }
  }, [role]);

  const handleToggleNavItem = async (navId: string, enabled: boolean) => {
    if (!role) return;

    setHasChanges(true);
    setError(null);

    // Get required permissions for this nav item
    const requiredPerms = NAVIGATION_PERMISSION_MAPPING[navId] || [];
    const navPermName = `navigation_${navId}:read`;

    if (enabled) {
      // Add nav item
      setSelectedNavItems((prev) => [...prev, navId]);

      // Find or create the navigation permission
      let navPerm = allPermissions.find((p) => p.name === navPermName);

      // Add navigation permission and required permissions
      const permsToAdd: Permission[] = [];

      if (navPerm && !permissions.some((p) => p.id === navPerm!.id)) {
        permsToAdd.push(navPerm);
      }

      // Add required page permissions
      requiredPerms.forEach((reqPerm) => {
        const existingPerm = allPermissions.find((p) => p.name === reqPerm.name);
        if (existingPerm && !permissions.some((p) => p.id === existingPerm.id)) {
          permsToAdd.push(existingPerm);
        }
      });

      if (permsToAdd.length > 0) {
        setPermissions((prev) => [...prev, ...permsToAdd]);
      }
    } else {
      // Remove nav item
      setSelectedNavItems((prev) => prev.filter((id) => id !== navId));

      // Remove the navigation permission
      setPermissions((prev) => prev.filter((p) => p.name !== navPermName));
    }
  };

  const handleSave = async () => {
    if (!role) return;

    setSaving(true);
    setError(null);

    try {
      // Update role info if changed
      let updatedRole = role as Role;
      if (name !== role.name || description !== (role.description || '')) {
        updatedRole = await HotelAPIService.updateRole(String(role.id), {
          name,
          description,
        });
      }

      // Get current role permissions to compare
      const currentPermIds = new Set(role.permissions.map((p) => p.id));
      const newPermIds = new Set(permissions.map((p) => p.id));

      // Find permissions to add
      const toAdd = permissions.filter((p) => !currentPermIds.has(p.id));
      // Find permissions to remove
      const toRemove = role.permissions.filter((p) => !newPermIds.has(p.id));

      // Add new permissions
      for (const perm of toAdd) {
        await HotelAPIService.assignPermissionToRole({
          role_id: role.id,
          permission_id: perm.id,
        });
      }

      // Remove old permissions
      for (const perm of toRemove) {
        await HotelAPIService.removePermissionFromRole(String(role.id), String(perm.id));
      }

      onSave(updatedRole, permissions);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save role');
    } finally {
      setSaving(false);
    }
  };

  const color = role ? getRoleColor(role.name) : '#9e9e9e';

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          width: { xs: '100%', sm: 420 },
          maxWidth: '100%',
        },
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 3,
          py: 2,
          borderBottom: '1px solid',
          borderColor: 'divider',
          backgroundColor: alpha(color, 0.05),
        }}
      >
        <Typography variant="h6" fontWeight={600}>
          {role ? `Edit Role: ${role.name}` : 'Edit Role'}
        </Typography>
        <IconButton onClick={onClose} size="small">
          <CloseIcon />
        </IconButton>
      </Box>

      {/* Content */}
      <Box sx={{ flex: 1, overflow: 'auto', p: 3 }}>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {/* Basic Info Section */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 2 }}>
            Basic Information
          </Typography>

          <TextField
            label="Role Name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setHasChanges(true);
            }}
            fullWidth
            size="small"
            sx={{ mb: 2 }}
          />

          <TextField
            label="Description"
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              setHasChanges(true);
            }}
            fullWidth
            size="small"
            multiline
            rows={2}
            placeholder="Brief description of this role's responsibilities"
          />
        </Box>

        <Divider sx={{ my: 3 }} />

        {/* Navigation Access Section */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 2 }}>
            Navigation Access
          </Typography>

          <NavigationAccessSection
            selectedNavItems={selectedNavItems}
            onToggleNavItem={handleToggleNavItem}
            disabled={saving}
          />
        </Box>

        <Divider sx={{ my: 3 }} />

        {/* Permission Summary Section */}
        <Box>
          <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 2 }}>
            Permission Summary
          </Typography>

          <PermissionSummarySection
            permissions={permissions}
            allPermissions={allPermissions}
          />
        </Box>
      </Box>

      {/* Footer */}
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 1.5,
          px: 3,
          py: 2,
          borderTop: '1px solid',
          borderColor: 'divider',
          backgroundColor: 'background.paper',
        }}
      >
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          variant="contained"
          startIcon={saving ? <CircularProgress size={16} /> : <SaveIcon />}
          onClick={handleSave}
          disabled={saving || !hasChanges}
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </Button>
      </Box>
    </Drawer>
  );
};

export default RoleEditDrawer;

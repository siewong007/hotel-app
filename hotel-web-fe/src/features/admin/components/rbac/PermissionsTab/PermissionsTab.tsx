import React, { useState, useMemo } from 'react';
import {
  Box,
  Typography,
  TextField,
  InputAdornment,
  Button,
  Paper,
  Stack,
  Chip,
  alpha,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  MenuItem,
  CircularProgress,
  Alert,
} from '@mui/material';
import {
  Search as SearchIcon,
  Add as AddIcon,
} from '@mui/icons-material';
import type { Permission, Role, PermissionInput } from '../../../../../types';
import type { PermissionCategory, RolePermissionMap } from '../types';
import { getRoleColor, PERMISSION_CATEGORIES } from '../constants';
import PermissionCategoryAccordion from './PermissionCategoryAccordion';
import { HotelAPIService } from '../../../../../api';

interface PermissionsTabProps {
  permissions: Permission[];
  roles: Role[];
  permissionCategories: PermissionCategory[];
  rolePermissionMap: RolePermissionMap;
  onAddRoleToPermission: (permission: Permission, role: Role) => Promise<void>;
  onRemoveRoleFromPermission: (permission: Permission, role: Role) => Promise<void>;
  onPermissionCreated: (permission: Permission) => void;
  loading?: boolean;
}

const PermissionsTab: React.FC<PermissionsTabProps> = ({
  permissions,
  roles,
  permissionCategories,
  rolePermissionMap,
  onAddRoleToPermission,
  onRemoveRoleFromPermission,
  onPermissionCreated,
  loading = false,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [newPermission, setNewPermission] = useState<PermissionInput>({
    name: '',
    resource: '',
    action: '',
    description: '',
  });

  // Filter categories based on search
  const filteredCategories = useMemo(() => {
    if (!searchQuery.trim()) return permissionCategories;

    const query = searchQuery.toLowerCase();
    return permissionCategories
      .map((category) => ({
        ...category,
        permissions: category.permissions.filter(
          (p) =>
            p.name.toLowerCase().includes(query) ||
            p.resource.toLowerCase().includes(query) ||
            p.action.toLowerCase().includes(query) ||
            p.description?.toLowerCase().includes(query)
        ),
      }))
      .filter((category) => category.permissions.length > 0);
  }, [permissionCategories, searchQuery]);

  // Summary stats
  const totalPermissions = permissions.length;
  const totalCategories = permissionCategories.length;

  // Handle create permission
  const handleCreatePermission = async () => {
    if (!newPermission.name || !newPermission.resource || !newPermission.action) {
      setCreateError('Name, resource, and action are required');
      return;
    }

    setCreating(true);
    setCreateError(null);

    try {
      const created = await HotelAPIService.createPermission(newPermission);
      onPermissionCreated(created);
      setCreateDialogOpen(false);
      setNewPermission({ name: '', resource: '', action: '', description: '' });
    } catch (err: any) {
      setCreateError(err.message || 'Failed to create permission');
    } finally {
      setCreating(false);
    }
  };

  // Auto-generate permission name from resource and action
  const handleResourceOrActionChange = (field: 'resource' | 'action', value: string) => {
    const updated = { ...newPermission, [field]: value };

    // Auto-generate name if both resource and action are set
    if (updated.resource && updated.action) {
      updated.name = `${updated.resource}:${updated.action}`;
    }

    setNewPermission(updated);
  };

  // Convert rolePermissionMap to the format expected by accordions
  const rolePermMapForAccordion = useMemo(() => {
    const map: Record<number, Set<number>> = {};
    roles.forEach((role) => {
      map[role.id] = rolePermissionMap[role.id] || new Set();
    });
    return map;
  }, [roles, rolePermissionMap]);

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 3 }}>
        <Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {totalPermissions} permissions across {totalCategories} categories
          </Typography>

          {/* Role legend */}
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
            {roles.map((role) => (
              <Chip
                key={role.id}
                label={role.name}
                size="small"
                sx={{
                  backgroundColor: alpha(getRoleColor(role.name), 0.1),
                  color: getRoleColor(role.name),
                  fontWeight: 500,
                  fontSize: '0.75rem',
                }}
              />
            ))}
          </Stack>
        </Box>

        <Box sx={{ display: 'flex', gap: 1.5 }}>
          <TextField
            size="small"
            placeholder="Search permissions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" color="action" />
                </InputAdornment>
              ),
            }}
            sx={{ width: 250 }}
          />

          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setCreateDialogOpen(true)}
          >
            New Permission
          </Button>
        </Box>
      </Box>

      {/* Permission categories */}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      ) : filteredCategories.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">
            {searchQuery ? 'No permissions match your search' : 'No permissions configured'}
          </Typography>
        </Paper>
      ) : (
        filteredCategories.map((category, index) => (
          <PermissionCategoryAccordion
            key={category.name}
            category={category}
            roles={roles}
            rolePermissionMap={rolePermMapForAccordion}
            onAddRole={onAddRoleToPermission}
            onRemoveRole={onRemoveRoleFromPermission}
            defaultExpanded={index === 0}
            disabled={loading}
          />
        ))
      )}

      {/* Create Permission Dialog */}
      <Dialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Create New Permission</DialogTitle>
        <DialogContent>
          {createError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {createError}
            </Alert>
          )}

          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              select
              label="Resource"
              value={newPermission.resource}
              onChange={(e) => handleResourceOrActionChange('resource', e.target.value)}
              fullWidth
              required
            >
              {Object.entries(PERMISSION_CATEGORIES).map(([key, config]) => (
                <MenuItem key={key} value={key}>
                  {config.displayName}
                </MenuItem>
              ))}
              <MenuItem value="other">Other</MenuItem>
            </TextField>

            {newPermission.resource === 'other' && (
              <TextField
                label="Custom Resource"
                value={newPermission.resource === 'other' ? '' : newPermission.resource}
                onChange={(e) => setNewPermission({ ...newPermission, resource: e.target.value })}
                fullWidth
                placeholder="e.g., reports"
              />
            )}

            <TextField
              select
              label="Action"
              value={newPermission.action}
              onChange={(e) => handleResourceOrActionChange('action', e.target.value)}
              fullWidth
              required
            >
              <MenuItem value="read">Read - View access</MenuItem>
              <MenuItem value="write">Write - Create access</MenuItem>
              <MenuItem value="update">Update - Modify access</MenuItem>
              <MenuItem value="delete">Delete - Remove access</MenuItem>
              <MenuItem value="manage">Manage - Full access</MenuItem>
            </TextField>

            <TextField
              label="Permission Name"
              value={newPermission.name}
              onChange={(e) => setNewPermission({ ...newPermission, name: e.target.value })}
              fullWidth
              required
              helperText="Auto-generated from resource:action"
            />

            <TextField
              label="Description"
              value={newPermission.description}
              onChange={(e) => setNewPermission({ ...newPermission, description: e.target.value })}
              fullWidth
              multiline
              rows={2}
              placeholder="Optional description of what this permission allows"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleCreatePermission}
            disabled={creating || !newPermission.name || !newPermission.resource || !newPermission.action}
          >
            {creating ? <CircularProgress size={20} /> : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default PermissionsTab;

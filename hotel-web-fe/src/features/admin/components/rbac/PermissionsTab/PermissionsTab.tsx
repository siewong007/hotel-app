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
import { useCreatePermission } from '../hooks/useRBACQueries';
import { errorMessage } from '../../../../../utils/errorMessage';
import { useTranslation } from '../../../../../i18n';

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
  const { t } = useTranslation('admin');
  const [searchQuery, setSearchQuery] = useState('');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [newPermission, setNewPermission] = useState<PermissionInput>({
    name: '',
    resource: '',
    action: '',
    description: '',
  });

  const createPermissionMutation = useCreatePermission();
  const creating = createPermissionMutation.isPending;

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
      setCreateError(t('rbac.errors.permissionFieldsRequired'));
      return;
    }

    setCreateError(null);

    try {
      const created = await createPermissionMutation.mutateAsync(newPermission);
      onPermissionCreated(created);
      setCreateDialogOpen(false);
      setNewPermission({ name: '', resource: '', action: '', description: '' });
    } catch (err) {
      setCreateError(errorMessage(err, t('rbac.errors.createPermission')));
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
          <Typography
            variant="body2"
            sx={{
              color: "text.secondary",
              mb: 1
            }}>
            {t('rbac.permSummary', { permissions: totalPermissions, categories: totalCategories })}
          </Typography>

          {/* Role legend */}
          <Stack direction="row" spacing={0.5} useFlexGap sx={{
            flexWrap: "wrap"
          }}>
            {roles.map((role) => (
              <Chip
                key={role.id}
                label={role.name}
                size="small"
                sx={{
                  backgroundColor: `color-mix(in srgb, ${getRoleColor(role.name)} 10%, transparent)`,
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
            placeholder={t('rbac.searchPermissions')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            sx={{ width: 250 }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" color="action" />
                  </InputAdornment>
                ),
              }
            }}
          />

          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setCreateDialogOpen(true)}
          >
            {t('rbac.newPermission')}
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
          <Typography sx={{
            color: "text.secondary"
          }}>
            {searchQuery ? t('rbac.noPermissionsMatch') : t('rbac.noPermissionsConfigured')}
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
        <DialogTitle>{t('rbac.createPermissionTitle')}</DialogTitle>
        <DialogContent>
          {createError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {createError}
            </Alert>
          )}

          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              select
              label={t('rbac.permResource')}
              value={newPermission.resource}
              onChange={(e) => handleResourceOrActionChange('resource', e.target.value)}
              fullWidth
              required
            >
              {Object.entries(PERMISSION_CATEGORIES).map(([key, config]) => (
                <MenuItem key={key} value={key}>
                  {t(config.labelKey)}
                </MenuItem>
              ))}
              <MenuItem value="other">{t('rbac.permOther')}</MenuItem>
            </TextField>

            {newPermission.resource === 'other' && (
              <TextField
                label={t('rbac.customResource')}
                value={newPermission.resource === 'other' ? '' : newPermission.resource}
                onChange={(e) => setNewPermission({ ...newPermission, resource: e.target.value })}
                fullWidth
                placeholder={t('rbac.customResourcePlaceholder')}
              />
            )}

            <TextField
              select
              label={t('rbac.permAction')}
              value={newPermission.action}
              onChange={(e) => handleResourceOrActionChange('action', e.target.value)}
              fullWidth
              required
            >
              <MenuItem value="read">{t('rbac.permActions.read')}</MenuItem>
              <MenuItem value="write">{t('rbac.permActions.write')}</MenuItem>
              <MenuItem value="update">{t('rbac.permActions.update')}</MenuItem>
              <MenuItem value="delete">{t('rbac.permActions.delete')}</MenuItem>
              <MenuItem value="manage">{t('rbac.permActions.manage')}</MenuItem>
            </TextField>

            <TextField
              label={t('rbac.permName')}
              value={newPermission.name}
              onChange={(e) => setNewPermission({ ...newPermission, name: e.target.value })}
              fullWidth
              required
              helperText={t('rbac.permNameHint')}
            />

            <TextField
              label={t('common:field.description')}
              value={newPermission.description}
              onChange={(e) => setNewPermission({ ...newPermission, description: e.target.value })}
              fullWidth
              multiline
              rows={2}
              placeholder={t('rbac.permDescPlaceholder')}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialogOpen(false)}>{t('common:actions.cancel')}</Button>
          <Button
            variant="contained"
            onClick={handleCreatePermission}
            disabled={creating || !newPermission.name || !newPermission.resource || !newPermission.action}
          >
            {creating ? <CircularProgress size={20} /> : t('common:actions.create')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default PermissionsTab;

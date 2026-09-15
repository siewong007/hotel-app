import React, { useState } from 'react';
import {
  Box,
  Typography,
  Button,
  Grid,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  TextField,
  CircularProgress,
  Alert,
  Stack,
} from '@mui/material';
import { Add as AddIcon } from '@mui/icons-material';
import { LogoLoader } from '../../../../../components';
import type { Permission, Role, RouteAccessPolicy, RoleInput } from '../../../../../types';
import type { RoleWithStats } from '../types';
import RoleCard from './RoleCard';
import RoleEditDrawer from './RoleEditDrawer';
import { useCreateRole, useDeleteRole } from '../hooks/useRBACQueries';
import { errorMessage } from '../../../../../utils/errorMessage';
import { useTranslation } from '../../../../../i18n';

interface RolesTabProps {
  roles: RoleWithStats[];
  permissions: Permission[];
  routePolicies?: RouteAccessPolicy[];
  onRoleCreated: (role: Role) => void;
  onRoleUpdated: (role: Role, permissions: Permission[]) => void;
  onRoleDeleted: (roleId: number) => void;
  loading?: boolean;
}

const RolesTab: React.FC<RolesTabProps> = ({
  roles,
  permissions,
  routePolicies = [],
  onRoleCreated,
  onRoleUpdated,
  onRoleDeleted,
  loading = false,
}) => {
  const { t } = useTranslation('admin');
  // Edit drawer state
  const [editDrawerOpen, setEditDrawerOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleWithStats | null>(null);

  // Create dialog state
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newRole, setNewRole] = useState<RoleInput>({ name: '', description: '' });
  const [createError, setCreateError] = useState<string | null>(null);

  // Delete dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingRole, setDeletingRole] = useState<RoleWithStats | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const createRoleMutation = useCreateRole();
  const deleteRoleMutation = useDeleteRole();
  const creating = createRoleMutation.isPending;
  const deleting = deleteRoleMutation.isPending;

  // Handle edit
  const handleEditRole = (role: RoleWithStats) => {
    setEditingRole(role);
    setEditDrawerOpen(true);
  };

  const handleSaveRole = (role: Role, updatedPermissions: Permission[]) => {
    onRoleUpdated(role, updatedPermissions);
  };

  // Handle create
  const handleCreateRole = async () => {
    if (!newRole.name.trim()) {
      setCreateError(t('rbac.errors.roleNameRequired'));
      return;
    }

    setCreateError(null);

    try {
      const created = await createRoleMutation.mutateAsync(newRole);
      onRoleCreated(created);
      setCreateDialogOpen(false);
      setNewRole({ name: '', description: '' });
    } catch (err) {
      setCreateError(errorMessage(err, t('rbac.errors.createRole')));
    }
  };

  // Handle delete
  const handleDeleteClick = (role: RoleWithStats) => {
    setDeletingRole(role);
    setDeleteDialogOpen(true);
    setDeleteError(null);
  };

  const handleConfirmDelete = async () => {
    if (!deletingRole) return;

    setDeleteError(null);

    try {
      await deleteRoleMutation.mutateAsync(String(deletingRole.id));
      onRoleDeleted(deletingRole.id);
      setDeleteDialogOpen(false);
      setDeletingRole(null);
    } catch (err) {
      setDeleteError(errorMessage(err, t('rbac.errors.deleteRole')));
    }
  };

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="body2" sx={{
          color: "text.secondary"
        }}>
          {t('rbac.rolesConfigured', { count: roles.length })}
        </Typography>

        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setCreateDialogOpen(true)}
        >
          {t('rbac.createRole')}
        </Button>
      </Box>
      {/* Role cards */}
      {loading ? (
        <LogoLoader variant="page" />
      ) : roles.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 4 }}>
          <Typography sx={{
            color: "text.secondary"
          }}>
            {t('rbac.noRoles')}
          </Typography>
        </Box>
      ) : (
        <Grid container spacing={2}>
          {roles.map((role) => (
            <Grid key={role.id} size={{ xs: 12, md: 6 }}>
              <RoleCard
                role={role}
                onEdit={handleEditRole}
                onDelete={handleDeleteClick}
              />
            </Grid>
          ))}
        </Grid>
      )}
      {/* Edit drawer */}
      <RoleEditDrawer
        open={editDrawerOpen}
        role={editingRole}
        allPermissions={permissions}
        routePolicies={routePolicies}
        onClose={() => {
          setEditDrawerOpen(false);
          setEditingRole(null);
        }}
        onSave={handleSaveRole}
      />
      {/* Create dialog */}
      <Dialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{t('rbac.createRoleTitle')}</DialogTitle>
        <DialogContent>
          {createError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {createError}
            </Alert>
          )}

          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label={t('rbac.roleName')}
              value={newRole.name}
              onChange={(e) => setNewRole({ ...newRole, name: e.target.value })}
              fullWidth
              required
              placeholder={t('rbac.roleNamePlaceholder')}
            />

            <TextField
              label={t('common:field.description')}
              value={newRole.description}
              onChange={(e) => setNewRole({ ...newRole, description: e.target.value })}
              fullWidth
              multiline
              rows={2}
              placeholder={t('rbac.descriptionPlaceholder')}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialogOpen(false)}>{t('common:actions.cancel')}</Button>
          <Button
            variant="contained"
            onClick={handleCreateRole}
            disabled={creating || !newRole.name.trim()}
          >
            {creating ? <CircularProgress size={20} /> : t('common:actions.create')}
          </Button>
        </DialogActions>
      </Dialog>
      {/* Delete confirmation dialog */}
      <Dialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
      >
        <DialogTitle>{t('rbac.deleteRoleTitle')}</DialogTitle>
        <DialogContent>
          {deleteError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {deleteError}
            </Alert>
          )}

          <DialogContentText>
            {t('rbac.deleteConfirmStart')}{' '}
            <strong>{deletingRole?.name}</strong>{t('rbac.deleteConfirmEnd')}
          </DialogContentText>

          {deletingRole && deletingRole.permissionCount > 0 && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              {t('rbac.deleteWarning', { count: deletingRole.permissionCount })}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>{t('common:actions.cancel')}</Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleConfirmDelete}
            disabled={deleting}
          >
            {deleting ? <CircularProgress size={20} /> : t('common:actions.delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default RolesTab;

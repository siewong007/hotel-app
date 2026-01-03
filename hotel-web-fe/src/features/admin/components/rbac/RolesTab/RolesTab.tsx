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
import type { Permission, Role, RoleInput } from '../../../../../types';
import type { RoleWithStats } from '../types';
import RoleCard from './RoleCard';
import RoleEditDrawer from './RoleEditDrawer';
import { HotelAPIService } from '../../../../../api';

interface RolesTabProps {
  roles: RoleWithStats[];
  permissions: Permission[];
  onRoleCreated: (role: Role) => void;
  onRoleUpdated: (role: Role, permissions: Permission[]) => void;
  onRoleDeleted: (roleId: number) => void;
  loading?: boolean;
}

const RolesTab: React.FC<RolesTabProps> = ({
  roles,
  permissions,
  onRoleCreated,
  onRoleUpdated,
  onRoleDeleted,
  loading = false,
}) => {
  // Edit drawer state
  const [editDrawerOpen, setEditDrawerOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleWithStats | null>(null);

  // Create dialog state
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newRole, setNewRole] = useState<RoleInput>({ name: '', description: '' });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Delete dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingRole, setDeletingRole] = useState<RoleWithStats | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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
      setCreateError('Role name is required');
      return;
    }

    setCreating(true);
    setCreateError(null);

    try {
      const created = await HotelAPIService.createRole(newRole);
      onRoleCreated(created);
      setCreateDialogOpen(false);
      setNewRole({ name: '', description: '' });
    } catch (err: any) {
      setCreateError(err.message || 'Failed to create role');
    } finally {
      setCreating(false);
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

    setDeleting(true);
    setDeleteError(null);

    try {
      await HotelAPIService.deleteRole(String(deletingRole.id));
      onRoleDeleted(deletingRole.id);
      setDeleteDialogOpen(false);
      setDeletingRole(null);
    } catch (err: any) {
      setDeleteError(err.message || 'Failed to delete role');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="body2" color="text.secondary">
          {roles.length} role{roles.length !== 1 ? 's' : ''} configured
        </Typography>

        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setCreateDialogOpen(true)}
        >
          Create Role
        </Button>
      </Box>

      {/* Role cards */}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      ) : roles.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 4 }}>
          <Typography color="text.secondary">
            No roles configured. Click "Create Role" to add one.
          </Typography>
        </Box>
      ) : (
        <Grid container spacing={2}>
          {roles.map((role) => (
            <Grid item xs={12} md={6} key={role.id}>
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
        <DialogTitle>Create New Role</DialogTitle>
        <DialogContent>
          {createError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {createError}
            </Alert>
          )}

          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Role Name"
              value={newRole.name}
              onChange={(e) => setNewRole({ ...newRole, name: e.target.value })}
              fullWidth
              required
              placeholder="e.g., Housekeeping"
            />

            <TextField
              label="Description"
              value={newRole.description}
              onChange={(e) => setNewRole({ ...newRole, description: e.target.value })}
              fullWidth
              multiline
              rows={2}
              placeholder="Brief description of this role's responsibilities"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleCreateRole}
            disabled={creating || !newRole.name.trim()}
          >
            {creating ? <CircularProgress size={20} /> : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
      >
        <DialogTitle>Delete Role</DialogTitle>
        <DialogContent>
          {deleteError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {deleteError}
            </Alert>
          )}

          <DialogContentText>
            Are you sure you want to delete the role <strong>{deletingRole?.name}</strong>?
            This action cannot be undone.
          </DialogContentText>

          {deletingRole && deletingRole.permissionCount > 0 && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              This role has {deletingRole.permissionCount} permissions assigned.
              Users with this role will lose access to those features.
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleConfirmDelete}
            disabled={deleting}
          >
            {deleting ? <CircularProgress size={20} /> : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default RolesTab;

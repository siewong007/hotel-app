import React, { useState, useMemo } from 'react';
import {
  Box,
  Typography,
  Button,
  TextField,
  IconButton,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  OutlinedInput,
  Checkbox,
  ListItemText,
  Switch,
  FormControlLabel,
  InputAdornment,
  CircularProgress,
  Alert,
  Tooltip,
  alpha,
} from '@mui/material';
import { Search as SearchIcon } from '@mui/icons-material';
import { DataTable, type ColumnDef } from '../../../../../components';
import {
  Edit as EditIcon,
  Delete as DeleteIcon,
  PersonAdd as PersonAddIcon,
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
  Security as SecurityIcon,
} from '@mui/icons-material';
import type { User, Role } from '../../../../../types';
import type { CreateRbacUserInput, UpdateRbacUserInput } from '../../../../../api/users.service';
import { ROLE_COLORS } from '../constants';
import {
  useCreateUser,
  useDeleteUser,
  useReplaceUserRoles,
  useUpdateUser,
} from '../hooks/useRBACQueries';

interface UserWithRoles extends User {
  roles?: Role[];
}

interface UsersTabProps {
  users: UserWithRoles[];
  roles: Role[];
  loading: boolean;
  onUserCreated: (user: User) => void;
  onUserUpdated: (user: User) => void;
  onUserDeleted: (userId: string) => void;
  onRolesAssigned: (userId: string, roleIds: number[]) => void;
}

interface UserFormData {
  username: string;
  email: string;
  full_name: string;
  phone: string;
  password: string;
  confirmPassword: string;
  is_active: boolean;
  role_ids: number[];
}

const initialFormData: UserFormData = {
  username: '',
  email: '',
  full_name: '',
  phone: '',
  password: '',
  confirmPassword: '',
  is_active: true,
  role_ids: [],
};

export const UsersTab: React.FC<UsersTabProps> = ({
  users,
  roles,
  loading,
  onUserCreated,
  onUserUpdated,
  onUserDeleted,
  onRolesAssigned,
}) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingUser, setEditingUser] = useState<UserWithRoles | null>(null);
  const [userToDelete, setUserToDelete] = useState<UserWithRoles | null>(null);
  const [formData, setFormData] = useState<UserFormData>(initialFormData);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const createUserMutation = useCreateUser();
  const updateUserMutation = useUpdateUser();
  const deleteUserMutation = useDeleteUser();
  const replaceUserRolesMutation = useReplaceUserRoles();
  const submitting =
    createUserMutation.isPending ||
    updateUserMutation.isPending ||
    deleteUserMutation.isPending ||
    replaceUserRolesMutation.isPending;

  const handleOpenCreate = () => {
    setEditingUser(null);
    setFormData(initialFormData);
    setError(null);
    setDialogOpen(true);
  };

  const handleOpenEdit = (user: UserWithRoles) => {
    setEditingUser(user);
    setFormData({
      username: user.username,
      email: user.email,
      full_name: user.full_name || '',
      phone: '',
      password: '',
      confirmPassword: '',
      is_active: user.is_active,
      role_ids: user.roles?.map(r => r.id) || [],
    });
    setError(null);
    setDialogOpen(true);
  };

  const handleOpenDelete = (user: UserWithRoles) => {
    setUserToDelete(user);
    setDeleteDialogOpen(true);
  };

  const handleClose = () => {
    setDialogOpen(false);
    setEditingUser(null);
    setFormData(initialFormData);
    setError(null);
  };

  const handleChange = (field: keyof UserFormData, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setError(null);
  };

  const validateForm = (): string | null => {
    if (!formData.username.trim()) return 'Username is required';
    if (!formData.email.trim()) return 'Email is required';
    if (!editingUser && !formData.password) return 'Password is required for new users';
    if (formData.password && formData.password.length < 6) return 'Password must be at least 6 characters';
    if (formData.password && formData.password !== formData.confirmPassword) return 'Passwords do not match';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) return 'Invalid email format';
    return null;
  };

  const handleSubmit = async () => {
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);

    try {
      if (editingUser) {
        // Update existing user
        const updateData: UpdateRbacUserInput = {
          username: formData.username,
          email: formData.email,
          full_name: formData.full_name || undefined,
          is_active: formData.is_active,
        };
        if (formData.password) {
          updateData.password = formData.password;
        }

        const updatedUser = await updateUserMutation.mutateAsync({
          userId: editingUser.id,
          input: updateData,
        });
        onUserUpdated(updatedUser);

        // Update role assignments if changed
        const currentRoleIds = editingUser.roles?.map(r => r.id) || [];
        const newRoleIds = formData.role_ids;

        const rolesChanged =
          currentRoleIds.length !== newRoleIds.length ||
          currentRoleIds.some((roleId) => !newRoleIds.includes(roleId));

        if (rolesChanged) {
          await replaceUserRolesMutation.mutateAsync({
            userId: editingUser.id,
            input: { role_ids: newRoleIds },
          });
        }

        onRolesAssigned(editingUser.id, newRoleIds);
      } else {
        // Create new user
        const createInput: CreateRbacUserInput = {
          username: formData.username,
          email: formData.email,
          password: formData.password,
          full_name: formData.full_name || undefined,
          role_ids: formData.role_ids.length > 0 ? formData.role_ids : undefined,
        };
        const newUser = await createUserMutation.mutateAsync(createInput);
        onUserCreated(newUser);
        if (formData.role_ids.length > 0) {
          onRolesAssigned(newUser.id, formData.role_ids);
        }
      }

      handleClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save user');
    }
  };

  const handleDelete = async () => {
    if (!userToDelete) return;

    try {
      await deleteUserMutation.mutateAsync(userToDelete.id);
      onUserDeleted(userToDelete.id);
      setDeleteDialogOpen(false);
      setUserToDelete(null);
    } catch (err: any) {
      setError(err.message || 'Failed to delete user');
    }
  };

  const getRoleColor = (roleName: string): string => {
    const name = roleName.toLowerCase();
    return ROLE_COLORS[name as keyof typeof ROLE_COLORS] || ROLE_COLORS.default;
  };

  const columns = useMemo<ColumnDef<UserWithRoles, any>[]>(() => [
    {
      id: 'username',
      header: 'Username',
      accessorFn: (row) => row.username,
      cell: (info) => <Typography sx={{
        fontWeight: 500
      }}>{String(info.getValue() ?? '')}</Typography>,
    },
    {
      id: 'email',
      header: 'Email',
      accessorFn: (row) => row.email,
    },
    {
      id: 'full_name',
      header: 'Full Name',
      accessorFn: (row) => row.full_name || '',
      cell: (info) => (info.getValue() as string) || '-',
    },
    {
      id: 'roles',
      header: 'Roles',
      accessorFn: (row) => (row.roles || []).map((r) => r.name).join(', '),
      enableSorting: false,
      cell: (info) => {
        const user = info.row.original;
        if (!user.roles || user.roles.length === 0) {
          return (
            <Typography variant="body2" sx={{
              color: "text.secondary"
            }}>No roles</Typography>
          );
        }
        return (
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
            {user.roles.map((role) => (
              <Chip
                key={role.id}
                label={role.name}
                size="small"
                icon={<SecurityIcon sx={{ fontSize: 14 }} />}
                sx={{
                  bgcolor: alpha(getRoleColor(role.name), 0.1),
                  color: getRoleColor(role.name),
                  fontWeight: 500,
                  '& .MuiChip-icon': { color: 'inherit' },
                }}
              />
            ))}
          </Box>
        );
      },
    },
    {
      id: 'status',
      header: 'Status',
      accessorFn: (row) => (row.is_active ? 'Active' : 'Inactive'),
      cell: (info) => {
        const user = info.row.original;
        return (
          <Chip
            label={user.is_active ? 'Active' : 'Inactive'}
            size="small"
            color={user.is_active ? 'success' : 'default'}
            variant={user.is_active ? 'filled' : 'outlined'}
          />
        );
      },
    },
    {
      id: 'created',
      header: 'Created',
      accessorFn: (row) => (row.created_at ? new Date(row.created_at).getTime() : 0),
      cell: (info) => {
        const ts = info.getValue() as number;
        return ts ? new Date(ts).toLocaleDateString() : '-';
      },
    },
    {
      id: 'actions',
      header: 'Actions',
      enableSorting: false,
      enableColumnFilter: false,
      meta: { align: 'right', stopRowClick: true },
      cell: (info) => (
        <Tooltip title="Delete User">
          <IconButton
            size="small"
            onClick={() => handleOpenDelete(info.row.original)}
            color="error"
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ),
    },
  ], []);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, gap: 2 }}>
        <Box>
          <Typography variant="h6" sx={{
            fontWeight: 600
          }}>
            User Management
          </Typography>
          <Typography variant="body2" sx={{
            color: "text.secondary"
          }}>
            Create, edit, and manage user accounts and their role assignments
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
          <TextField
            size="small"
            placeholder="Search users..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            sx={{ width: 240 }}
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
            startIcon={<PersonAddIcon />}
            onClick={handleOpenCreate}
          >
            Add User
          </Button>
        </Box>
      </Box>
      <DataTable<UserWithRoles>
        data={users}
        columns={columns}
        globalFilter={searchQuery}
        emptyMessage="No users found"
        onRowClick={handleOpenEdit}
        getRowId={(row) => row.id}
      />
      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onClose={handleClose} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ pb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {editingUser ? <EditIcon color="primary" /> : <PersonAddIcon color="primary" />}
            <Typography variant="h6">
              {editingUser ? 'Edit User' : 'Create New User'}
            </Typography>
          </Box>
        </DialogTitle>
        <DialogContent>
          {error && (
            <Alert severity="error" sx={{ mb: 2, mt: 1 }}>
              {error}
            </Alert>
          )}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <TextField
              label="Username"
              value={formData.username}
              onChange={(e) => handleChange('username', e.target.value)}
              required
              fullWidth
              disabled={!!editingUser}
            />
            <TextField
              label="Email"
              type="email"
              value={formData.email}
              onChange={(e) => handleChange('email', e.target.value)}
              required
              fullWidth
            />
            <TextField
              label="Full Name"
              value={formData.full_name}
              onChange={(e) => handleChange('full_name', e.target.value)}
              fullWidth
            />
            <TextField
              label={editingUser ? 'New Password (leave blank to keep current)' : 'Password'}
              type={showPassword ? 'text' : 'password'}
              value={formData.password}
              onChange={(e) => handleChange('password', e.target.value)}
              required={!editingUser}
              fullWidth
              slotProps={{
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        onClick={() => setShowPassword(!showPassword)}
                        edge="end"
                      >
                        {showPassword ? <VisibilityOffIcon /> : <VisibilityIcon />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }
              }}
            />
            {(formData.password || !editingUser) && (
              <TextField
                label="Confirm Password"
                type={showPassword ? 'text' : 'password'}
                value={formData.confirmPassword}
                onChange={(e) => handleChange('confirmPassword', e.target.value)}
                required={!editingUser}
                fullWidth
              />
            )}
            <FormControl fullWidth>
              <InputLabel>Roles</InputLabel>
              <Select
                multiple
                value={formData.role_ids}
                onChange={(e) => handleChange('role_ids', e.target.value)}
                input={<OutlinedInput label="Roles" />}
                renderValue={(selected) =>
                  roles
                    .filter((r) => selected.includes(r.id))
                    .map((r) => r.name)
                    .join(', ')
                }
              >
                {roles.map((role) => (
                  <MenuItem key={role.id} value={role.id}>
                    <Checkbox checked={formData.role_ids.includes(role.id)} />
                    <ListItemText
                      primary={role.name}
                      secondary={role.description}
                    />
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {editingUser && (
              <FormControlLabel
                control={
                  <Switch
                    checked={formData.is_active}
                    onChange={(e) => handleChange('is_active', e.target.checked)}
                    color="success"
                  />
                }
                label="Active"
              />
            )}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={handleClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleSubmit}
            disabled={submitting}
            startIcon={submitting ? <CircularProgress size={20} /> : null}
          >
            {submitting ? 'Saving...' : editingUser ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>
      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>Delete User</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete user <strong>{userToDelete?.username}</strong>?
            This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleDelete}
            disabled={submitting}
            startIcon={submitting ? <CircularProgress size={20} /> : <DeleteIcon />}
          >
            {submitting ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default UsersTab;

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
import { errorMessage } from '../../../../../utils/errorMessage';
import { useTranslation } from '../../../../../i18n';
import { formatHotelDate } from '../../../../../utils/date';

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
  const { t } = useTranslation('admin');
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

  const handleChange = <K extends keyof UserFormData>(field: K, value: UserFormData[K]) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setError(null);
  };

  const validateForm = (): string | null => {
    if (!formData.username.trim()) return t('validation:required', { field: t('rbac.username') });
    if (!formData.email.trim()) return t('validation:required', { field: t('common:field.email') });
    if (!editingUser && !formData.password) return t('rbac.errors.passwordRequired');
    if (formData.password && formData.password.length < 6) {
      return t('validation:passwordTooShort', { min: 6 });
    }
    if (formData.password && formData.password !== formData.confirmPassword) {
      return t('validation:passwordMismatch');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) return t('validation:email');
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
    } catch (err) {
      setError(errorMessage(err, t('rbac.errors.saveUser')));
    }
  };

  const handleDelete = async () => {
    if (!userToDelete) return;

    try {
      await deleteUserMutation.mutateAsync(userToDelete.id);
      onUserDeleted(userToDelete.id);
      setDeleteDialogOpen(false);
      setUserToDelete(null);
    } catch (err) {
      setError(errorMessage(err, t('rbac.errors.deleteUser')));
    }
  };

  const getRoleColor = (roleName: string): string => {
    const name = roleName.toLowerCase();
    return ROLE_COLORS[name as keyof typeof ROLE_COLORS] || ROLE_COLORS.default;
  };

  const columns = useMemo<ColumnDef<UserWithRoles, any>[]>(() => [
    {
      id: 'username',
      header: t('rbac.username'),
      accessorFn: (row) => row.username,
      cell: (info) => <Typography sx={{
        fontWeight: 500
      }}>{String(info.getValue() ?? '')}</Typography>,
    },
    {
      id: 'email',
      header: t('common:field.email'),
      accessorFn: (row) => row.email,
    },
    {
      id: 'full_name',
      header: t('common:field.fullName'),
      accessorFn: (row) => row.full_name || '',
      cell: (info) => (info.getValue() as string) || '-',
    },
    {
      id: 'roles',
      header: t('rbac.roles'),
      accessorFn: (row) => (row.roles || []).map((r) => r.name).join(', '),
      enableSorting: false,
      cell: (info) => {
        const user = info.row.original;
        if (!user.roles || user.roles.length === 0) {
          return (
            <Typography variant="body2" sx={{
              color: "text.secondary"
            }}>{t('rbac.noRolesShort')}</Typography>
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
                  bgcolor: `color-mix(in srgb, ${getRoleColor(role.name)} 10%, transparent)`,
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
      header: t('common:field.status'),
      accessorFn: (row) => (row.is_active ? t('status:generic.active') : t('status:generic.inactive')),
      cell: (info) => {
        const user = info.row.original;
        return (
          <Chip
            label={user.is_active ? t('status:generic.active') : t('status:generic.inactive')}
            size="small"
            color={user.is_active ? 'success' : 'default'}
            variant={user.is_active ? 'filled' : 'outlined'}
          />
        );
      },
    },
    {
      id: 'created',
      header: t('common:field.createdAt'),
      accessorFn: (row) => (row.created_at ? new Date(row.created_at).getTime() : 0),
      cell: (info) => {
        const ts = info.getValue() as number;
        return ts ? formatHotelDate(new Date(ts)) : '-';
      },
    },
    {
      id: 'actions',
      header: t('common:field.actions'),
      enableSorting: false,
      enableColumnFilter: false,
      meta: { align: 'right', stopRowClick: true },
      cell: (info) => (
        <Tooltip title={t('rbac.deleteUser')}>
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
  ], [t]);

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, gap: 2 }}>
        <Box>
          <Typography variant="h6" sx={{
            fontWeight: 600
          }}>
            {t('rbac.userManagement')}
          </Typography>
          <Typography variant="body2" sx={{
            color: "text.secondary"
          }}>
            {t('rbac.userManagementSub')}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
          <TextField
            size="small"
            placeholder={t('rbac.searchUsers')}
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
            {t('rbac.addUser')}
          </Button>
        </Box>
      </Box>
      <DataTable<UserWithRoles>
        data={users}
        columns={columns}
        loading={loading}
        globalFilter={searchQuery}
        emptyMessage={t('rbac.noUsers')}
        onRowClick={handleOpenEdit}
        getRowId={(row) => row.id}
        renderMobileCard={(u) => (
          <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontWeight: 600 }}>{u.username}</Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>{u.email}</Typography>
                {u.full_name && (
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>{u.full_name}</Typography>
                )}
              </Box>
              <Chip
                label={u.is_active ? t('status:generic.active') : t('status:generic.inactive')}
                size="small"
                color={u.is_active ? 'success' : 'default'}
                variant={u.is_active ? 'filled' : 'outlined'}
              />
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 1, gap: 1 }}>
              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', minWidth: 0 }}>
                {u.roles && u.roles.length > 0 ? (
                  u.roles.map((role) => (
                    <Chip
                      key={role.id}
                      label={role.name}
                      size="small"
                      icon={<SecurityIcon sx={{ fontSize: 14 }} />}
                      sx={{
                        bgcolor: `color-mix(in srgb, ${getRoleColor(role.name)} 10%, transparent)`,
                        color: getRoleColor(role.name),
                        fontWeight: 500,
                        '& .MuiChip-icon': { color: 'inherit' },
                      }}
                    />
                  ))
                ) : (
                  <Typography variant="body2" sx={{ color: "text.secondary" }}>{t('rbac.noRolesShort')}</Typography>
                )}
              </Box>
              <IconButton
                size="small"
                color="error"
                aria-label={t('rbac.deleteUser')}
                onClick={(e) => {
                  e.stopPropagation();
                  handleOpenDelete(u);
                }}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          </Box>
        )}
      />
      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onClose={handleClose} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ pb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {editingUser ? <EditIcon color="primary" /> : <PersonAddIcon color="primary" />}
            <Typography variant="h6">
              {editingUser ? t('rbac.editUser') : t('rbac.createUser')}
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
              label={t('rbac.username')}
              value={formData.username}
              onChange={(e) => handleChange('username', e.target.value)}
              required
              fullWidth
              disabled={!!editingUser}
            />
            <TextField
              label={t('common:field.email')}
              type="email"
              value={formData.email}
              onChange={(e) => handleChange('email', e.target.value)}
              required
              fullWidth
            />
            <TextField
              label={t('common:field.fullName')}
              value={formData.full_name}
              onChange={(e) => handleChange('full_name', e.target.value)}
              fullWidth
            />
            <TextField
              label={editingUser ? t('rbac.newPassword') : t('rbac.password')}
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
                        aria-label={showPassword ? t('rbac.hidePassword') : t('rbac.showPassword')}
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
                label={t('rbac.confirmPassword')}
                type={showPassword ? 'text' : 'password'}
                value={formData.confirmPassword}
                onChange={(e) => handleChange('confirmPassword', e.target.value)}
                required={!editingUser}
                fullWidth
              />
            )}
            <FormControl fullWidth>
              <InputLabel>{t('rbac.roles')}</InputLabel>
              <Select
                multiple
                value={formData.role_ids}
                onChange={(e) => {
                  // MUI types multi-Select values as string | number[] even
                  // when every MenuItem value is numeric.
                  const ids = Array.isArray(e.target.value)
                    ? e.target.value
                    : [];
                  handleChange('role_ids', ids);
                }}
                input={<OutlinedInput label={t('rbac.roles')} />}
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
                label={t('status:generic.active')}
              />
            )}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={handleClose} disabled={submitting}>
            {t('common:actions.cancel')}
          </Button>
          <Button
            variant="contained"
            onClick={handleSubmit}
            disabled={submitting}
            startIcon={submitting ? <CircularProgress size={20} /> : null}
          >
            {submitting ? t('common:state.saving') : editingUser ? t('common:actions.update') : t('common:actions.create')}
          </Button>
        </DialogActions>
      </Dialog>
      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>{t('rbac.deleteUser')}</DialogTitle>
        <DialogContent>
          <Typography>
            {t('rbac.deleteUserConfirm', { name: userToDelete?.username })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)} disabled={submitting}>
            {t('common:actions.cancel')}
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleDelete}
            disabled={submitting}
            startIcon={submitting ? <CircularProgress size={20} /> : <DeleteIcon />}
          >
            {submitting ? t('common:state.deleting') : t('common:actions.delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default UsersTab;

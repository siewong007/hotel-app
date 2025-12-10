import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Chip,
  IconButton,
  Tabs,
  Tab,
  Grid,
  Alert,
  Snackbar,
  Tooltip,
  Menu,
  MenuItem,
  Divider,
} from '@mui/material';
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  Person as PersonIcon,
  Security as SecurityIcon,
  VpnKey as VpnKeyIcon,
  Group as GroupIcon,
  CheckCircle as CheckCircleIcon,
  Cancel as CancelIcon,
} from '@mui/icons-material';
import { HotelAPIService } from '../api';
import {
  Role,
  Permission,
  User,
  RoleInput,
  PermissionInput,
  AssignRoleInput,
  AssignPermissionInput,
  RoleWithPermissions,
  UserWithRolesAndPermissions,
} from '../types';
import { useAuth } from '../auth/AuthContext';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;
  return (
    <div role="tabpanel" hidden={value !== index} {...other}>
      {value === index && <Box sx={{ p: 3 }}>{children}</Box>}
    </div>
  );
}

const RBACManagementPage: React.FC = () => {
  const { hasRole } = useAuth();
  const [currentTab, setCurrentTab] = useState(0);
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' as 'success' | 'error' });
  
  // Dialog states
  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const [permissionDialogOpen, setPermissionDialogOpen] = useState(false);
  const [assignRoleDialogOpen, setAssignRoleDialogOpen] = useState(false);
  const [assignPermissionDialogOpen, setAssignPermissionDialogOpen] = useState(false);
  const [viewRoleDialogOpen, setViewRoleDialogOpen] = useState(false);
  const [viewUserDialogOpen, setViewUserDialogOpen] = useState(false);
  const [createUserDialogOpen, setCreateUserDialogOpen] = useState(false);

  // Form states
  const [roleForm, setRoleForm] = useState<RoleInput>({ name: '', description: '' });
  const [permissionForm, setPermissionForm] = useState<PermissionInput>({ name: '', resource: '', action: '', description: '' });
  const [assignRoleForm, setAssignRoleForm] = useState<AssignRoleInput>({ user_id: '', role_id: '' });
  const [assignPermissionForm, setAssignPermissionForm] = useState<AssignPermissionInput>({ role_id: '', permission_id: '' });
  const [createUserForm, setCreateUserForm] = useState<{
    username: string;
    email: string;
    password: string;
    full_name: string;
    phone: string;
    role_ids: string[];
  }>({ username: '', email: '', password: '', full_name: '', phone: '', role_ids: [] });
  
  // View states
  const [selectedRole, setSelectedRole] = useState<RoleWithPermissions | null>(null);
  const [selectedUser, setSelectedUser] = useState<UserWithRolesAndPermissions | null>(null);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  useEffect(() => {
    if (hasRole('admin')) {
      loadData();
    }
  }, [hasRole]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [rolesData, permissionsData, usersData] = await Promise.all([
        HotelAPIService.getAllRoles(),
        HotelAPIService.getAllPermissions(),
        HotelAPIService.getAllUsers(),
      ]);
      setRoles(rolesData);
      setPermissions(permissionsData);
      setUsers(usersData);
    } catch (error: any) {
      showSnackbar(error.message || 'Failed to load data', 'error');
    } finally {
      setLoading(false);
    }
  };

  const showSnackbar = (message: string, severity: 'success' | 'error' = 'success') => {
    setSnackbar({ open: true, message, severity });
  };

  const handleCreateRole = async () => {
    try {
      await HotelAPIService.createRole(roleForm);
      showSnackbar('Role created successfully');
      setRoleDialogOpen(false);
      setRoleForm({ name: '', description: '' });
      loadData();
    } catch (error: any) {
      showSnackbar(error.message || 'Failed to create role', 'error');
    }
  };

  const handleCreatePermission = async () => {
    try {
      await HotelAPIService.createPermission(permissionForm);
      showSnackbar('Permission created successfully');
      setPermissionDialogOpen(false);
      setPermissionForm({ name: '', resource: '', action: '', description: '' });
      loadData();
    } catch (error: any) {
      showSnackbar(error.message || 'Failed to create permission', 'error');
    }
  };

  const handleAssignRole = async () => {
    try {
      await HotelAPIService.assignRoleToUser(assignRoleForm);
      showSnackbar('Role assigned successfully');
      setAssignRoleDialogOpen(false);
      setAssignRoleForm({ user_id: '', role_id: '' });
      loadData();
    } catch (error: any) {
      showSnackbar(error.message || 'Failed to assign role', 'error');
    }
  };

  const handleRemoveRole = async (userId: string, roleId: string) => {
    try {
      await HotelAPIService.removeRoleFromUser(userId, roleId);
      showSnackbar('Role removed successfully');
      loadData();
    } catch (error: any) {
      showSnackbar(error.message || 'Failed to remove role', 'error');
    }
  };

  const handleAssignPermission = async () => {
    try {
      await HotelAPIService.assignPermissionToRole(assignPermissionForm);
      showSnackbar('Permission assigned successfully');
      setAssignPermissionDialogOpen(false);
      setAssignPermissionForm({ role_id: '', permission_id: '' });
      loadData();
    } catch (error: any) {
      showSnackbar(error.message || 'Failed to assign permission', 'error');
    }
  };

  const handleRemovePermission = async (roleId: string, permissionId: string) => {
    try {
      await HotelAPIService.removePermissionFromRole(roleId, permissionId);
      showSnackbar('Permission removed successfully');
      loadData();
    } catch (error: any) {
      showSnackbar(error.message || 'Failed to remove permission', 'error');
    }
  };

  const handleViewRole = async (roleId: string) => {
    try {
      const data = await HotelAPIService.getRolePermissions(roleId);
      setSelectedRole(data);
      setViewRoleDialogOpen(true);
    } catch (error: any) {
      showSnackbar(error.message || 'Failed to load role details', 'error');
    }
  };

  const handleViewUser = async (userId: string) => {
    try {
      const data = await HotelAPIService.getUserRolesAndPermissions(userId);
      setSelectedUser(data);
      setViewUserDialogOpen(true);
    } catch (error: any) {
      showSnackbar(error.message || 'Failed to load user details', 'error');
    }
  };

  const handleCreateUser = async () => {
    try {
      const userData = {
        username: createUserForm.username,
        email: createUserForm.email,
        password: createUserForm.password,
        full_name: createUserForm.full_name || undefined,
        phone: createUserForm.phone || undefined,
        role_ids: createUserForm.role_ids.map(id => parseInt(id)).filter(id => !isNaN(id)),
      };
      await HotelAPIService.createUser(userData);
      showSnackbar('User created successfully');
      setCreateUserDialogOpen(false);
      setCreateUserForm({ username: '', email: '', password: '', full_name: '', phone: '', role_ids: [] });
      loadData();
    } catch (error: any) {
      showSnackbar(error.message || 'Failed to create user', 'error');
    }
  };

  if (!hasRole('admin')) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">Access denied. Admin role required.</Alert>
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 700, background: 'linear-gradient(135deg, #1a73e8 0%, #1557b0 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          Roles & Permissions
        </Typography>
        <Chip icon={<SecurityIcon />} label="Admin Only" color="primary" />
      </Box>

      <Card>
        <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Tabs value={currentTab} onChange={(e, v) => setCurrentTab(v)}>
            <Tab icon={<GroupIcon />} iconPosition="start" label="Roles" />
            <Tab icon={<VpnKeyIcon />} iconPosition="start" label="Permissions" />
            <Tab icon={<PersonIcon />} iconPosition="start" label="Users" />
          </Tabs>
        </Box>

        <TabPanel value={currentTab} index={0}>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setRoleDialogOpen(true)}
            >
              Create Role
            </Button>
          </Box>
          <TableContainer component={Paper} variant="outlined">
            <Table>
              <TableHead>
                <TableRow sx={{ backgroundColor: 'primary.main' }}>
                  <TableCell sx={{ color: 'white', fontWeight: 600 }}>Name</TableCell>
                  <TableCell sx={{ color: 'white', fontWeight: 600 }}>Description</TableCell>
                  <TableCell sx={{ color: 'white', fontWeight: 600 }}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {roles.map((role) => (
                  <TableRow key={role.id} hover>
                    <TableCell><Typography variant="body1" sx={{ fontWeight: 500 }}>{role.name}</Typography></TableCell>
                    <TableCell>{role.description || '-'}</TableCell>
                    <TableCell>
                      <Tooltip title="View Permissions">
                        <IconButton size="small" onClick={() => handleViewRole(role.id)} color="primary">
                          <EditIcon />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </TabPanel>

        <TabPanel value={currentTab} index={1}>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setPermissionDialogOpen(true)}
            >
              Create Permission
            </Button>
          </Box>
          <TableContainer component={Paper} variant="outlined">
            <Table>
              <TableHead>
                <TableRow sx={{ backgroundColor: 'primary.main' }}>
                  <TableCell sx={{ color: 'white', fontWeight: 600 }}>Name</TableCell>
                  <TableCell sx={{ color: 'white', fontWeight: 600 }}>Resource</TableCell>
                  <TableCell sx={{ color: 'white', fontWeight: 600 }}>Action</TableCell>
                  <TableCell sx={{ color: 'white', fontWeight: 600 }}>Description</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {permissions.map((permission) => (
                  <TableRow key={permission.id} hover>
                    <TableCell><Typography variant="body1" sx={{ fontWeight: 500 }}>{permission.name}</Typography></TableCell>
                    <TableCell><Chip label={permission.resource} size="small" color="primary" variant="outlined" /></TableCell>
                    <TableCell><Chip label={permission.action} size="small" color="secondary" variant="outlined" /></TableCell>
                    <TableCell>{permission.description || '-'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </TabPanel>

        <TabPanel value={currentTab} index={2}>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2, gap: 1 }}>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setCreateUserDialogOpen(true)}
            >
              Create User
            </Button>
            <Button
              variant="outlined"
              startIcon={<GroupIcon />}
              onClick={() => setAssignRoleDialogOpen(true)}
            >
              Assign Role
            </Button>
          </Box>
          <TableContainer component={Paper} variant="outlined">
            <Table>
              <TableHead>
                <TableRow sx={{ backgroundColor: 'primary.main' }}>
                  <TableCell sx={{ color: 'white', fontWeight: 600 }}>Username</TableCell>
                  <TableCell sx={{ color: 'white', fontWeight: 600 }}>Email</TableCell>
                  <TableCell sx={{ color: 'white', fontWeight: 600 }}>Full Name</TableCell>
                  <TableCell sx={{ color: 'white', fontWeight: 600 }}>Status</TableCell>
                  <TableCell sx={{ color: 'white', fontWeight: 600 }}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id} hover>
                    <TableCell><Typography variant="body1" sx={{ fontWeight: 500 }}>{user.username}</Typography></TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>{user.full_name || '-'}</TableCell>
                    <TableCell>
                      <Chip
                        icon={user.is_active ? <CheckCircleIcon /> : <CancelIcon />}
                        label={user.is_active ? 'Active' : 'Inactive'}
                        color={user.is_active ? 'success' : 'default'}
                        size="small"
                      />
                    </TableCell>
                    <TableCell>
                      <Tooltip title="View Roles & Permissions">
                        <IconButton size="small" onClick={() => handleViewUser(user.id)} color="primary">
                          <EditIcon />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </TabPanel>
      </Card>

      {/* Create Role Dialog */}
      <Dialog open={roleDialogOpen} onClose={() => setRoleDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create New Role</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label="Role Name"
            value={roleForm.name}
            onChange={(e) => setRoleForm({ ...roleForm, name: e.target.value })}
            margin="normal"
            required
          />
          <TextField
            fullWidth
            label="Description"
            value={roleForm.description}
            onChange={(e) => setRoleForm({ ...roleForm, description: e.target.value })}
            margin="normal"
            multiline
            rows={3}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRoleDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleCreateRole} variant="contained" disabled={!roleForm.name}>
            Create
          </Button>
        </DialogActions>
      </Dialog>

      {/* Create Permission Dialog */}
      <Dialog open={permissionDialogOpen} onClose={() => setPermissionDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create New Permission</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label="Permission Name (e.g., rooms:read)"
            value={permissionForm.name}
            onChange={(e) => setPermissionForm({ ...permissionForm, name: e.target.value })}
            margin="normal"
            required
            helperText="Format: resource:action"
          />
          <TextField
            fullWidth
            label="Resource"
            value={permissionForm.resource}
            onChange={(e) => setPermissionForm({ ...permissionForm, resource: e.target.value })}
            margin="normal"
            required
          />
          <TextField
            fullWidth
            label="Action"
            value={permissionForm.action}
            onChange={(e) => setPermissionForm({ ...permissionForm, action: e.target.value })}
            margin="normal"
            required
          />
          <TextField
            fullWidth
            label="Description"
            value={permissionForm.description}
            onChange={(e) => setPermissionForm({ ...permissionForm, description: e.target.value })}
            margin="normal"
            multiline
            rows={2}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPermissionDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleCreatePermission} variant="contained" disabled={!permissionForm.name || !permissionForm.resource || !permissionForm.action}>
            Create
          </Button>
        </DialogActions>
      </Dialog>

      {/* Assign Role Dialog */}
      <Dialog open={assignRoleDialogOpen} onClose={() => setAssignRoleDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Assign Role to User</DialogTitle>
        <DialogContent>
          <TextField
            select
            fullWidth
            label="User"
            value={assignRoleForm.user_id}
            onChange={(e) => setAssignRoleForm({ ...assignRoleForm, user_id: e.target.value })}
            margin="normal"
            required
            SelectProps={{ native: true }}
          >
            <option value="">Select a user</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>{user.username} ({user.email})</option>
            ))}
          </TextField>
          <TextField
            select
            fullWidth
            label="Role"
            value={assignRoleForm.role_id}
            onChange={(e) => setAssignRoleForm({ ...assignRoleForm, role_id: e.target.value })}
            margin="normal"
            required
            SelectProps={{ native: true }}
          >
            <option value="">Select a role</option>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>{role.name}</option>
            ))}
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAssignRoleDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleAssignRole} variant="contained" disabled={!assignRoleForm.user_id || !assignRoleForm.role_id}>
            Assign
          </Button>
        </DialogActions>
      </Dialog>

      {/* Assign Permission Dialog */}
      <Dialog open={assignPermissionDialogOpen} onClose={() => setAssignPermissionDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Assign Permission to Role</DialogTitle>
        <DialogContent>
          <TextField
            select
            fullWidth
            label="Role"
            value={assignPermissionForm.role_id}
            onChange={(e) => setAssignPermissionForm({ ...assignPermissionForm, role_id: e.target.value })}
            margin="normal"
            required
            SelectProps={{ native: true }}
          >
            <option value="">Select a role</option>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>{role.name}</option>
            ))}
          </TextField>
          <TextField
            select
            fullWidth
            label="Permission"
            value={assignPermissionForm.permission_id}
            onChange={(e) => setAssignPermissionForm({ ...assignPermissionForm, permission_id: e.target.value })}
            margin="normal"
            required
            SelectProps={{ native: true }}
          >
            <option value="">Select a permission</option>
            {permissions.map((permission) => (
              <option key={permission.id} value={permission.id}>{permission.name}</option>
            ))}
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAssignPermissionDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleAssignPermission} variant="contained" disabled={!assignPermissionForm.role_id || !assignPermissionForm.permission_id}>
            Assign
          </Button>
        </DialogActions>
      </Dialog>

      {/* View Role Dialog */}
      <Dialog open={viewRoleDialogOpen} onClose={() => setViewRoleDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <SecurityIcon color="primary" />
            <Typography variant="h6">{selectedRole?.role.name}</Typography>
          </Box>
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {selectedRole?.role.description || 'No description'}
          </Typography>
          <Divider sx={{ my: 2 }} />
          <Typography variant="h6" gutterBottom>Permissions</Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 2 }}>
            {selectedRole?.permissions.map((perm) => (
              <Chip
                key={perm.id}
                label={`${perm.resource}:${perm.action}`}
                color="primary"
                variant="outlined"
                onDelete={() => {
                  handleRemovePermission(selectedRole.role.id, perm.id);
                  setViewRoleDialogOpen(false);
                }}
              />
            ))}
          </Box>
          <Box sx={{ mt: 2 }}>
            <Button
              variant="outlined"
              startIcon={<AddIcon />}
              onClick={() => {
                setAssignPermissionForm({ role_id: selectedRole?.role.id || '', permission_id: '' });
                setViewRoleDialogOpen(false);
                setAssignPermissionDialogOpen(true);
              }}
            >
              Add Permission
            </Button>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setViewRoleDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* View User Dialog */}
      <Dialog open={viewUserDialogOpen} onClose={() => setViewUserDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <PersonIcon color="primary" />
            <Typography variant="h6">{selectedUser?.user.username}</Typography>
          </Box>
        </DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid item xs={12} sm={6}>
              <Typography variant="body2" color="text.secondary">Email</Typography>
              <Typography variant="body1">{selectedUser?.user.email}</Typography>
            </Grid>
            <Grid item xs={12} sm={6}>
              <Typography variant="body2" color="text.secondary">Status</Typography>
              <Chip
                icon={selectedUser?.user.is_active ? <CheckCircleIcon /> : <CancelIcon />}
                label={selectedUser?.user.is_active ? 'Active' : 'Inactive'}
                color={selectedUser?.user.is_active ? 'success' : 'default'}
                size="small"
              />
            </Grid>
          </Grid>
          <Divider sx={{ my: 2 }} />
          <Typography variant="h6" gutterBottom>Roles</Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1, mb: 2 }}>
            {selectedUser?.roles.map((role) => (
              <Chip
                key={role.id}
                label={role.name}
                color="primary"
                onDelete={() => {
                  handleRemoveRole(selectedUser.user.id, role.id);
                  setViewUserDialogOpen(false);
                }}
              />
            ))}
          </Box>
          <Divider sx={{ my: 2 }} />
          <Typography variant="h6" gutterBottom>Permissions</Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1 }}>
            {selectedUser?.permissions.map((perm) => (
              <Chip
                key={perm.id}
                label={`${perm.resource}:${perm.action}`}
                color="secondary"
                variant="outlined"
              />
            ))}
          </Box>
          <Box sx={{ mt: 2 }}>
            <Button
              variant="outlined"
              startIcon={<AddIcon />}
              onClick={() => {
                setAssignRoleForm({ user_id: selectedUser?.user.id || '', role_id: '' });
                setViewUserDialogOpen(false);
                setAssignRoleDialogOpen(true);
              }}
            >
              Assign Role
            </Button>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setViewUserDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Create User Dialog */}
      <Dialog open={createUserDialogOpen} onClose={() => setCreateUserDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <PersonIcon color="primary" />
            <Typography variant="h6">Create New User</Typography>
          </Box>
        </DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label="Username"
            value={createUserForm.username}
            onChange={(e) => setCreateUserForm({ ...createUserForm, username: e.target.value })}
            margin="normal"
            required
          />
          <TextField
            fullWidth
            label="Email"
            type="email"
            value={createUserForm.email}
            onChange={(e) => setCreateUserForm({ ...createUserForm, email: e.target.value })}
            margin="normal"
            required
          />
          <TextField
            fullWidth
            label="Password"
            type="password"
            value={createUserForm.password}
            onChange={(e) => setCreateUserForm({ ...createUserForm, password: e.target.value })}
            margin="normal"
            required
            helperText="Password must be at least 8 characters with uppercase, lowercase, number, and special character"
          />
          <TextField
            fullWidth
            label="Full Name"
            value={createUserForm.full_name}
            onChange={(e) => setCreateUserForm({ ...createUserForm, full_name: e.target.value })}
            margin="normal"
          />
          <TextField
            fullWidth
            label="Phone"
            value={createUserForm.phone}
            onChange={(e) => setCreateUserForm({ ...createUserForm, phone: e.target.value })}
            margin="normal"
          />
          <TextField
            fullWidth
            select
            label="Assign Roles (Optional)"
            value={createUserForm.role_ids}
            onChange={(e) => {
              const value = e.target.value;
              setCreateUserForm({ ...createUserForm, role_ids: typeof value === 'string' ? value.split(',') : value });
            }}
            margin="normal"
            SelectProps={{
              multiple: true,
            }}
            helperText="Select one or more roles to assign to this user"
          >
            {roles.map((role) => (
              <MenuItem key={role.id} value={role.id.toString()}>
                {role.name} - {role.description}
              </MenuItem>
            ))}
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateUserDialogOpen(false)}>Cancel</Button>
          <Button
            onClick={handleCreateUser}
            variant="contained"
            disabled={!createUserForm.username || !createUserForm.email || !createUserForm.password}
          >
            Create User
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert onClose={() => setSnackbar({ ...snackbar, open: false })} severity={snackbar.severity} sx={{ width: '100%' }}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default RBACManagementPage;


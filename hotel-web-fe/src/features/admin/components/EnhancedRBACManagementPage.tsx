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
  Checkbox,
  FormControlLabel,
  FormGroup,
  Divider,
  Switch,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Security as SecurityIcon,
  VpnKey as VpnKeyIcon,
  Navigation as NavigationIcon,
  People as PeopleIcon,
  Save as SaveIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import { HotelAPIService } from '../../../api';
import { Role, Permission } from '../../../types';

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

// Navigation items configuration
interface NavigationItem {
  id: string;
  label: string;
  path: string;
  icon: string;
  description: string;
  category: 'core' | 'management' | 'analytics' | 'system';
}

const NAVIGATION_ITEMS: NavigationItem[] = [
  { id: 'timeline', label: 'Reservation Timeline', path: '/timeline', icon: 'EventNote', description: 'View and manage room reservations timeline', category: 'core' },
  { id: 'my-bookings', label: 'My Bookings', path: '/my-bookings', icon: 'Book', description: 'View personal bookings (Guest only)', category: 'core' },
  { id: 'guest-config', label: 'Guest', path: '/guest-config', icon: 'People', description: 'Manage guest profiles and information', category: 'management' },
  { id: 'room-config', label: 'Room Configuration', path: '/room-config', icon: 'Hotel', description: 'Manage room types and configurations', category: 'management' },
  { id: 'bookings', label: 'Bookings', path: '/bookings', icon: 'CalendarMonth', description: 'View and manage all bookings', category: 'management' },
  { id: 'room-management', label: 'Room Management', path: '/room-management', icon: 'HomeWork', description: 'Comprehensive room status and management dashboard', category: 'management' },
  { id: 'loyalty', label: 'Loyalty Portal', path: '/loyalty', icon: 'CardGiftcard', description: 'Manage loyalty program and rewards', category: 'analytics' },
  { id: 'my-rewards', label: 'My Rewards', path: '/my-rewards', icon: 'Star', description: 'View personal rewards (Guest only)', category: 'core' },
  { id: 'ekyc-admin', label: 'eKYC Verification', path: '/ekyc-admin', icon: 'VerifiedUser', description: 'Manage eKYC verifications', category: 'system' },
  { id: 'rbac', label: 'Roles & Permissions', path: '/rbac', icon: 'Security', description: 'Manage roles and permissions', category: 'system' },
  { id: 'settings', label: 'Settings', path: '/settings', icon: 'Settings', description: 'System settings and configuration', category: 'system' },
];

// Map navigation items to required page permissions
// When enabling navigation, these permissions will be automatically assigned
interface NavigationPermissionMapping {
  [navItemId: string]: Array<{
    name: string;
    resource: string;
    action: string;
    description: string;
  }>;
}

const NAVIGATION_PERMISSION_MAPPING: NavigationPermissionMapping = {
  'timeline': [
    { name: 'rooms:read', resource: 'rooms', action: 'read', description: 'View rooms and their availability' },
    { name: 'bookings:read', resource: 'bookings', action: 'read', description: 'View booking information' },
  ],
  'my-bookings': [
    { name: 'bookings:read', resource: 'bookings', action: 'read', description: 'View booking information' },
  ],
  'guest-config': [
    { name: 'guests:read', resource: 'guests', action: 'read', description: 'View guest information' },
    { name: 'guests:manage', resource: 'guests', action: 'manage', description: 'Manage guest profiles and data' },
  ],
  'room-config': [
    { name: 'rooms:read', resource: 'rooms', action: 'read', description: 'View rooms and their availability' },
    { name: 'rooms:manage', resource: 'rooms', action: 'manage', description: 'Manage room configurations and settings' },
  ],
  'bookings': [
    { name: 'bookings:read', resource: 'bookings', action: 'read', description: 'View booking information' },
    { name: 'bookings:manage', resource: 'bookings', action: 'manage', description: 'Manage all bookings' },
  ],
  'room-management': [
    { name: 'rooms:read', resource: 'rooms', action: 'read', description: 'View rooms and their status' },
    { name: 'rooms:manage', resource: 'rooms', action: 'manage', description: 'Manage room status, availability, and assignments' },
  ],
  'loyalty': [
    { name: 'loyalty:read', resource: 'loyalty', action: 'read', description: 'View loyalty program data' },
    { name: 'loyalty:manage', resource: 'loyalty', action: 'manage', description: 'Manage loyalty program' },
  ],
  'my-rewards': [
    { name: 'rewards:read', resource: 'rewards', action: 'read', description: 'View reward information' },
  ],
  'ekyc-admin': [
    { name: 'ekyc:manage', resource: 'ekyc', action: 'manage', description: 'Manage eKYC verifications' },
  ],
  'rbac': [
    { name: 'rbac:read', resource: 'rbac', action: 'read', description: 'View roles and permissions' },
    { name: 'rbac:manage', resource: 'rbac', action: 'manage', description: 'Manage roles and permissions' },
  ],
  'settings': [
    { name: 'settings:read', resource: 'settings', action: 'read', description: 'View system settings' },
    { name: 'settings:manage', resource: 'settings', action: 'manage', description: 'Manage system settings' },
  ],
};

interface RoleNavigationConfig {
  [roleId: string]: string[]; // roleId -> array of navigation item IDs
}

const EnhancedRBACManagementPage: React.FC = () => {
  const [currentTab, setCurrentTab] = useState(0);
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [roleNavConfig, setRoleNavConfig] = useState<RoleNavigationConfig>({});
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' as 'success' | 'error' });
  const [loading, setLoading] = useState(false);

  // Dialog states
  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const [permissionDialogOpen, setPermissionDialogOpen] = useState(false);
  const [roleForm, setRoleForm] = useState({ name: '', description: '' });
  const [permissionForm, setPermissionForm] = useState({ name: '', resource: '', action: '', description: '' });
  const [editingRole, setEditingRole] = useState<Role | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [rolesData, permissionsData] = await Promise.all([
        HotelAPIService.getAllRoles(),
        HotelAPIService.getAllPermissions(),
      ]);
      setRoles(rolesData);
      setPermissions(permissionsData);

      // Load navigation configuration from permissions
      const navConfig: RoleNavigationConfig = {};
      for (const role of rolesData) {
        const rolePerms = await HotelAPIService.getRolePermissions(String(role.id));
        const navItems = rolePerms.permissions
          .filter(p => p.resource.startsWith('navigation:'))
          .map(p => p.resource.replace('navigation:', ''));
        navConfig[role.id] = navItems;
      }
      setRoleNavConfig(navConfig);

    } catch (error: any) {
      showSnackbar(error.message || 'Failed to load data', 'error');
    } finally {
      setLoading(false);
    }
  };

  const showSnackbar = (message: string, severity: 'success' | 'error') => {
    setSnackbar({ open: true, message, severity });
  };

  const handleCreateRole = async () => {
    try {
      await HotelAPIService.createRole(roleForm);
      showSnackbar('Role created successfully', 'success');
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
      showSnackbar('Permission created successfully', 'success');
      setPermissionDialogOpen(false);
      setPermissionForm({ name: '', resource: '', action: '', description: '' });
      loadData();
    } catch (error: any) {
      showSnackbar(error.message || 'Failed to create permission', 'error');
    }
  };

  // Helper function to create or find a permission
  const createOrFindPermission = async (permSpec: { name: string; resource: string; action: string; description: string }) => {
    let permission = permissions.find(p => p.name === permSpec.name);
    if (!permission) {
      try {
        permission = await HotelAPIService.createPermission(permSpec);
      } catch (error: any) {
        // If permission already exists (duplicate key), fetch and find it
        if (error.message?.includes('duplicate key') || error.message?.includes('unique constraint')) {
          const allPermissions = await HotelAPIService.getAllPermissions();
          permission = allPermissions.find(p => p.name === permSpec.name);
          if (!permission) {
            throw new Error(`Permission ${permSpec.name} exists but could not be retrieved`);
          }
          setPermissions(allPermissions);
        } else {
          throw error;
        }
      }
    }
    return permission;
  };

  const handleToggleNavigation = async (roleId: number, navItemId: string, enabled: boolean) => {
    try {
      const permissionResource = `navigation:${navItemId}`;
      const permissionName = `navigation_${navItemId.replace(/-/g, '_')}:read`;
      const navItem = NAVIGATION_ITEMS.find(n => n.id === navItemId);
      const roleName = roles.find(r => r.id === roleId)?.name;

      if (enabled) {
        const permissionsToAssign: Permission[] = [];

        // 1. Create/find navigation permission
        const navPermission = await createOrFindPermission({
          name: permissionName,
          resource: permissionResource,
          action: 'read',
          description: `Permission to view ${navItem?.label || navItemId} navigation item`,
        });
        permissionsToAssign.push(navPermission);

        // 2. Create/find all required page permissions
        const requiredPermissions = NAVIGATION_PERMISSION_MAPPING[navItemId] || [];
        for (const permSpec of requiredPermissions) {
          const pagePermission = await createOrFindPermission(permSpec);
          permissionsToAssign.push(pagePermission);
        }

        // 3. Assign all permissions to role
        for (const perm of permissionsToAssign) {
          try {
            await HotelAPIService.assignPermissionToRole({
              role_id: roleId,
              permission_id: perm.id,
            });
          } catch (error: any) {
            // Ignore if permission already assigned
            if (!error.message?.includes('duplicate key') && !error.message?.includes('already assigned')) {
              throw error;
            }
          }
        }

        showSnackbar(
          `Enabled ${navItem?.label} for ${roleName} (${permissionsToAssign.length} permissions assigned)`,
          'success'
        );
      } else {
        // Remove navigation permission from role
        const permission = permissions.find(p => p.resource === permissionResource && p.action === 'read');
        if (permission) {
          await HotelAPIService.removePermissionFromRole(String(roleId), String(permission.id));
        }

        // Note: We don't remove page permissions when disabling navigation
        // as they might be needed by other navigation items or explicit grants

        showSnackbar(
          `Disabled ${navItem?.label} for ${roleName} (page permissions retained)`,
          'success'
        );
      }

      // Update local state
      setRoleNavConfig(prev => ({
        ...prev,
        [roleId]: enabled
          ? [...(prev[roleId] || []), navItemId]
          : (prev[roleId] || []).filter(id => id !== navItemId),
      }));

      // Reload permissions to keep state in sync
      const updatedPermissions = await HotelAPIService.getAllPermissions();
      setPermissions(updatedPermissions);
    } catch (error: any) {
      showSnackbar(error.message || 'Failed to update navigation permission', 'error');
      // Reload data on error to ensure state is consistent
      loadData();
    }
  };

  const handleSaveAllNavigationConfig = async () => {
    try {
      setLoading(true);
      showSnackbar('Navigation configuration saved successfully', 'success');
    } catch (error: any) {
      showSnackbar(error.message || 'Failed to save configuration', 'error');
    } finally {
      setLoading(false);
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'core': return 'primary';
      case 'management': return 'success';
      case 'analytics': return 'warning';
      case 'system': return 'error';
      default: return 'default';
    }
  };

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Box>
          <Typography variant="h4" component="h1" gutterBottom>
            RBAC & Navigation Management
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Dynamically configure roles, permissions, and dashboard navigation access
          </Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={loadData}
          disabled={loading}
        >
          Refresh
        </Button>
      </Box>

      <Card>
        <Tabs value={currentTab} onChange={(e, v) => setCurrentTab(v)}>
          <Tab icon={<NavigationIcon />} label="Navigation Config" />
          <Tab icon={<SecurityIcon />} label="Roles" />
          <Tab icon={<VpnKeyIcon />} label="Permissions" />
          <Tab icon={<PeopleIcon />} label="Role-Permission Matrix" />
        </Tabs>

        {/* Navigation Configuration Tab */}
        <TabPanel value={currentTab} index={0}>
          <Box mb={2}>
            <Alert severity="info" sx={{ mb: 2 }}>
              <Typography variant="body2" fontWeight={600} gutterBottom>
                Configure Navigation & Page Access
              </Typography>
              <Typography variant="body2">
                When you enable a navigation item, the system automatically grants:
              </Typography>
              <ul style={{ marginTop: 8, marginBottom: 8, paddingLeft: 20 }}>
                <li><strong>Navigation permission</strong>: Shows the tab in the menu</li>
                <li><strong>Page permissions</strong>: Grants access to use that page (read/manage)</li>
              </ul>
              <Typography variant="body2" color="text.secondary">
                Example: Enabling "Guest Config" assigns <code>navigation_guest_config:read</code>, <code>guests:read</code>, and <code>guests:manage</code>
              </Typography>
            </Alert>
          </Box>

          <Grid container spacing={3}>
            {['core', 'management', 'analytics', 'system'].map(category => (
              <Grid item xs={12} key={category}>
                <Typography variant="h6" gutterBottom sx={{ textTransform: 'capitalize' }}>
                  {category} Navigation
                </Typography>
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow sx={{ backgroundColor: '#f5f5f5' }}>
                        <TableCell><strong>Navigation Item</strong></TableCell>
                        <TableCell><strong>Required Permissions</strong></TableCell>
                        {roles.map(role => (
                          <TableCell key={role.id} align="center">
                            <strong>{role.name}</strong>
                          </TableCell>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {NAVIGATION_ITEMS.filter(item => item.category === category).map(navItem => {
                        const requiredPerms = NAVIGATION_PERMISSION_MAPPING[navItem.id] || [];
                        return (
                          <TableRow key={navItem.id} hover>
                            <TableCell>
                              <Box>
                                <Typography variant="body2" fontWeight={500}>
                                  {navItem.label}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                  {navItem.description}
                                </Typography>
                              </Box>
                            </TableCell>
                            <TableCell>
                              <Box>
                                {requiredPerms.map((perm, idx) => (
                                  <Chip
                                    key={idx}
                                    label={perm.name}
                                    size="small"
                                    variant="outlined"
                                    sx={{ mr: 0.5, mb: 0.5, fontSize: '0.7rem' }}
                                  />
                                ))}
                                {requiredPerms.length === 0 && (
                                  <Typography variant="caption" color="text.secondary">
                                    Navigation only
                                  </Typography>
                                )}
                              </Box>
                            </TableCell>
                          {roles.map(role => (
                            <TableCell key={role.id} align="center">
                              <Switch
                                checked={roleNavConfig[role.id]?.includes(navItem.id) || false}
                                onChange={(e) => handleToggleNavigation(role.id, navItem.id, e.target.checked)}
                                color="primary"
                                size="small"
                              />
                            </TableCell>
                          ))}
                        </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Grid>
            ))}
          </Grid>
        </TabPanel>

        {/* Roles Tab */}
        <TabPanel value={currentTab} index={1}>
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
            <Typography variant="h6">Manage Roles</Typography>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setRoleDialogOpen(true)}
            >
              Create Role
            </Button>
          </Box>

          <TableContainer component={Paper}>
            <Table>
              <TableHead>
                <TableRow sx={{ backgroundColor: '#f5f5f5' }}>
                  <TableCell><strong>Role Name</strong></TableCell>
                  <TableCell><strong>Description</strong></TableCell>
                  <TableCell><strong>Created</strong></TableCell>
                  <TableCell><strong>Navigation Items</strong></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {roles.map(role => (
                  <TableRow key={role.id} hover>
                    <TableCell>
                      <Chip label={role.name} color="primary" size="small" />
                    </TableCell>
                    <TableCell>{role.description || '-'}</TableCell>
                    <TableCell>
                      {new Date(role.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Box display="flex" gap={0.5} flexWrap="wrap">
                        {(roleNavConfig[role.id] || []).map(navId => (
                          <Chip
                            key={navId}
                            label={NAVIGATION_ITEMS.find(n => n.id === navId)?.label || navId}
                            size="small"
                            color={getCategoryColor(NAVIGATION_ITEMS.find(n => n.id === navId)?.category || 'default') as any}
                          />
                        ))}
                      </Box>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </TabPanel>

        {/* Permissions Tab */}
        <TabPanel value={currentTab} index={2}>
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
            <Typography variant="h6">Manage Permissions</Typography>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setPermissionDialogOpen(true)}
            >
              Create Permission
            </Button>
          </Box>

          <TableContainer component={Paper}>
            <Table>
              <TableHead>
                <TableRow sx={{ backgroundColor: '#f5f5f5' }}>
                  <TableCell><strong>Permission Name</strong></TableCell>
                  <TableCell><strong>Resource</strong></TableCell>
                  <TableCell><strong>Action</strong></TableCell>
                  <TableCell><strong>Description</strong></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {permissions.map(permission => (
                  <TableRow key={permission.id} hover>
                    <TableCell>{permission.name}</TableCell>
                    <TableCell>
                      <Chip
                        label={permission.resource}
                        size="small"
                        color={permission.resource.startsWith('navigation:') ? 'info' : 'default'}
                      />
                    </TableCell>
                    <TableCell>
                      <Chip label={permission.action} size="small" />
                    </TableCell>
                    <TableCell>{permission.description || '-'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </TabPanel>

        {/* Role-Permission Matrix Tab */}
        <TabPanel value={currentTab} index={3}>
          <Typography variant="h6" gutterBottom>
            Role-Permission Matrix
          </Typography>
          <Alert severity="info" sx={{ mb: 2 }}>
            This matrix shows all permissions assigned to each role. Navigation permissions are highlighted in blue.
          </Alert>

          {roles.map(role => (
            <Card key={role.id} sx={{ mb: 2 }}>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  <Chip label={role.name} color="primary" sx={{ mr: 1 }} />
                  {role.description}
                </Typography>
                <Divider sx={{ my: 1 }} />
                <Box display="flex" gap={0.5} flexWrap="wrap">
                  {permissions
                    .filter(p => roleNavConfig[role.id]?.includes(p.resource.replace('navigation:', '')))
                    .map(permission => (
                      <Chip
                        key={permission.id}
                        label={`${permission.resource}:${permission.action}`}
                        size="small"
                        color={permission.resource.startsWith('navigation:') ? 'info' : 'default'}
                      />
                    ))}
                </Box>
              </CardContent>
            </Card>
          ))}
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
            label="Permission Name"
            value={permissionForm.name}
            onChange={(e) => setPermissionForm({ ...permissionForm, name: e.target.value })}
            margin="normal"
            required
          />
          <TextField
            fullWidth
            label="Resource"
            value={permissionForm.resource}
            onChange={(e) => setPermissionForm({ ...permissionForm, resource: e.target.value })}
            margin="normal"
            required
            placeholder="e.g., navigation:timeline, bookings, rooms"
          />
          <TextField
            fullWidth
            label="Action"
            value={permissionForm.action}
            onChange={(e) => setPermissionForm({ ...permissionForm, action: e.target.value })}
            margin="normal"
            required
            placeholder="e.g., view, create, update, delete"
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
          <Button
            onClick={handleCreatePermission}
            variant="contained"
            disabled={!permissionForm.name || !permissionForm.resource || !permissionForm.action}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
      >
        <Alert
          onClose={() => setSnackbar({ ...snackbar, open: false })}
          severity={snackbar.severity}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default EnhancedRBACManagementPage;

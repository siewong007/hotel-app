import React, { useState } from 'react';
import {
  Box,
  Typography,
  Tabs,
  Tab,
  Paper,
  IconButton,
  Tooltip,
  Snackbar,
  Alert,
  CircularProgress,
  alpha,
} from '@mui/material';
import {
  Security as SecurityIcon,
  Refresh as RefreshIcon,
  VpnKey as PermissionsIcon,
  People as RolesIcon,
  PersonAdd as UsersIcon,
} from '@mui/icons-material';
import type { Permission, Role, User } from '../../../../types';
import { useRBACData } from './hooks/useRBACData';
import { PermissionsTab } from './PermissionsTab';
import { RolesTab } from './RolesTab';
import { UsersTab } from './UsersTab';
import { HotelAPIService } from '../../../../api';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`rbac-tabpanel-${index}`}
      aria-labelledby={`rbac-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ py: 3 }}>{children}</Box>}
    </div>
  );
}

function a11yProps(index: number) {
  return {
    id: `rbac-tab-${index}`,
    'aria-controls': `rbac-tabpanel-${index}`,
  };
}

const RBACManagementPageV2: React.FC = () => {
  const [activeTab, setActiveTab] = useState(0);
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: 'success' | 'error';
  }>({ open: false, message: '', severity: 'success' });

  const {
    roles,
    permissions,
    users,
    rolesWithStats,
    permissionCategories,
    rolePermissionMap,
    loading,
    error,
    reload,
    setRoles,
    setPermissions,
    setUsers,
    updateRolePermissions,
    updateUserRoles,
  } = useRBACData();

  const showSnackbar = (message: string, severity: 'success' | 'error' = 'success') => {
    setSnackbar({ open: true, message, severity });
  };

  // Permission handlers
  const handleAddRoleToPermission = async (permission: Permission, role: Role) => {
    try {
      await HotelAPIService.assignPermissionToRole({
        role_id: role.id,
        permission_id: permission.id,
      });

      // Update local state
      const currentPerms = rolesWithStats.find((r) => r.id === role.id)?.permissions || [];
      updateRolePermissions(role.id, [...currentPerms, permission]);

      showSnackbar(`Added ${role.name} to ${permission.name}`);
    } catch (err: any) {
      showSnackbar(err.message || 'Failed to assign permission', 'error');
      throw err;
    }
  };

  const handleRemoveRoleFromPermission = async (permission: Permission, role: Role) => {
    try {
      await HotelAPIService.removePermissionFromRole(String(role.id), String(permission.id));

      // Update local state
      const currentPerms = rolesWithStats.find((r) => r.id === role.id)?.permissions || [];
      updateRolePermissions(
        role.id,
        currentPerms.filter((p) => p.id !== permission.id)
      );

      showSnackbar(`Removed ${role.name} from ${permission.name}`);
    } catch (err: any) {
      showSnackbar(err.message || 'Failed to remove permission', 'error');
      throw err;
    }
  };

  const handlePermissionCreated = (permission: Permission) => {
    setPermissions((prev) => [...prev, permission]);
    showSnackbar(`Permission "${permission.name}" created`);
  };

  // Role handlers
  const handleRoleCreated = (role: Role) => {
    setRoles((prev) => [...prev, role]);
    updateRolePermissions(role.id, []);
    showSnackbar(`Role "${role.name}" created`);
  };

  const handleRoleUpdated = (role: Role, updatedPermissions: Permission[]) => {
    setRoles((prev) => prev.map((r) => (r.id === role.id ? role : r)));
    updateRolePermissions(role.id, updatedPermissions);
    showSnackbar(`Role "${role.name}" updated`);
  };

  const handleRoleDeleted = (roleId: number) => {
    setRoles((prev) => prev.filter((r) => r.id !== roleId));
    showSnackbar('Role deleted');
  };

  // User handlers
  const handleUserCreated = (user: User) => {
    setUsers((prev) => [...prev, { ...user, roles: [] }]);
    showSnackbar(`User "${user.username}" created`);
  };

  const handleUserUpdated = (user: User) => {
    setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, ...user } : u)));
    showSnackbar(`User "${user.username}" updated`);
  };

  const handleUserDeleted = (userId: string) => {
    setUsers((prev) => prev.filter((u) => u.id !== userId));
    showSnackbar('User deleted');
  };

  const handleRolesAssigned = (userId: string, roleIds: number[]) => {
    updateUserRoles(userId, roleIds);
    showSnackbar('User roles updated');
  };

  if (error && !loading) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert
          severity="error"
          action={
            <IconButton color="inherit" size="small" onClick={reload}>
              <RefreshIcon />
            </IconButton>
          }
        >
          {error}
        </Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 48,
              height: 48,
              borderRadius: 2,
              backgroundColor: alpha('#d32f2f', 0.1),
              color: '#d32f2f',
            }}
          >
            <SecurityIcon fontSize="large" />
          </Box>
          <Box>
            <Typography variant="h4" fontWeight={700}>
              Roles & Permissions
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Manage access control for your hotel management system
            </Typography>
          </Box>
        </Box>

        <Tooltip title="Refresh data">
          <IconButton onClick={reload} disabled={loading}>
            {loading ? <CircularProgress size={24} /> : <RefreshIcon />}
          </IconButton>
        </Tooltip>
      </Box>

      {/* Tabs */}
      <Paper sx={{ borderRadius: 2, overflow: 'hidden' }}>
        <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 2 }}>
          <Tabs
            value={activeTab}
            onChange={(_, newValue) => setActiveTab(newValue)}
            aria-label="RBAC management tabs"
          >
            <Tab
              icon={<PermissionsIcon sx={{ fontSize: 20 }} />}
              iconPosition="start"
              label="Permissions"
              {...a11yProps(0)}
              sx={{ minHeight: 56 }}
            />
            <Tab
              icon={<RolesIcon sx={{ fontSize: 20 }} />}
              iconPosition="start"
              label="Roles"
              {...a11yProps(1)}
              sx={{ minHeight: 56 }}
            />
            <Tab
              icon={<UsersIcon sx={{ fontSize: 20 }} />}
              iconPosition="start"
              label="Users"
              {...a11yProps(2)}
              sx={{ minHeight: 56 }}
            />
          </Tabs>
        </Box>

        <Box sx={{ px: 3 }}>
          <TabPanel value={activeTab} index={0}>
            <PermissionsTab
              permissions={permissions}
              roles={roles}
              permissionCategories={permissionCategories}
              rolePermissionMap={rolePermissionMap}
              onAddRoleToPermission={handleAddRoleToPermission}
              onRemoveRoleFromPermission={handleRemoveRoleFromPermission}
              onPermissionCreated={handlePermissionCreated}
              loading={loading}
            />
          </TabPanel>

          <TabPanel value={activeTab} index={1}>
            <RolesTab
              roles={rolesWithStats}
              permissions={permissions}
              onRoleCreated={handleRoleCreated}
              onRoleUpdated={handleRoleUpdated}
              onRoleDeleted={handleRoleDeleted}
              loading={loading}
            />
          </TabPanel>

          <TabPanel value={activeTab} index={2}>
            <UsersTab
              users={users}
              roles={roles}
              loading={loading}
              onUserCreated={handleUserCreated}
              onUserUpdated={handleUserUpdated}
              onUserDeleted={handleUserDeleted}
              onRolesAssigned={handleRolesAssigned}
            />
          </TabPanel>
        </Box>
      </Paper>

      {/* Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert
          onClose={() => setSnackbar({ ...snackbar, open: false })}
          severity={snackbar.severity}
          variant="filled"
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default RBACManagementPageV2;

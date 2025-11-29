import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  TextField,
  Button,
  Alert,
  Chip,
  Grid,
  Divider,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Paper
} from '@mui/material';
import {
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Settings as SettingsIcon,
  Http as HttpIcon,
  Security as SecurityIcon,
  HealthAndSafety as HealthIcon,
  Web as WebIcon,
  VpnKey as VpnKeyIcon,
  Group as GroupIcon,
  Person as PersonIcon
} from '@mui/icons-material';
import { HotelAPIService } from '../api';
import { useAuth } from '../auth/AuthContext';

const SettingsPage: React.FC = () => {
  const { hasRole } = useAuth();
  const [apiUrl, setApiUrl] = useState('http://localhost:3030');
  const [connectionStatus, setConnectionStatus] = useState<'untested' | 'success' | 'error'>('untested');
  const [testing, setTesting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [healthStatus, setHealthStatus] = useState<{ status: string } | null>(null);
  const [wsStatus, setWsStatus] = useState<{ status: string; message: string } | null>(null);

  useEffect(() => {
    loadStatus();
  }, []);

  const loadStatus = async () => {
    try {
      const [health, ws] = await Promise.all([
        HotelAPIService.getHealth(),
        HotelAPIService.getWebSocketStatus(),
      ]);
      setHealthStatus(health);
      setWsStatus(ws);
    } catch (error) {
      console.error('Failed to load status:', error);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    setConnectionStatus('untested');
    setErrorMessage('');

    try {
      await HotelAPIService.getAllRooms();
      setConnectionStatus('success');
      await loadStatus();
    } catch (error: any) {
      setConnectionStatus('error');
      setErrorMessage(error.message || 'Failed to connect to API');
    } finally {
      setTesting(false);
    }
  };

  const getStatusIcon = () => {
    switch (connectionStatus) {
      case 'success':
        return <CheckCircleIcon color="success" />;
      case 'error':
        return <ErrorIcon color="error" />;
      default:
        return <SettingsIcon color="disabled" />;
    }
  };

  const getStatusText = () => {
    switch (connectionStatus) {
      case 'success':
        return 'Connected';
      case 'error':
        return 'Connection Failed';
      default:
        return 'Not Tested';
    }
  };

  const getStatusColor = () => {
    switch (connectionStatus) {
      case 'success':
        return 'success';
      case 'error':
        return 'error';
      default:
        return 'default';
    }
  };

  return (
    <Box>
      <Typography variant="h4" component="h1" gutterBottom>
        System Settings
      </Typography>

      {/* API Configuration */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            <HttpIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
            API Configuration
          </Typography>

          <Grid container spacing={3} alignItems="center">
            <Grid item xs={12} md={8}>
              <TextField
                fullWidth
                label="API Base URL"
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
                placeholder="http://localhost:3030"
                helperText="The base URL of your hotel management API"
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <Button
                variant="contained"
                onClick={testConnection}
                disabled={testing}
                fullWidth
              >
                {testing ? 'Testing...' : 'Test Connection'}
              </Button>
            </Grid>
          </Grid>

          {/* Connection Status */}
          <Box mt={2} display="flex" alignItems="center" gap={1}>
            {getStatusIcon()}
            <Chip
              label={getStatusText()}
              color={getStatusColor() as any}
              variant="outlined"
            />
          </Box>

          {connectionStatus === 'error' && errorMessage && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {errorMessage}
            </Alert>
          )}

          {connectionStatus === 'success' && (
            <Alert severity="success" sx={{ mt: 2 }}>
              Successfully connected to the hotel management API!
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* System Information */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            System Information
          </Typography>

          <Grid container spacing={2}>
            <Grid item xs={12} md={6}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="subtitle1" color="primary">
                    Backend Status
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Rust HTTP Server
                  </Typography>
                  <Typography variant="body2">
                    Running on: {apiUrl}
                  </Typography>
                  <Typography variant="body2">
                    Technology: Warp web framework
                  </Typography>
                </CardContent>
              </Card>
            </Grid>

            <Grid item xs={12} md={6}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="subtitle1" color="secondary">
                    Frontend Status
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    React TypeScript Application
                  </Typography>
                  <Typography variant="body2">
                    Framework: Material-UI + React Router
                  </Typography>
                  <Typography variant="body2">
                    Status: Active
                  </Typography>
                </CardContent>
              </Card>
            </Grid>

            <Grid item xs={12}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="subtitle1" color="success">
                    Database Status
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    In-Memory Storage
                  </Typography>
                  <Typography variant="body2">
                    Data persistence: None (reset on server restart)
                  </Typography>
                  <Typography variant="body2">
                    Storage type: HashMap collections
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* System Status */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <HealthIcon color="primary" />
                <Typography variant="h6">Health Check</Typography>
              </Box>
              {healthStatus ? (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <CheckCircleIcon color="success" />
                  <Typography variant="body1" color="success.main">
                    {healthStatus.status === 'ok' ? 'System Healthy' : healthStatus.status}
                  </Typography>
                </Box>
              ) : (
                <Typography variant="body2" color="text.secondary">Loading...</Typography>
              )}
              <Button
                size="small"
                variant="outlined"
                onClick={loadStatus}
                sx={{ mt: 2 }}
              >
                Refresh
              </Button>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <WebIcon color="primary" />
                <Typography variant="h6">WebSocket Status</Typography>
              </Box>
              {wsStatus ? (
                <Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    <CheckCircleIcon color={wsStatus.status === 'available' ? 'success' : 'error'} />
                    <Typography variant="body1" color={wsStatus.status === 'available' ? 'success.main' : 'error.main'}>
                      {wsStatus.status === 'available' ? 'Available' : 'Unavailable'}
                    </Typography>
                  </Box>
                  <Typography variant="body2" color="text.secondary">
                    {wsStatus.message}
                  </Typography>
                </Box>
              ) : (
                <Typography variant="body2" color="text.secondary">Loading...</Typography>
              )}
              <Button
                size="small"
                variant="outlined"
                onClick={loadStatus}
                sx={{ mt: 2 }}
              >
                Refresh
              </Button>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* API Endpoints Documentation */}
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <HttpIcon color="primary" />
            Available API Endpoints
          </Typography>
          <Divider sx={{ my: 2 }} />

          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
                <Typography variant="subtitle1" color="primary" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <SettingsIcon /> Room Operations
                </Typography>
                <List dense>
                  <ListItem>
                    <ListItemIcon><HttpIcon fontSize="small" /></ListItemIcon>
                    <ListItemText primary="GET /rooms" secondary="Get all rooms" />
                  </ListItem>
                  <ListItem>
                    <ListItemIcon><HttpIcon fontSize="small" /></ListItemIcon>
                    <ListItemText primary="GET /rooms/available" secondary="Search available rooms (query: room_type, max_price)" />
                  </ListItem>
                </List>
              </Paper>

              <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
                <Typography variant="subtitle1" color="secondary" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <PersonIcon /> Guest Operations
                </Typography>
                <List dense>
                  <ListItem>
                    <ListItemIcon><HttpIcon fontSize="small" /></ListItemIcon>
                    <ListItemText primary="GET /guests" secondary="Get all guests" />
                  </ListItem>
                  <ListItem>
                    <ListItemIcon><HttpIcon fontSize="small" /></ListItemIcon>
                    <ListItemText primary="POST /guests" secondary="Create new guest" />
                  </ListItem>
                </List>
              </Paper>

              <Paper variant="outlined" sx={{ p: 2 }}>
                <Typography variant="subtitle1" color="success" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <SettingsIcon /> Booking Operations
                </Typography>
                <List dense>
                  <ListItem>
                    <ListItemIcon><HttpIcon fontSize="small" /></ListItemIcon>
                    <ListItemText primary="GET /bookings" secondary="Get all bookings with details" />
                  </ListItem>
                  <ListItem>
                    <ListItemIcon><HttpIcon fontSize="small" /></ListItemIcon>
                    <ListItemText primary="POST /bookings" secondary="Create new booking" />
                  </ListItem>
                </List>
              </Paper>
            </Grid>

            <Grid item xs={12} md={6}>
              <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
                <Typography variant="subtitle1" color="info" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <HealthIcon /> System Endpoints
                </Typography>
                <List dense>
                  <ListItem>
                    <ListItemIcon><HealthIcon fontSize="small" /></ListItemIcon>
                    <ListItemText primary="GET /health" secondary="Health check endpoint (public)" />
                  </ListItem>
                  <ListItem>
                    <ListItemIcon><WebIcon fontSize="small" /></ListItemIcon>
                    <ListItemText primary="GET /ws/status" secondary="WebSocket status (public)" />
                  </ListItem>
                  <ListItem>
                    <ListItemIcon><HttpIcon fontSize="small" /></ListItemIcon>
                    <ListItemText primary="POST /auth/login" secondary="User authentication" />
                  </ListItem>
                </List>
              </Paper>

              {hasRole('admin') && (
                <Paper variant="outlined" sx={{ p: 2, border: '2px solid', borderColor: 'primary.main' }}>
                  <Typography variant="subtitle1" color="primary" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1, fontWeight: 600 }}>
                    <SecurityIcon /> RBAC Management (Admin Only)
                  </Typography>
                  <List dense>
                    <ListItem>
                      <ListItemIcon><GroupIcon fontSize="small" /></ListItemIcon>
                      <ListItemText primary="GET /rbac/roles" secondary="Get all roles" />
                    </ListItem>
                    <ListItem>
                      <ListItemIcon><GroupIcon fontSize="small" /></ListItemIcon>
                      <ListItemText primary="POST /rbac/roles" secondary="Create new role" />
                    </ListItem>
                    <ListItem>
                      <ListItemIcon><VpnKeyIcon fontSize="small" /></ListItemIcon>
                      <ListItemText primary="GET /rbac/permissions" secondary="Get all permissions" />
                    </ListItem>
                    <ListItem>
                      <ListItemIcon><VpnKeyIcon fontSize="small" /></ListItemIcon>
                      <ListItemText primary="POST /rbac/permissions" secondary="Create new permission" />
                    </ListItem>
                    <ListItem>
                      <ListItemIcon><PersonIcon fontSize="small" /></ListItemIcon>
                      <ListItemText primary="GET /rbac/users" secondary="Get all users" />
                    </ListItem>
                    <ListItem>
                      <ListItemIcon><PersonIcon fontSize="small" /></ListItemIcon>
                      <ListItemText primary="GET /rbac/users/:id" secondary="Get user with roles & permissions" />
                    </ListItem>
                    <ListItem>
                      <ListItemIcon><GroupIcon fontSize="small" /></ListItemIcon>
                      <ListItemText primary="POST /rbac/users/roles" secondary="Assign role to user" />
                    </ListItem>
                    <ListItem>
                      <ListItemIcon><GroupIcon fontSize="small" /></ListItemIcon>
                      <ListItemText primary="DELETE /rbac/users/:id/roles/:id" secondary="Remove role from user" />
                    </ListItem>
                    <ListItem>
                      <ListItemIcon><VpnKeyIcon fontSize="small" /></ListItemIcon>
                      <ListItemText primary="POST /rbac/roles/permissions" secondary="Assign permission to role" />
                    </ListItem>
                    <ListItem>
                      <ListItemIcon><VpnKeyIcon fontSize="small" /></ListItemIcon>
                      <ListItemText primary="DELETE /rbac/roles/:id/permissions/:id" secondary="Remove permission from role" />
                    </ListItem>
                    <ListItem>
                      <ListItemIcon><GroupIcon fontSize="small" /></ListItemIcon>
                      <ListItemText primary="GET /rbac/roles/:id/permissions" secondary="Get role with permissions" />
                    </ListItem>
                  </List>
                </Paper>
              )}

              <Typography variant="body2" sx={{ mt: 2, fontStyle: 'italic', color: 'text.secondary' }}>
                All POST endpoints accept JSON data in the request body.
                CORS is enabled for development. Authentication required for most endpoints.
              </Typography>
            </Grid>
          </Grid>
        </CardContent>
      </Card>
    </Box>
  );
};

export default SettingsPage;

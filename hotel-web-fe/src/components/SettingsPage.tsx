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
  Grid
} from '@mui/material';
import {
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Settings as SettingsIcon,
  Http as HttpIcon,
  HealthAndSafety as HealthIcon,
  Web as WebIcon,
  Language as LanguageIcon
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { HotelAPIService } from '../api';
import { useAuth } from '../auth/AuthContext';
import { LanguageSwitcher } from './i18n/LanguageSwitcher';
import { languageStorage } from '../utils/languageStorage';
import { getLanguageByCode } from '../i18n/config';

const SettingsPage: React.FC = () => {
  const { hasRole } = useAuth();
  const { i18n } = useTranslation();
  const [apiUrl, setApiUrl] = useState('http://localhost:3030');
  const [connectionStatus, setConnectionStatus] = useState<'untested' | 'success' | 'error'>('untested');
  const [testing, setTesting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [healthStatus, setHealthStatus] = useState<{ status: string } | null>(null);
  const [wsStatus, setWsStatus] = useState<{ status: string; message: string } | null>(null);
  const [currentLanguage, setCurrentLanguage] = useState(i18n.language);

  useEffect(() => {
    loadStatus();

    // Update current language when it changes
    const handleLanguageChange = (lng: string) => {
      setCurrentLanguage(lng);
    };

    i18n.on('languageChanged', handleLanguageChange);

    return () => {
      i18n.off('languageChanged', handleLanguageChange);
    };
  }, [i18n]);

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

  const currentLangInfo = getLanguageByCode(currentLanguage);

  return (
    <Box>
      <Typography variant="h4" component="h1" gutterBottom>
        System Settings
      </Typography>

      {/* Language Settings */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            <LanguageIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
            Language Preferences
          </Typography>

          <Grid container spacing={3} alignItems="center">
            <Grid item xs={12} md={8}>
              <Box sx={{ mb: 2 }}>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  Current Language
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="h6" sx={{ fontSize: '2rem' }}>
                    {currentLangInfo?.flag}
                  </Typography>
                  <Box>
                    <Typography variant="body1" fontWeight={600}>
                      {currentLangInfo?.nativeName}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {currentLangInfo?.name}
                    </Typography>
                  </Box>
                </Box>
              </Box>
              <Typography variant="body2" color="text.secondary">
                Select your preferred language for the application interface.
                Your choice will be saved and applied automatically on your next visit.
              </Typography>
            </Grid>
            <Grid item xs={12} md={4}>
              <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                <LanguageSwitcher variant="button" showQualityBadge={true} />
              </Box>
            </Grid>
          </Grid>

          <Alert severity="info" sx={{ mt: 2 }}>
            Language changes are applied immediately and saved to your browser's local storage.
          </Alert>
        </CardContent>
      </Card>

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
    </Box>
  );
};

export default SettingsPage;

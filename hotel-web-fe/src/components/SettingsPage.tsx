import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  TextField,
  Button,
  Alert,
  Grid,
  Divider,
  CircularProgress
} from '@mui/material';
import {
  Business as BusinessIcon,
  Schedule as ScheduleIcon,
  AttachMoney as MoneyIcon,
  Save as SaveIcon
} from '@mui/icons-material';
import { useAuth } from '../auth/AuthContext';

const SettingsPage: React.FC = () => {
  const { hasRole } = useAuth();
  const isAdmin = hasRole('admin');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Hotel Information
  const [hotelName, setHotelName] = useState('');
  const [hotelAddress, setHotelAddress] = useState('');
  const [hotelPhone, setHotelPhone] = useState('');
  const [hotelEmail, setHotelEmail] = useState('');

  // Operational Settings
  const [checkInTime, setCheckInTime] = useState('15:00');
  const [checkOutTime, setCheckOutTime] = useState('11:00');
  const [currency, setCurrency] = useState('USD');
  const [timezone, setTimezone] = useState('America/New_York');

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      setLoading(true);
      setError('');

      // TODO: Add API endpoint to fetch system settings
      // For now, using placeholder values
      const settings = {
        hotel_name: 'Grand Hotel',
        hotel_address: '123 Main Street, City',
        hotel_phone: '+1-555-0123',
        hotel_email: 'info@grandhotel.com',
        check_in_time: '15:00',
        check_out_time: '11:00',
        currency: 'USD',
        timezone: 'America/New_York'
      };

      setHotelName(settings.hotel_name);
      setHotelAddress(settings.hotel_address);
      setHotelPhone(settings.hotel_phone);
      setHotelEmail(settings.hotel_email);
      setCheckInTime(settings.check_in_time);
      setCheckOutTime(settings.check_out_time);
      setCurrency(settings.currency);
      setTimezone(settings.timezone);
    } catch (err: any) {
      console.error('Failed to load settings:', err);
      setError('Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      // TODO: Add API call to save settings
      console.log('Saving settings:', {
        hotel_name: hotelName,
        hotel_address: hotelAddress,
        hotel_phone: hotelPhone,
        hotel_email: hotelEmail,
        check_in_time: checkInTime,
        check_out_time: checkOutTime,
        currency,
        timezone
      });

      // Simulate API delay
      await new Promise(resolve => setTimeout(resolve, 1000));
      setSuccess('Settings saved successfully');

      // Clear success message after 3 seconds
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="h4" component="h1" gutterBottom>
        Hotel Settings
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Configure your hotel's operational settings
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      {success && (
        <Alert severity="success" sx={{ mb: 3 }} onClose={() => setSuccess('')}>
          {success}
        </Alert>
      )}

      {/* Hotel Information */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
            <BusinessIcon sx={{ mr: 1, color: 'primary.main' }} />
            <Typography variant="h6">Hotel Information</Typography>
          </Box>
          <Divider sx={{ mb: 3 }} />

          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Hotel Name"
                value={hotelName}
                onChange={(e) => setHotelName(e.target.value)}
                helperText="The official name of your hotel"
                disabled={!isAdmin}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Contact Email"
                type="email"
                value={hotelEmail}
                onChange={(e) => setHotelEmail(e.target.value)}
                helperText="Main contact email address"
                disabled={!isAdmin}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Contact Phone"
                value={hotelPhone}
                onChange={(e) => setHotelPhone(e.target.value)}
                helperText="Main contact phone number"
                disabled={!isAdmin}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Address"
                value={hotelAddress}
                onChange={(e) => setHotelAddress(e.target.value)}
                helperText="Full hotel address"
                disabled={!isAdmin}
              />
            </Grid>
          </Grid>

          {!isAdmin && (
            <Alert severity="info" sx={{ mt: 2 }}>
              Only administrators can modify hotel information
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Check-in/Check-out Settings */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
            <ScheduleIcon sx={{ mr: 1, color: 'primary.main' }} />
            <Typography variant="h6">Check-in & Check-out Times</Typography>
          </Box>
          <Divider sx={{ mb: 3 }} />

          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Check-in Time"
                type="time"
                value={checkInTime}
                onChange={(e) => setCheckInTime(e.target.value)}
                helperText="Standard time when guests can check in"
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Check-out Time"
                type="time"
                value={checkOutTime}
                onChange={(e) => setCheckOutTime(e.target.value)}
                helperText="Standard time when guests must check out"
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
          </Grid>

          <Alert severity="info" sx={{ mt: 2 }}>
            These times are used to automatically detect late checkouts and manage room availability
          </Alert>
        </CardContent>
      </Card>

      {/* Operational Settings */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
            <MoneyIcon sx={{ mr: 1, color: 'primary.main' }} />
            <Typography variant="h6">Operational Settings</Typography>
          </Box>
          <Divider sx={{ mb: 3 }} />

          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                helperText="Default currency code (e.g., USD, EUR, GBP)"
                disabled={!isAdmin}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Timezone"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                helperText="Hotel timezone (e.g., America/New_York)"
                disabled={!isAdmin}
              />
            </Grid>
          </Grid>

          {!isAdmin && (
            <Alert severity="info" sx={{ mt: 2 }}>
              Only administrators can modify operational settings
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Save Button */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
        <Button
          variant="outlined"
          onClick={loadSettings}
          disabled={saving}
        >
          Reset Changes
        </Button>
        <Button
          variant="contained"
          onClick={saveSettings}
          disabled={saving}
          startIcon={saving ? <CircularProgress size={20} /> : <SaveIcon />}
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </Button>
      </Box>
    </Box>
  );
};

export default SettingsPage;

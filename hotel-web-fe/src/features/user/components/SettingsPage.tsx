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
  CircularProgress,
  Chip,
  Stack,
  IconButton
} from '@mui/material';
import {
  Business as BusinessIcon,
  Schedule as ScheduleIcon,
  AttachMoney as MoneyIcon,
  Save as SaveIcon,
  Settings as SettingsIcon,
  Add as AddIcon,
  Close as CloseIcon
} from '@mui/icons-material';
import { useAuth } from '../../../auth/AuthContext';
import { setCurrentCurrency, SUPPORTED_CURRENCIES } from '../../../utils/currency';
import { useCurrency } from '../../../hooks/useCurrency';
import { getHotelSettings, saveHotelSettings, HotelSettings } from '../../../utils/hotelSettings';

// Common timezones for hotels
const TIMEZONES = [
  { value: 'Asia/Kuala_Lumpur', label: 'Malaysia (Kuala Lumpur) - GMT+8', region: 'Asia' },
  { value: 'Asia/Singapore', label: 'Singapore - GMT+8', region: 'Asia' },
  { value: 'Asia/Bangkok', label: 'Thailand (Bangkok) - GMT+7', region: 'Asia' },
  { value: 'Asia/Jakarta', label: 'Indonesia (Jakarta) - GMT+7', region: 'Asia' },
  { value: 'Asia/Manila', label: 'Philippines (Manila) - GMT+8', region: 'Asia' },
  { value: 'Asia/Hong_Kong', label: 'Hong Kong - GMT+8', region: 'Asia' },
  { value: 'Asia/Tokyo', label: 'Japan (Tokyo) - GMT+9', region: 'Asia' },
  { value: 'Asia/Shanghai', label: 'China (Shanghai) - GMT+8', region: 'Asia' },
  { value: 'Asia/Dubai', label: 'UAE (Dubai) - GMT+4', region: 'Asia' },
  { value: 'Australia/Sydney', label: 'Australia (Sydney) - GMT+10/+11', region: 'Pacific' },
  { value: 'Europe/London', label: 'United Kingdom (London) - GMT+0/+1', region: 'Europe' },
  { value: 'Europe/Paris', label: 'France (Paris) - GMT+1/+2', region: 'Europe' },
  { value: 'America/New_York', label: 'USA (New York) - GMT-5/-4', region: 'Americas' },
  { value: 'America/Los_Angeles', label: 'USA (Los Angeles) - GMT-8/-7', region: 'Americas' },
  { value: 'America/Chicago', label: 'USA (Chicago) - GMT-6/-5', region: 'Americas' },
];

const SettingsPage: React.FC = () => {
  const { hasRole } = useAuth();
  const isAdmin = hasRole('admin');
  const { symbol: currencySymbol } = useCurrency();

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
  const [currency, setCurrency] = useState('MYR');
  const [timezone, setTimezone] = useState('Asia/Kuala_Lumpur');

  // Charges Settings
  const [roomCardDeposit, setRoomCardDeposit] = useState(50);
  const [serviceTaxRate, setServiceTaxRate] = useState(8);
  const [tourismTaxRate, setTourismTaxRate] = useState(10);

  // System Configuration
  const [bookingChannels, setBookingChannels] = useState<string[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<string[]>([]);
  const [newChannel, setNewChannel] = useState('');
  const [newPaymentMethod, setNewPaymentMethod] = useState('');

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      setLoading(true);
      setError('');

      // Load settings from localStorage
      const settings = getHotelSettings();

      setHotelName(settings.hotel_name);
      setHotelAddress(settings.hotel_address);
      setHotelPhone(settings.hotel_phone);
      setHotelEmail(settings.hotel_email);
      setCheckInTime(settings.check_in_time);
      setCheckOutTime(settings.check_out_time);
      setCurrency(settings.currency);
      setTimezone(settings.timezone);
      setRoomCardDeposit(settings.room_card_deposit);
      setServiceTaxRate(settings.service_tax_rate);
      setTourismTaxRate(settings.tourism_tax_rate);
      setBookingChannels(settings.booking_channels);
      setPaymentMethods(settings.payment_methods);
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
      // Prepare settings object
      const settings: HotelSettings = {
        hotel_name: hotelName,
        hotel_address: hotelAddress,
        hotel_phone: hotelPhone,
        hotel_email: hotelEmail,
        check_in_time: checkInTime,
        check_out_time: checkOutTime,
        currency,
        timezone,
        room_card_deposit: roomCardDeposit,
        late_checkout_penalty: 0, // Deprecated - penalty is now entered manually at checkout
        service_tax_rate: serviceTaxRate,
        tourism_tax_rate: tourismTaxRate,
        booking_channels: bookingChannels,
        payment_methods: paymentMethods
      };

      // Save all settings to localStorage
      saveHotelSettings(settings);

      // Save currency to localStorage and trigger update
      setCurrentCurrency(currency);
      window.dispatchEvent(new CustomEvent('currencyChange', { detail: currency }));

      // Trigger hotel settings update event
      window.dispatchEvent(new CustomEvent('hotelSettingsChange', { detail: settings }));

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
                select
                fullWidth
                label="Default Currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                helperText="All prices and charges will be displayed in this currency"
                disabled={!isAdmin}
                SelectProps={{ native: true }}
              >
                <optgroup label="Recommended">
                  <option value="MYR">RM - Malaysian Ringgit (MYR)</option>
                  <option value="USD">$ - US Dollar (USD)</option>
                </optgroup>
                <optgroup label="Other Currencies">
                  {Object.entries(SUPPORTED_CURRENCIES)
                    .filter(([code]) => code !== 'MYR' && code !== 'USD')
                    .map(([code, info]) => (
                      <option key={code} value={code}>
                        {info.symbol} - {info.name} ({code})
                      </option>
                    ))}
                </optgroup>
              </TextField>
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                select
                fullWidth
                label="Timezone"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                helperText="Select your hotel's timezone for accurate time tracking"
                disabled={!isAdmin}
                SelectProps={{ native: true }}
              >
                <optgroup label="Asia & Pacific">
                  {TIMEZONES.filter(tz => tz.region === 'Asia' || tz.region === 'Pacific').map(tz => (
                    <option key={tz.value} value={tz.value}>
                      {tz.label}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Europe">
                  {TIMEZONES.filter(tz => tz.region === 'Europe').map(tz => (
                    <option key={tz.value} value={tz.value}>
                      {tz.label}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Americas">
                  {TIMEZONES.filter(tz => tz.region === 'Americas').map(tz => (
                    <option key={tz.value} value={tz.value}>
                      {tz.label}
                    </option>
                  ))}
                </optgroup>
              </TextField>
            </Grid>
          </Grid>

          <Alert severity="info" sx={{ mt: 2 }}>
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
              Currency & Timezone Settings
            </Typography>
            <Typography variant="caption">
              • Changing the currency will update all price displays throughout the system (bookings, invoices, reports)
              <br />
              • Timezone is used for check-in/check-out times and late checkout penalty calculations
              <br />
              • Malaysia uses Asia/Kuala_Lumpur timezone (GMT+8) and Malaysian Ringgit (MYR)
            </Typography>
          </Alert>

          {!isAdmin && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              Only administrators can modify operational settings
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Charges & Deposits */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
            <MoneyIcon sx={{ mr: 1, color: 'primary.main' }} />
            <Typography variant="h6">Charges & Deposits</Typography>
          </Box>
          <Divider sx={{ mb: 3 }} />

          <Grid container spacing={3}>
            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                label="Room Card Deposit"
                type="number"
                value={roomCardDeposit}
                onChange={(e) => setRoomCardDeposit(parseFloat(e.target.value) || 0)}
                helperText="Default refundable deposit for room card"
                InputProps={{
                  startAdornment: <Typography sx={{ mr: 0.5 }}>{currencySymbol}</Typography>
                }}
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                label="Service Tax Rate"
                type="number"
                value={serviceTaxRate}
                onChange={(e) => setServiceTaxRate(parseFloat(e.target.value) || 0)}
                helperText="Tax percentage applied to all bookings"
                InputProps={{
                  endAdornment: <Typography sx={{ ml: 0.5 }}>%</Typography>
                }}
                inputProps={{
                  min: 0,
                  max: 100,
                  step: 0.1
                }}
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                label="Tourism Tax Rate"
                type="number"
                value={tourismTaxRate}
                onChange={(e) => setTourismTaxRate(parseFloat(e.target.value) || 0)}
                helperText="Per night charge for tourist guests"
                InputProps={{
                  startAdornment: <Typography sx={{ mr: 0.5 }}>{currencySymbol}</Typography>
                }}
                inputProps={{
                  min: 0,
                  step: 1
                }}
              />
            </Grid>
          </Grid>

          <Alert severity="info" sx={{ mt: 2 }}>
            These amounts will be used as defaults in the quick booking form. Tourism tax is charged per night for guests marked as tourists.
          </Alert>
        </CardContent>
      </Card>

      {/* System Configuration */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
            <SettingsIcon sx={{ mr: 1, color: 'primary.main' }} />
            <Typography variant="h6">System Configuration</Typography>
          </Box>
          <Divider sx={{ mb: 3 }} />

          <Grid container spacing={3}>
            {/* Booking Channels */}
            <Grid item xs={12}>
              <Typography variant="subtitle1" gutterBottom fontWeight="medium">
                Online Booking Channels
              </Typography>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Configure available booking channels for online check-in
              </Typography>

              <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mt: 2, mb: 2 }}>
                {bookingChannels.map((channel, index) => (
                  <Chip
                    key={index}
                    label={channel}
                    onDelete={() => {
                      setBookingChannels(bookingChannels.filter((_, i) => i !== index));
                    }}
                    sx={{ mb: 1 }}
                  />
                ))}
              </Stack>

              <Box sx={{ display: 'flex', gap: 1 }}>
                <TextField
                  size="small"
                  placeholder="Add new booking channel (e.g., Airbnb)"
                  value={newChannel}
                  onChange={(e) => setNewChannel(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter' && newChannel.trim()) {
                      setBookingChannels([...bookingChannels, newChannel.trim()]);
                      setNewChannel('');
                    }
                  }}
                  sx={{ flex: 1 }}
                />
                <Button
                  variant="outlined"
                  startIcon={<AddIcon />}
                  onClick={() => {
                    if (newChannel.trim()) {
                      setBookingChannels([...bookingChannels, newChannel.trim()]);
                      setNewChannel('');
                    }
                  }}
                  disabled={!newChannel.trim()}
                >
                  Add
                </Button>
              </Box>
            </Grid>

            {/* Payment Methods */}
            <Grid item xs={12}>
              <Typography variant="subtitle1" gutterBottom fontWeight="medium">
                Payment Methods
              </Typography>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Configure available payment methods for walk-in guests
              </Typography>

              <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mt: 2, mb: 2 }}>
                {paymentMethods.map((method, index) => (
                  <Chip
                    key={index}
                    label={method}
                    onDelete={() => {
                      setPaymentMethods(paymentMethods.filter((_, i) => i !== index));
                    }}
                    sx={{ mb: 1 }}
                  />
                ))}
              </Stack>

              <Box sx={{ display: 'flex', gap: 1 }}>
                <TextField
                  size="small"
                  placeholder="Add new payment method (e.g., E-Wallet)"
                  value={newPaymentMethod}
                  onChange={(e) => setNewPaymentMethod(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter' && newPaymentMethod.trim()) {
                      setPaymentMethods([...paymentMethods, newPaymentMethod.trim()]);
                      setNewPaymentMethod('');
                    }
                  }}
                  sx={{ flex: 1 }}
                />
                <Button
                  variant="outlined"
                  startIcon={<AddIcon />}
                  onClick={() => {
                    if (newPaymentMethod.trim()) {
                      setPaymentMethods([...paymentMethods, newPaymentMethod.trim()]);
                      setNewPaymentMethod('');
                    }
                  }}
                  disabled={!newPaymentMethod.trim()}
                >
                  Add
                </Button>
              </Box>
            </Grid>
          </Grid>

          <Alert severity="info" sx={{ mt: 2 }}>
            These options will appear in the booking channels dropdown (online check-in) and payment methods dropdown (walk-in guests).
          </Alert>
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

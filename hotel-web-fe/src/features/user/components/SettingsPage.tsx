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
  Switch,
  FormControlLabel,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip
} from '@mui/material';
import {
  Business as BusinessIcon,
  Schedule as ScheduleIcon,
  AttachMoney as MoneyIcon,
  Save as SaveIcon,
  Security as SecurityIcon,
  Settings as SettingsIcon,
  Add as AddIcon,
  Assessment as ReportIcon,
  Palette as PaletteIcon,
  LightMode as LightModeIcon,
  DarkMode as DarkModeIcon,
  NightsStay as NightsStayIcon,
  SupportAgent as SupportIcon
} from '@mui/icons-material';
import { useAuth } from '../../../auth/AuthContext';
import { useThemeMode } from '../../../router/ThemeModeContext';
import type { ThemeMode } from '../../../theme';
import { setCurrentCurrency, SUPPORTED_CURRENCIES } from '../../../utils/currency';
import { useCurrency } from '../../../hooks/useCurrency';
import {
  HotelSettings,
  BookingChannel,
  REPORT_DISPLAY_FONT_SIZE_MAX,
  REPORT_DISPLAY_FONT_SIZE_MIN,
  REPORT_FONT_FAMILY_OPTIONS,
  REPORT_FONT_SIZE_MAX,
  REPORT_FONT_SIZE_MIN,
  normalizeReportFontFamily,
  normalizeReportFontSize
} from '../../../utils/hotelSettings';
import { useHotelSettingsQuery, useSaveHotelSettingsMutation } from '../hooks/useSettingsQueries';
import {
  REPORT_TYPOGRAPHY_PRESETS,
  getReportTypographyPreset,
  type ReportTypographyPresetKey,
} from '../../reports/utils/reportTypography';

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

type SupportPriority = 'low' | 'normal' | 'high' | 'urgent';

const SUPPORT_PRIORITY_LABELS: Record<SupportPriority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
};

const SUPPORT_PRIORITIES = Object.keys(SUPPORT_PRIORITY_LABELS) as SupportPriority[];

const SUPPORT_CATEGORY_LABELS: Record<string, string> = {
  booking: 'Booking or check-in',
  stay: 'Stay or room',
  billing: 'Billing or payment',
  loyalty: 'Membership or rewards',
  technical: 'Portal or technical issue',
  other: 'Something else',
};

const SettingsPage: React.FC = () => {
  const { hasPermission } = useAuth();
  const { themeMode, onThemeModeChange } = useThemeMode();
  const isAdmin = hasPermission('settings:update') || hasPermission('settings:manage');
  const { symbol: currencySymbol } = useCurrency();
  const settingsQuery = useHotelSettingsQuery();
  const saveSettingsMutation = useSaveHotelSettingsMutation();
  const loading = settingsQuery.isPending;
  const saving = saveSettingsMutation.isPending;
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
  const [nightShiftTime, setNightShiftTime] = useState('23:00');
  const [nightAuditAutoEnabled, setNightAuditAutoEnabled] = useState(false);
  const [currency, setCurrency] = useState('MYR');
  const [timezone, setTimezone] = useState('Asia/Kuala_Lumpur');

  // Charges Settings
  const [depositAmount, setDepositAmount] = useState(50);
  const [serviceTaxRate, setServiceTaxRate] = useState(8);
  const [tourismTaxRate, setTourismTaxRate] = useState(10);
  const [defaultPaymentTermsDays, setDefaultPaymentTermsDays] = useState(30);

  // Report Settings
  const [reportFontSize, setReportFontSize] = useState(14);
  const [reportFontFamily, setReportFontFamily] = useState<string>(REPORT_FONT_FAMILY_OPTIONS[0].value);
  const [reportHeadingFontSize, setReportHeadingFontSize] = useState(24);
  const [reportSectionHeadingFontSize, setReportSectionHeadingFontSize] = useState(18);
  const [reportTableFontSize, setReportTableFontSize] = useState(14);
  const [reportCaptionFontSize, setReportCaptionFontSize] = useState(13);
  const [reportChipFontSize, setReportChipFontSize] = useState(12);

  // Security Settings
  const [maxLoginAttempts, setMaxLoginAttempts] = useState(5);
  const [totpIssuerName, setTotpIssuerName] = useState('Hotel Management System');
  const [passkeyRelyingPartyName, setPasskeyRelyingPartyName] = useState('Hotel Management System');

  // Guest support workflow settings
  const [supportEnabled, setSupportEnabled] = useState(true);
  const [supportCategories, setSupportCategories] = useState<string[]>([
    'booking', 'stay', 'billing', 'loyalty', 'technical', 'other',
  ]);
  const [supportFirstResponseMinutes, setSupportFirstResponseMinutes] = useState<Record<SupportPriority, number>>({
    low: 240,
    normal: 60,
    high: 15,
    urgent: 5,
  });
  const [supportResolutionMinutes, setSupportResolutionMinutes] = useState<Record<SupportPriority, number>>({
    low: 1440,
    normal: 480,
    high: 120,
    urgent: 30,
  });
  const [supportReopenWindowDays, setSupportReopenWindowDays] = useState(7);

  // System Configuration
  const [rateCodes, setRateCodes] = useState<string[]>([]);
  const [marketCodes, setMarketCodes] = useState<string[]>([]);
  const [bookingChannels, setBookingChannels] = useState<BookingChannel[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<string[]>([]);
  const [newRateCode, setNewRateCode] = useState('');
  const [newMarketCode, setNewMarketCode] = useState('');
  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelAbbreviation, setNewChannelAbbreviation] = useState('');
  const [newPaymentMethod, setNewPaymentMethod] = useState('');

  const addCode = (
    rawCode: string,
    values: string[],
    setValues: React.Dispatch<React.SetStateAction<string[]>>,
    reset: () => void
  ) => {
    const code = rawCode.trim().toUpperCase();
    if (!code || values.includes(code)) return;
    setValues([...values, code]);
    reset();
  };

  const addBookingChannel = () => {
    const name = newChannelName.trim();
    const abbreviation = newChannelAbbreviation.trim();
    if (!name) return;
    setBookingChannels([...bookingChannels, { name, abbreviation }]);
    setNewChannelName('');
    setNewChannelAbbreviation('');
  };

  const applySettingsToForm = (settings: HotelSettings) => {
    setHotelName(settings.hotel_name);
    setHotelAddress(settings.hotel_address);
    setHotelPhone(settings.hotel_phone);
    setHotelEmail(settings.hotel_email);
    setCheckInTime(settings.check_in_time);
    setCheckOutTime(settings.check_out_time);
    setNightShiftTime(settings.night_shift_time || '23:00');
    setNightAuditAutoEnabled(Boolean(settings.night_audit_auto_enabled));
    setCurrency(settings.currency);
    setTimezone(settings.timezone);
    setDepositAmount(settings.deposit_amount);
    setServiceTaxRate(settings.service_tax_rate);
    setTourismTaxRate(settings.tourism_tax_rate);
    setDefaultPaymentTermsDays(settings.default_payment_terms_days);
    setReportFontSize(settings.report_font_size);
    setReportFontFamily(settings.report_font_family);
    setReportHeadingFontSize(settings.report_heading_font_size);
    setReportSectionHeadingFontSize(settings.report_section_heading_font_size);
    setReportTableFontSize(settings.report_table_font_size);
    setReportCaptionFontSize(settings.report_caption_font_size);
    setReportChipFontSize(settings.report_chip_font_size);
    setMaxLoginAttempts(settings.max_login_attempts);
    setTotpIssuerName(settings.totp_issuer_name);
    setPasskeyRelyingPartyName(settings.passkey_relying_party_name);
    setSupportEnabled(settings.support_enabled);
    setSupportCategories(settings.support_categories);
    setSupportFirstResponseMinutes({
      low: settings.support_first_response_low_minutes,
      normal: settings.support_first_response_normal_minutes,
      high: settings.support_first_response_high_minutes,
      urgent: settings.support_first_response_urgent_minutes,
    });
    setSupportResolutionMinutes({
      low: settings.support_resolution_low_minutes,
      normal: settings.support_resolution_normal_minutes,
      high: settings.support_resolution_high_minutes,
      urgent: settings.support_resolution_urgent_minutes,
    });
    setSupportReopenWindowDays(settings.support_reopen_window_days);
    setRateCodes(settings.rate_codes);
    setMarketCodes(settings.market_codes);
    setBookingChannels(settings.booking_channels);
    setPaymentMethods(settings.payment_methods);
  };

  useEffect(() => {
    if (settingsQuery.data) {
      applySettingsToForm(settingsQuery.data);
    }
  }, [settingsQuery.data]);

  const loadSettings = async () => {
    setError('');
    const result = await settingsQuery.refetch();
    if (result.data) {
      applySettingsToForm(result.data);
    }
  };

  const saveSettings = async () => {
    setError('');
    setSuccess('');

    try {
      const normalizedReportBodyFontSize = normalizeReportFontSize(reportFontSize);

      // Prepare settings object
      const settings: HotelSettings = {
        hotel_name: hotelName,
        hotel_address: hotelAddress,
        hotel_phone: hotelPhone,
        hotel_email: hotelEmail,
        check_in_time: checkInTime,
        check_out_time: checkOutTime,
        night_shift_time: nightShiftTime,
        night_audit_auto_enabled: nightAuditAutoEnabled,
        currency,
        timezone,
        deposit_amount: depositAmount,
        service_tax_rate: serviceTaxRate,
        tourism_tax_rate: tourismTaxRate,
        default_payment_terms_days: defaultPaymentTermsDays,
        report_font_size: normalizedReportBodyFontSize,
        report_font_family: normalizeReportFontFamily(reportFontFamily),
        report_heading_font_size: normalizeReportFontSize(
          reportHeadingFontSize,
          Math.max(normalizedReportBodyFontSize + 10, 20),
          { min: REPORT_DISPLAY_FONT_SIZE_MIN, max: REPORT_DISPLAY_FONT_SIZE_MAX }
        ),
        report_section_heading_font_size: normalizeReportFontSize(
          reportSectionHeadingFontSize,
          Math.max(normalizedReportBodyFontSize + 4, 14),
          { min: REPORT_FONT_SIZE_MIN, max: REPORT_DISPLAY_FONT_SIZE_MAX }
        ),
        report_table_font_size: normalizeReportFontSize(reportTableFontSize, normalizedReportBodyFontSize),
        report_caption_font_size: normalizeReportFontSize(
          reportCaptionFontSize,
          Math.max(normalizedReportBodyFontSize - 1, REPORT_FONT_SIZE_MIN)
        ),
        report_chip_font_size: normalizeReportFontSize(
          reportChipFontSize,
          Math.max(normalizedReportBodyFontSize - 2, REPORT_FONT_SIZE_MIN)
        ),
        max_login_attempts: maxLoginAttempts,
        totp_issuer_name: totpIssuerName,
        passkey_relying_party_name: passkeyRelyingPartyName,
        support_enabled: supportEnabled,
        support_categories: supportCategories,
        support_first_response_low_minutes: supportFirstResponseMinutes.low,
        support_first_response_normal_minutes: supportFirstResponseMinutes.normal,
        support_first_response_high_minutes: supportFirstResponseMinutes.high,
        support_first_response_urgent_minutes: supportFirstResponseMinutes.urgent,
        support_resolution_low_minutes: supportResolutionMinutes.low,
        support_resolution_normal_minutes: supportResolutionMinutes.normal,
        support_resolution_high_minutes: supportResolutionMinutes.high,
        support_resolution_urgent_minutes: supportResolutionMinutes.urgent,
        support_reopen_window_days: supportReopenWindowDays,
        rate_codes: rateCodes,
        market_codes: marketCodes,
        booking_channels: bookingChannels,
        payment_methods: paymentMethods
      };

      const result = await saveSettingsMutation.mutateAsync(settings);
      const savedSettings = result.settings;

      // Save currency to localStorage and trigger update
      setCurrentCurrency(savedSettings.currency);
      window.dispatchEvent(new CustomEvent('currencyChange', { detail: savedSettings.currency }));

      // Trigger hotel settings update event
      window.dispatchEvent(new CustomEvent('hotelSettingsChange', { detail: savedSettings }));

      setSuccess('Settings saved successfully');

      // Clear success message after 3 seconds
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to save settings');
    }
  };

  const selectedReportPreset = REPORT_TYPOGRAPHY_PRESETS.find(preset => (
    preset.sizes.report_font_size === reportFontSize &&
    preset.sizes.report_heading_font_size === reportHeadingFontSize &&
    preset.sizes.report_section_heading_font_size === reportSectionHeadingFontSize &&
    preset.sizes.report_table_font_size === reportTableFontSize &&
    preset.sizes.report_caption_font_size === reportCaptionFontSize &&
    preset.sizes.report_chip_font_size === reportChipFontSize
  ));
  const reportPresetValue = selectedReportPreset?.key ?? 'custom';
  const reportPresetHelperText = selectedReportPreset?.description ?? 'Custom report font sizes are active';

  const applyReportTypographyPreset = (value: string) => {
    if (value === 'custom') return;
    const preset = getReportTypographyPreset(value as ReportTypographyPresetKey);
    setReportFontSize(preset.sizes.report_font_size);
    setReportHeadingFontSize(preset.sizes.report_heading_font_size);
    setReportSectionHeadingFontSize(preset.sizes.report_section_heading_font_size);
    setReportTableFontSize(preset.sizes.report_table_font_size);
    setReportCaptionFontSize(preset.sizes.report_caption_font_size);
    setReportChipFontSize(preset.sizes.report_chip_font_size);
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
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                label="Hotel Name"
                value={hotelName}
                onChange={(e) => setHotelName(e.target.value)}
                helperText="The official name of your hotel"
                disabled={!isAdmin}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
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
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                label="Contact Phone"
                value={hotelPhone}
                onChange={(e) => setHotelPhone(e.target.value)}
                helperText="Main contact phone number"
                disabled={!isAdmin}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
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
            <Grid size={{ xs: 12, md: 6 }}>
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
            <Grid size={{ xs: 12, md: 6 }}>
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
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                label="Night Shift / Night Audit Time"
                type="time"
                value={nightShiftTime}
                onChange={(e) => setNightShiftTime(e.target.value)}
                helperText="Time when daily data is posted for reporting (e.g., 11:00 PM)"
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <FormControlLabel
                sx={{ mt: 1 }}
                control={
                  <Switch
                    checked={nightAuditAutoEnabled}
                    onChange={(e) => setNightAuditAutoEnabled(e.target.checked)}
                  />
                }
                label="Run night audit automatically"
              />
              <Typography variant="caption" color="text.secondary" display="block">
                When on, the system posts the night audit at the time above (and catches up any
                missed days). When off, run it manually from the Night Audit page.
              </Typography>
            </Grid>
          </Grid>

          <Alert severity="info" sx={{ mt: 2 }}>
            Night shift time determines when daily booking and room data is finalized for reports.
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
            <Grid size={{ xs: 12, md: 6 }}>
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
            <Grid size={{ xs: 12, md: 6 }}>
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
            <Grid size={{ xs: 12, md: 3 }}>
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
            <Grid size={{ xs: 12, md: 3 }}>
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
            <Grid size={{ xs: 12, md: 3 }}>
              <TextField
                fullWidth
                label="Default Deposit Amount"
                type="number"
                value={depositAmount}
                onChange={(e) => setDepositAmount(parseFloat(e.target.value) || 0)}
                helperText="Default deposit amount collected at check-in"
                InputProps={{
                  startAdornment: <Typography sx={{ mr: 0.5 }}>{currencySymbol}</Typography>
                }}
                inputProps={{
                  min: 0,
                  step: 1
                }}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 3 }}>
              <TextField
                fullWidth
                label="Payment Terms"
                type="number"
                value={defaultPaymentTermsDays}
                onChange={(e) => setDefaultPaymentTermsDays(parseInt(e.target.value, 10) || 1)}
                helperText="Default invoice due-date offset"
                InputProps={{
                  endAdornment: <Typography sx={{ ml: 0.5 }}>days</Typography>
                }}
                inputProps={{
                  min: 1,
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

      {/* Report Settings */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
            <ReportIcon sx={{ mr: 1, color: 'primary.main' }} />
            <Typography variant="h6">Report Settings</Typography>
          </Box>
          <Divider sx={{ mb: 3 }} />

          <Grid container spacing={3}>
            <Grid size={{ xs: 12, md: 4 }}>
              <TextField
                select
                fullWidth
                label="Report Font Preset"
                value={reportPresetValue}
                onChange={(e) => applyReportTypographyPreset(e.target.value)}
                helperText={reportPresetHelperText}
                disabled={!isAdmin}
                SelectProps={{ native: true }}
              >
                <option value="custom">Custom</option>
                {REPORT_TYPOGRAPHY_PRESETS.map(preset => (
                  <option key={preset.key} value={preset.key}>{preset.label}</option>
                ))}
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <TextField
                select
                fullWidth
                label="Report Font Family"
                value={reportFontFamily}
                onChange={(e) => setReportFontFamily(e.target.value)}
                helperText="Font used by generated report previews and print output"
                disabled={!isAdmin}
                SelectProps={{ native: true }}
              >
                {REPORT_FONT_FAMILY_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 4 }}>
              <TextField
                fullWidth
                label="Report Body Font Size"
                type="number"
                value={reportFontSize}
                onChange={(e) => setReportFontSize(parseInt(e.target.value, 10) || REPORT_FONT_SIZE_MIN)}
                helperText="Main report text size"
                disabled={!isAdmin}
                InputProps={{
                  endAdornment: <Typography sx={{ ml: 0.5 }}>px</Typography>
                }}
                inputProps={{
                  min: REPORT_FONT_SIZE_MIN,
                  max: REPORT_FONT_SIZE_MAX,
                  step: 1
                }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 4 }}>
              <TextField
                fullWidth
                label="Heading / KPI Font Size"
                type="number"
                value={reportHeadingFontSize}
                onChange={(e) => setReportHeadingFontSize(parseInt(e.target.value, 10) || REPORT_DISPLAY_FONT_SIZE_MIN)}
                helperText="Large report titles and metric values"
                disabled={!isAdmin}
                InputProps={{
                  endAdornment: <Typography sx={{ ml: 0.5 }}>px</Typography>
                }}
                inputProps={{
                  min: REPORT_DISPLAY_FONT_SIZE_MIN,
                  max: REPORT_DISPLAY_FONT_SIZE_MAX,
                  step: 1
                }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 4 }}>
              <TextField
                fullWidth
                label="Section Heading Font Size"
                type="number"
                value={reportSectionHeadingFontSize}
                onChange={(e) => setReportSectionHeadingFontSize(parseInt(e.target.value, 10) || REPORT_FONT_SIZE_MIN)}
                helperText="Report section labels and subheads"
                disabled={!isAdmin}
                InputProps={{
                  endAdornment: <Typography sx={{ ml: 0.5 }}>px</Typography>
                }}
                inputProps={{
                  min: REPORT_FONT_SIZE_MIN,
                  max: REPORT_DISPLAY_FONT_SIZE_MAX,
                  step: 1
                }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 4 }}>
              <TextField
                fullWidth
                label="Table Font Size"
                type="number"
                value={reportTableFontSize}
                onChange={(e) => setReportTableFontSize(parseInt(e.target.value, 10) || REPORT_FONT_SIZE_MIN)}
                helperText="Rows, totals, and table headers"
                disabled={!isAdmin}
                InputProps={{
                  endAdornment: <Typography sx={{ ml: 0.5 }}>px</Typography>
                }}
                inputProps={{
                  min: REPORT_FONT_SIZE_MIN,
                  max: REPORT_FONT_SIZE_MAX,
                  step: 1
                }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 4 }}>
              <TextField
                fullWidth
                label="Caption Font Size"
                type="number"
                value={reportCaptionFontSize}
                onChange={(e) => setReportCaptionFontSize(parseInt(e.target.value, 10) || REPORT_FONT_SIZE_MIN)}
                helperText="Secondary labels and captions"
                disabled={!isAdmin}
                InputProps={{
                  endAdornment: <Typography sx={{ ml: 0.5 }}>px</Typography>
                }}
                inputProps={{
                  min: REPORT_FONT_SIZE_MIN,
                  max: REPORT_FONT_SIZE_MAX,
                  step: 1
                }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 4 }}>
              <TextField
                fullWidth
                label="Status Chip Font Size"
                type="number"
                value={reportChipFontSize}
                onChange={(e) => setReportChipFontSize(parseInt(e.target.value, 10) || REPORT_FONT_SIZE_MIN)}
                helperText="Payment and posting status chips"
                disabled={!isAdmin}
                InputProps={{
                  endAdornment: <Typography sx={{ ml: 0.5 }}>px</Typography>
                }}
                inputProps={{
                  min: REPORT_FONT_SIZE_MIN,
                  max: REPORT_FONT_SIZE_MAX,
                  step: 1
                }}
              />
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Guest Support Workflow */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
            <SupportIcon sx={{ mr: 1, color: 'primary.main' }} />
            <Typography variant="h6">Guest Support Workflow</Typography>
          </Box>
          <Divider sx={{ mb: 2 }} />

          <FormControlLabel
            control={(
              <Switch
                checked={supportEnabled}
                onChange={(event) => setSupportEnabled(event.target.checked)}
                disabled={!isAdmin}
              />
            )}
            label="Allow guests to start support conversations in the portal"
          />
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Existing conversations remain visible to staff when new guest requests are paused.
          </Typography>

          <Typography variant="subtitle1" fontWeight="medium" gutterBottom>
            Guest support topics
          </Typography>
          <Stack direction="row" flexWrap="wrap" useFlexGap sx={{ mb: 3, columnGap: 1, rowGap: 0 }}>
            {Object.entries(SUPPORT_CATEGORY_LABELS).map(([category, label]) => {
              const isEnabled = supportCategories.includes(category);
              return (
                <FormControlLabel
                  key={category}
                  label={label}
                  control={(
                    <Switch
                      size="small"
                      checked={isEnabled}
                      disabled={!isAdmin || (isEnabled && supportCategories.length === 1)}
                      onChange={(event) => setSupportCategories(current => (
                        event.target.checked
                          ? [...new Set([...current, category])]
                          : current.filter(value => value !== category)
                      ))}
                    />
                  )}
                />
              );
            })}
          </Stack>

          <Grid container spacing={3}>
            <Grid size={{ xs: 12, md: 6 }}>
              <Typography variant="subtitle1" fontWeight="medium" gutterBottom>
                First response target
              </Typography>
              <Grid container spacing={2}>
                {SUPPORT_PRIORITIES.map(priority => (
                  <Grid key={priority} size={{ xs: 6, sm: 3 }}>
                    <TextField
                      fullWidth
                      label={`${SUPPORT_PRIORITY_LABELS[priority]} (minutes)`}
                      type="number"
                      value={supportFirstResponseMinutes[priority]}
                      onChange={(event) => setSupportFirstResponseMinutes(current => ({
                        ...current,
                        [priority]: Math.max(1, Number.parseInt(event.target.value, 10) || 1),
                      }))}
                      disabled={!isAdmin}
                      inputProps={{ min: 1, step: 1 }}
                    />
                  </Grid>
                ))}
              </Grid>
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <Typography variant="subtitle1" fontWeight="medium" gutterBottom>
                Resolution target
              </Typography>
              <Grid container spacing={2}>
                {SUPPORT_PRIORITIES.map(priority => (
                  <Grid key={priority} size={{ xs: 6, sm: 3 }}>
                    <TextField
                      fullWidth
                      label={`${SUPPORT_PRIORITY_LABELS[priority]} (minutes)`}
                      type="number"
                      value={supportResolutionMinutes[priority]}
                      onChange={(event) => setSupportResolutionMinutes(current => ({
                        ...current,
                        [priority]: Math.max(1, Number.parseInt(event.target.value, 10) || 1),
                      }))}
                      disabled={!isAdmin}
                      inputProps={{ min: 1, step: 1 }}
                    />
                  </Grid>
                ))}
              </Grid>
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <TextField
                fullWidth
                label="Guest reopen window"
                type="number"
                value={supportReopenWindowDays}
                onChange={(event) => setSupportReopenWindowDays(
                  Math.max(1, Number.parseInt(event.target.value, 10) || 1)
                )}
                helperText="Days after resolution during which a guest can reopen a conversation"
                disabled={!isAdmin}
                inputProps={{ min: 1, step: 1 }}
              />
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Security & Identity */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
            <SecurityIcon sx={{ mr: 1, color: 'primary.main' }} />
            <Typography variant="h6">Security & Identity</Typography>
          </Box>
          <Divider sx={{ mb: 3 }} />

          <Grid container spacing={3}>
            <Grid size={{ xs: 12, md: 4 }}>
              <TextField
                fullWidth
                label="Max Login Attempts"
                type="number"
                value={maxLoginAttempts}
                onChange={(e) => setMaxLoginAttempts(parseInt(e.target.value, 10) || 1)}
                helperText="Failed attempts before account lockout"
                disabled={!isAdmin}
                inputProps={{
                  min: 1,
                  max: 20,
                  step: 1
                }}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <TextField
                fullWidth
                label="Authenticator Issuer"
                value={totpIssuerName}
                onChange={(e) => setTotpIssuerName(e.target.value)}
                helperText="Name shown in TOTP authenticator apps"
                disabled={!isAdmin}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <TextField
                fullWidth
                label="Passkey Display Name"
                value={passkeyRelyingPartyName}
                onChange={(e) => setPasskeyRelyingPartyName(e.target.value)}
                helperText="Name shown during passkey registration"
                disabled={!isAdmin}
              />
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Appearance */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
            <PaletteIcon sx={{ mr: 1, color: 'primary.main' }} />
            <Typography variant="h6">Appearance</Typography>
          </Box>
          <Divider sx={{ mb: 3 }} />

          <Typography variant="subtitle1" gutterBottom fontWeight="medium">
            Theme Mode
          </Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Choose how the interface looks on this device. This preference is saved locally and applies immediately.
          </Typography>

          <ToggleButtonGroup
            exclusive
            value={themeMode}
            onChange={(_, value: ThemeMode | null) => {
              if (value === 'light' || value === 'dark' || value === 'night') onThemeModeChange(value);
            }}
            sx={{ mt: 2 }}
          >
            <ToggleButton value="light" aria-label="Light mode">
              <Tooltip title="Light mode"><LightModeIcon fontSize="small" /></Tooltip>
              <Box component="span" sx={{ ml: 1 }}>Light</Box>
            </ToggleButton>
            <ToggleButton value="dark" aria-label="Dark mode">
              <Tooltip title="Dark mode"><DarkModeIcon fontSize="small" /></Tooltip>
              <Box component="span" sx={{ ml: 1 }}>Dark</Box>
            </ToggleButton>
            <ToggleButton value="night" aria-label="Night mode">
              <Tooltip title="Night mode"><NightsStayIcon fontSize="small" /></Tooltip>
              <Box component="span" sx={{ ml: 1 }}>Night</Box>
            </ToggleButton>
          </ToggleButtonGroup>
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
            {/* Rate Codes */}
            <Grid size={{ xs: 12, md: 6 }}>
              <Typography variant="subtitle1" gutterBottom fontWeight="medium">
                Rate Codes
              </Typography>

              <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mt: 2, mb: 2 }}>
                {rateCodes.map((code, index) => (
                  <Chip
                    key={`${code}-${index}`}
                    label={code}
                    onDelete={isAdmin ? () => setRateCodes(rateCodes.filter((_, i) => i !== index)) : undefined}
                    sx={{ mb: 1 }}
                  />
                ))}
              </Stack>

              <Box sx={{ display: 'flex', gap: 1 }}>
                <TextField
                  size="small"
                  placeholder="Add rate code"
                  value={newRateCode}
                  onChange={(e) => setNewRateCode(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addCode(newRateCode, rateCodes, setRateCodes, () => setNewRateCode(''));
                    }
                  }}
                  disabled={!isAdmin}
                  sx={{ flex: 1 }}
                />
                <Button
                  variant="outlined"
                  startIcon={<AddIcon />}
                  onClick={() => addCode(newRateCode, rateCodes, setRateCodes, () => setNewRateCode(''))}
                  disabled={!isAdmin || !newRateCode.trim()}
                >
                  Add
                </Button>
              </Box>
            </Grid>

            {/* Market Codes */}
            <Grid size={{ xs: 12, md: 6 }}>
              <Typography variant="subtitle1" gutterBottom fontWeight="medium">
                Market Codes
              </Typography>

              <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mt: 2, mb: 2 }}>
                {marketCodes.map((code, index) => (
                  <Chip
                    key={`${code}-${index}`}
                    label={code}
                    onDelete={isAdmin ? () => setMarketCodes(marketCodes.filter((_, i) => i !== index)) : undefined}
                    sx={{ mb: 1 }}
                  />
                ))}
              </Stack>

              <Box sx={{ display: 'flex', gap: 1 }}>
                <TextField
                  size="small"
                  placeholder="Add market code"
                  value={newMarketCode}
                  onChange={(e) => setNewMarketCode(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addCode(newMarketCode, marketCodes, setMarketCodes, () => setNewMarketCode(''));
                    }
                  }}
                  disabled={!isAdmin}
                  sx={{ flex: 1 }}
                />
                <Button
                  variant="outlined"
                  startIcon={<AddIcon />}
                  onClick={() => addCode(newMarketCode, marketCodes, setMarketCodes, () => setNewMarketCode(''))}
                  disabled={!isAdmin || !newMarketCode.trim()}
                >
                  Add
                </Button>
              </Box>
            </Grid>

            {/* Booking Channels */}
            <Grid size={12}>
              <Typography variant="subtitle1" gutterBottom fontWeight="medium">
                Online Booking Channels
              </Typography>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Configure channel name + abbreviation pairs (e.g., Booking.com / B.C). Abbreviations appear next to guest names in the Room Sold Detail by Date report.
              </Typography>

              <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mt: 2, mb: 2 }}>
                {bookingChannels.map((channel, index) => (
                  <Chip
                    key={index}
                    label={channel.abbreviation ? `${channel.name} (${channel.abbreviation})` : channel.name}
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
                  placeholder="Channel name (e.g., Booking.com)"
                  value={newChannelName}
                  onChange={(e) => setNewChannelName(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addBookingChannel();
                    }
                  }}
                  sx={{ flex: 2 }}
                />
                <TextField
                  size="small"
                  placeholder="Abbr. (e.g., B.C)"
                  value={newChannelAbbreviation}
                  onChange={(e) => setNewChannelAbbreviation(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addBookingChannel();
                    }
                  }}
                  sx={{ flex: 1 }}
                />
                <Button
                  variant="outlined"
                  startIcon={<AddIcon />}
                  onClick={addBookingChannel}
                  disabled={!newChannelName.trim()}
                >
                  Add
                </Button>
              </Box>
            </Grid>

            {/* Payment Methods */}
            <Grid size={12}>
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

import { errorMessage } from '../../../utils/errorMessage';
import React, { useState, useEffect, useRef, useCallback } from "react";
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
  Paper,
  Stack,
  Switch,
  FormControlLabel,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Tab,
  Tabs,
} from "@mui/material";
import {
  Business as BusinessIcon,
  Schedule as ScheduleIcon,
  AttachMoney as MoneyIcon,
  Save as SaveIcon,
  Security as SecurityIcon,
  Palette as PaletteIcon,
  LightMode as LightModeIcon,
  DarkMode as DarkModeIcon,
  SupportAgent as SupportIcon,
} from "@mui/icons-material";
import ReportSettingsCard from "./settings/ReportSettingsCard";
import SystemConfigurationCard from "./settings/SystemConfigurationCard";
import { useAuth } from "../../../auth/AuthContext";
import { useThemeMode } from "../../../router/ThemeModeContext";
import type { ThemeMode } from "../../../theme";
import {
  setCurrentCurrency,
  SUPPORTED_CURRENCIES,
} from "../../../utils/currency";
import { useCurrency } from "../../../hooks/useCurrency";
import {
  HotelSettings,
  BookingChannel,
  REPORT_DISPLAY_FONT_SIZE_MAX,
  REPORT_DISPLAY_FONT_SIZE_MIN,
  REPORT_FONT_FAMILY_OPTIONS,
  REPORT_FONT_SIZE_MAX,
  REPORT_FONT_SIZE_MIN,
  normalizeReportFontFamily,
  normalizeReportFontSize,
} from "../../../utils/hotelSettings";
import {
  useHotelSettingsQuery,
  useResetSystemSettingsMutation,
  useSaveHotelSettingsMutation,
} from "../hooks/useSettingsQueries";
import { useConfirm } from "../../../components/common/ConfirmProvider";
import { useTranslation } from "../../../i18n";
// Common timezones for hotels — display names live in admin:settings.tz.*
const TIMEZONES = [
  { value: "Asia/Kuala_Lumpur", region: "Asia" },
  { value: "Asia/Singapore", region: "Asia" },
  { value: "Asia/Bangkok", region: "Asia" },
  { value: "Asia/Jakarta", region: "Asia" },
  { value: "Asia/Manila", region: "Asia" },
  { value: "Asia/Hong_Kong", region: "Asia" },
  { value: "Asia/Tokyo", region: "Asia" },
  { value: "Asia/Shanghai", region: "Asia" },
  { value: "Asia/Dubai", region: "Asia" },
  { value: "Australia/Sydney", region: "Pacific" },
  { value: "Europe/London", region: "Europe" },
  { value: "Europe/Paris", region: "Europe" },
  { value: "America/New_York", region: "Americas" },
  { value: "America/Los_Angeles", region: "Americas" },
  { value: "America/Chicago", region: "Americas" },
] as const;

const TIMEZONE_LABEL_KEYS: Record<string, string> = {
  "Asia/Kuala_Lumpur": "settings.tz.asiaKualaLumpur",
  "Asia/Singapore": "settings.tz.asiaSingapore",
  "Asia/Bangkok": "settings.tz.asiaBangkok",
  "Asia/Jakarta": "settings.tz.asiaJakarta",
  "Asia/Manila": "settings.tz.asiaManila",
  "Asia/Hong_Kong": "settings.tz.asiaHongKong",
  "Asia/Tokyo": "settings.tz.asiaTokyo",
  "Asia/Shanghai": "settings.tz.asiaShanghai",
  "Asia/Dubai": "settings.tz.asiaDubai",
  "Australia/Sydney": "settings.tz.australiaSydney",
  "Europe/London": "settings.tz.europeLondon",
  "Europe/Paris": "settings.tz.europeParis",
  "America/New_York": "settings.tz.americaNewYork",
  "America/Los_Angeles": "settings.tz.americaLosAngeles",
  "America/Chicago": "settings.tz.americaChicago",
};

type SupportPriority = "low" | "normal" | "high" | "urgent";

const SUPPORT_PRIORITY_LABEL_KEYS: Record<SupportPriority, string> = {
  low: "settings.supportPriority.low",
  normal: "settings.supportPriority.normal",
  high: "settings.supportPriority.high",
  urgent: "settings.supportPriority.urgent",
};

const SUPPORT_PRIORITIES = Object.keys(
  SUPPORT_PRIORITY_LABEL_KEYS,
) as SupportPriority[];

const SUPPORT_CATEGORY_LABEL_KEYS: Record<string, string> = {
  booking: "settings.supportCategory.booking",
  stay: "settings.supportCategory.stay",
  billing: "settings.supportCategory.billing",
  loyalty: "settings.supportCategory.loyalty",
  technical: "settings.supportCategory.technical",
  other: "settings.supportCategory.other",
};

/** Settings keys owned by each workspace tab, for "Reset to defaults". */
const SECTION_KEYS = {
  hotel: [
    "hotel_name",
    "hotel_address",
    "hotel_phone",
    "hotel_email",
    "hotel_business_number",
    "check_in_time",
    "check_out_time",
    "night_shift_time",
    "night_audit_auto_enabled",
    "currency",
    "timezone",
  ],
  finance: [
    "deposit_amount",
    "service_tax_rate",
    "tourism_tax_rate",
    "default_payment_terms_days",
    "unpaid_hold_release_hours",
  ],
  reports: [
    "report_font_size",
    "report_font_family",
    "report_heading_font_size",
    "report_section_heading_font_size",
    "report_table_font_size",
    "report_caption_font_size",
    "report_chip_font_size",
  ],
  guest: [
    "guest_booking_cancellation_enabled",
    "support_enabled",
    "support_categories",
    "support_first_response_low_minutes",
    "support_first_response_normal_minutes",
    "support_first_response_high_minutes",
    "support_first_response_urgent_minutes",
    "support_resolution_low_minutes",
    "support_resolution_normal_minutes",
    "support_resolution_high_minutes",
    "support_resolution_urgent_minutes",
    "support_reopen_window_days",
  ],
  security: [
    "max_login_attempts",
    "totp_issuer_name",
    "passkey_relying_party_name",
  ],
  system: ["rate_codes", "market_codes", "booking_channels", "payment_methods"],
} as const;

const SettingsPage: React.FC = () => {
  const { t } = useTranslation('admin');
  const { hasPermission } = useAuth();
  const { themeMode, onThemeModeChange } = useThemeMode();
  const isAdmin =
    hasPermission("settings:update") || hasPermission("settings:manage");
  const { symbol: currencySymbol } = useCurrency();
  const settingsQuery = useHotelSettingsQuery();
  const saveSettingsMutation = useSaveHotelSettingsMutation();
  const loading = settingsQuery.isPending;
  const saving = saveSettingsMutation.isPending;
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [activeTab, setActiveTab] = useState<keyof typeof SECTION_KEYS | "appearance">("hotel");
  const confirm = useConfirm();
  const resetSettingsMutation = useResetSystemSettingsMutation();

  // Hotel Information
  const [hotelName, setHotelName] = useState("");
  const [hotelAddress, setHotelAddress] = useState("");
  const [hotelPhone, setHotelPhone] = useState("");
  const [hotelEmail, setHotelEmail] = useState("");
  const [hotelBusinessNumber, setHotelBusinessNumber] = useState("");

  // Operational Settings
  const [checkInTime, setCheckInTime] = useState("15:00");
  const [checkOutTime, setCheckOutTime] = useState("11:00");
  const [nightShiftTime, setNightShiftTime] = useState("23:00");
  const [nightAuditAutoEnabled, setNightAuditAutoEnabled] = useState(false);
  const [currency, setCurrency] = useState("MYR");
  const [timezone, setTimezone] = useState("Asia/Kuala_Lumpur");

  // Charges Settings
  const [depositAmount, setDepositAmount] = useState(50);
  const [serviceTaxRate, setServiceTaxRate] = useState(8);
  const [tourismTaxRate, setTourismTaxRate] = useState(10);
  const [defaultPaymentTermsDays, setDefaultPaymentTermsDays] = useState(30);
  const [unpaidHoldReleaseHours, setUnpaidHoldReleaseHours] = useState(24);

  // Report Settings
  const [reportFontSize, setReportFontSize] = useState(14);
  const [reportFontFamily, setReportFontFamily] = useState<string>(
    REPORT_FONT_FAMILY_OPTIONS[0].value,
  );
  const [reportHeadingFontSize, setReportHeadingFontSize] = useState(24);
  const [reportSectionHeadingFontSize, setReportSectionHeadingFontSize] =
    useState(18);
  const [reportTableFontSize, setReportTableFontSize] = useState(14);
  const [reportCaptionFontSize, setReportCaptionFontSize] = useState(13);
  const [reportChipFontSize, setReportChipFontSize] = useState(12);

  // Security Settings
  const [maxLoginAttempts, setMaxLoginAttempts] = useState(5);
  // Both default to empty, which the backend reads as "use the hotel name".
  const [totpIssuerName, setTotpIssuerName] = useState("");
  const [passkeyRelyingPartyName, setPasskeyRelyingPartyName] = useState("");

  // Guest support workflow settings
  const [supportEnabled, setSupportEnabled] = useState(true);
  const [guestBookingCancellationEnabled, setGuestBookingCancellationEnabled] =
    useState(false);
  const [supportCategories, setSupportCategories] = useState<string[]>([
    "booking",
    "stay",
    "billing",
    "loyalty",
    "technical",
    "other",
  ]);
  const [supportFirstResponseMinutes, setSupportFirstResponseMinutes] =
    useState<Record<SupportPriority, number>>({
      low: 240,
      normal: 60,
      high: 15,
      urgent: 5,
    });
  const [supportResolutionMinutes, setSupportResolutionMinutes] = useState<
    Record<SupportPriority, number>
  >({
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

  const applySettingsToForm = (settings: HotelSettings) => {
    setHotelName(settings.hotel_name);
    setHotelAddress(settings.hotel_address);
    setHotelPhone(settings.hotel_phone);
    setHotelEmail(settings.hotel_email);
    setHotelBusinessNumber(settings.hotel_business_number);
    setCheckInTime(settings.check_in_time);
    setCheckOutTime(settings.check_out_time);
    setNightShiftTime(settings.night_shift_time || "23:00");
    setNightAuditAutoEnabled(Boolean(settings.night_audit_auto_enabled));
    setCurrency(settings.currency);
    setTimezone(settings.timezone);
    setDepositAmount(settings.deposit_amount);
    setServiceTaxRate(settings.service_tax_rate);
    setTourismTaxRate(settings.tourism_tax_rate);
    setDefaultPaymentTermsDays(settings.default_payment_terms_days);
    setUnpaidHoldReleaseHours(settings.unpaid_hold_release_hours);
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
    setGuestBookingCancellationEnabled(
      settings.guest_booking_cancellation_enabled,
    );
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
      pendingBaseline.current = true;
      baselineArmed.current = false;
      applySettingsToForm(settingsQuery.data);
    }
  }, [settingsQuery.data]);

  const loadSettings = async () => {
    setError("");
    const result = await settingsQuery.refetch();
    if (result.data) {
      // Arm baseline recapture here too — refetch may return a structurally
      // identical object, in which case the data effect above never re-runs.
      pendingBaseline.current = true;
      baselineArmed.current = false;
      applySettingsToForm(result.data);
    }
  };

  // The settings object the form currently describes — one source used by
  // both the save payload and the unsaved-changes comparison.
  const buildSettings = useCallback((): HotelSettings => {
    const normalizedReportBodyFontSize =
      normalizeReportFontSize(reportFontSize);

    return {
        hotel_name: hotelName,
        hotel_address: hotelAddress,
        hotel_phone: hotelPhone,
        hotel_email: hotelEmail,
        hotel_business_number: hotelBusinessNumber,
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
        unpaid_hold_release_hours: unpaidHoldReleaseHours,
        report_font_size: normalizedReportBodyFontSize,
        report_font_family: normalizeReportFontFamily(reportFontFamily),
        report_heading_font_size: normalizeReportFontSize(
          reportHeadingFontSize,
          Math.max(normalizedReportBodyFontSize + 10, 20),
          {
            min: REPORT_DISPLAY_FONT_SIZE_MIN,
            max: REPORT_DISPLAY_FONT_SIZE_MAX,
          },
        ),
        report_section_heading_font_size: normalizeReportFontSize(
          reportSectionHeadingFontSize,
          Math.max(normalizedReportBodyFontSize + 4, 14),
          { min: REPORT_FONT_SIZE_MIN, max: REPORT_DISPLAY_FONT_SIZE_MAX },
        ),
        report_table_font_size: normalizeReportFontSize(
          reportTableFontSize,
          normalizedReportBodyFontSize,
        ),
        report_caption_font_size: normalizeReportFontSize(
          reportCaptionFontSize,
          Math.max(normalizedReportBodyFontSize - 1, REPORT_FONT_SIZE_MIN),
        ),
        report_chip_font_size: normalizeReportFontSize(
          reportChipFontSize,
          Math.max(normalizedReportBodyFontSize - 2, REPORT_FONT_SIZE_MIN),
        ),
        max_login_attempts: maxLoginAttempts,
        totp_issuer_name: totpIssuerName,
        passkey_relying_party_name: passkeyRelyingPartyName,
        support_enabled: supportEnabled,
        guest_booking_cancellation_enabled: guestBookingCancellationEnabled,
        support_categories: supportCategories,
        support_first_response_low_minutes: supportFirstResponseMinutes.low,
        support_first_response_normal_minutes:
          supportFirstResponseMinutes.normal,
        support_first_response_high_minutes: supportFirstResponseMinutes.high,
        support_first_response_urgent_minutes:
          supportFirstResponseMinutes.urgent,
        support_resolution_low_minutes: supportResolutionMinutes.low,
        support_resolution_normal_minutes: supportResolutionMinutes.normal,
        support_resolution_high_minutes: supportResolutionMinutes.high,
        support_resolution_urgent_minutes: supportResolutionMinutes.urgent,
        support_reopen_window_days: supportReopenWindowDays,
        rate_codes: rateCodes,
        market_codes: marketCodes,
        booking_channels: bookingChannels,
        payment_methods: paymentMethods,
    };
  }, [
    hotelName, hotelAddress, hotelPhone, hotelEmail, hotelBusinessNumber,
    checkInTime, checkOutTime, nightShiftTime, nightAuditAutoEnabled,
    currency, timezone, depositAmount, serviceTaxRate, tourismTaxRate,
    defaultPaymentTermsDays, unpaidHoldReleaseHours, reportFontSize,
    reportFontFamily, reportHeadingFontSize, reportSectionHeadingFontSize,
    reportTableFontSize, reportCaptionFontSize, reportChipFontSize,
    maxLoginAttempts, totpIssuerName, passkeyRelyingPartyName,
    supportEnabled, guestBookingCancellationEnabled, supportCategories,
    supportFirstResponseMinutes, supportResolutionMinutes,
    supportReopenWindowDays, rateCodes, marketCodes, bookingChannels,
    paymentMethods,
  ]);

  // Baseline of the last loaded/saved form — the dirty check compares the
  // form's JSON against this. Capturing must wait one commit past the apply
  // effect so the setters have flushed into state, hence the arm flag.
  const pendingBaseline = useRef(false);
  const baselineArmed = useRef(false);
  const [baselineJson, setBaselineJson] = useState<string | null>(null);
  useEffect(() => {
    if (pendingBaseline.current && baselineArmed.current) {
      pendingBaseline.current = false;
      baselineArmed.current = false;
      setBaselineJson(JSON.stringify(buildSettings()));
    } else if (pendingBaseline.current) {
      baselineArmed.current = true;
    }
  }, [buildSettings]);
  const isDirty =
    baselineJson !== null && JSON.stringify(buildSettings()) !== baselineJson;

  const saveSettings = async () => {
    setError("");
    setSuccess("");

    try {
      const settings = buildSettings();
      const result = await saveSettingsMutation.mutateAsync(settings);
      const savedSettings = result.settings;
      setBaselineJson(JSON.stringify(settings));

      // Save currency to localStorage and trigger update
      setCurrentCurrency(savedSettings.currency);
      window.dispatchEvent(
        new CustomEvent("currencyChange", { detail: savedSettings.currency }),
      );

      // Trigger hotel settings update event
      window.dispatchEvent(
        new CustomEvent("hotelSettingsChange", { detail: savedSettings }),
      );

      setSuccess(t('settings.saved'));

      // Clear success message after 3 seconds
      setTimeout(() => setSuccess(""), 3000);
    } catch (err) {
      setError(errorMessage(err, t('settings.saveFailed')));
    }
  };

  /** Restore one tab's settings to their seeded defaults, then re-apply. */
  const resetSection = async (keys: readonly string[]) => {
    setError("");
    setSuccess("");
    const accepted = await confirm({
      message: t('settings.resetConfirm'),
      severity: "warning",
    });
    if (!accepted) return;
    try {
      await resetSettingsMutation.mutateAsync([...keys]);
      const result = await settingsQuery.refetch();
      if (result.data) {
        pendingBaseline.current = true;
        baselineArmed.current = false;
        applySettingsToForm(result.data);
      }
      setSuccess(t('settings.resetDone'));
      setTimeout(() => setSuccess(""), 3000);
    } catch (err) {
      setError(errorMessage(err, t('settings.resetFailed')));
    }
  };

  /** Right-aligned per-tab reset button; only admins can change settings. */
  const sectionResetButton = (keys: readonly string[]) =>
    isAdmin ? (
      <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 2 }}>
        <Button
          size="small"
          variant="text"
          onClick={() => resetSection(keys)}
          disabled={resetSettingsMutation.isPending || saving}
        >
          {t('settings.resetToDefaults')}
        </Button>
      </Box>
    ) : null;

  if (loading) {
    return (
      <Box
        sx={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          minHeight: "400px"
        }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="h4" component="h1" gutterBottom>
        {t('settings.title')}
      </Typography>
      <Typography
        variant="body2"
        sx={{
          color: "text.secondary",
          mb: 3
        }}>
        {t('settings.subtitle')}
      </Typography>
      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}
      {success && (
        <Alert severity="success" sx={{ mb: 3 }} onClose={() => setSuccess("")}>
          {success}
        </Alert>
      )}
      <Tabs
        value={activeTab}
        onChange={(_, value) => setActiveTab(value)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ mb: 3, borderBottom: 1, borderColor: "divider" }}
      >
        <Tab value="hotel" label={t('settings.tabs.hotel')} />
        <Tab value="finance" label={t('settings.tabs.finance')} />
        <Tab value="reports" label={t('settings.tabs.reports')} />
        <Tab value="guest" label={t('settings.tabs.guest')} />
        <Tab value="security" label={t('settings.tabs.security')} />
        <Tab value="appearance" label={t('settings.tabs.appearance')} />
        <Tab value="system" label={t('settings.tabs.system')} />
      </Tabs>
      {activeTab === "hotel" && (
        <>
          {sectionResetButton(SECTION_KEYS.hotel)}
          {/* Hotel Information */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
            <BusinessIcon sx={{ mr: 1, color: "primary.main" }} />
            <Typography variant="h6">{t('settings.hotelInfo')}</Typography>
          </Box>
          <Divider sx={{ mb: 3 }} />

          <Grid container spacing={3}>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                label={t('settings.hotelName')}
                value={hotelName}
                onChange={(e) => setHotelName(e.target.value)}
                helperText={t('settings.hotelNameHint')}
                disabled={!isAdmin}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                label={t('settings.contactEmail')}
                type="email"
                value={hotelEmail}
                onChange={(e) => setHotelEmail(e.target.value)}
                helperText={t('settings.contactEmailHint')}
                disabled={!isAdmin}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                type="tel"
                label={t('settings.contactPhone')}
                value={hotelPhone}
                onChange={(e) => setHotelPhone(e.target.value)}
                helperText={t('settings.contactPhoneHint')}
                disabled={!isAdmin}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                label={t('common:field.address')}
                value={hotelAddress}
                onChange={(e) => setHotelAddress(e.target.value)}
                helperText={t('settings.addressHint')}
                disabled={!isAdmin}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                label={t('settings.businessNumber')}
                value={hotelBusinessNumber}
                onChange={(e) => setHotelBusinessNumber(e.target.value)}
                helperText={t('settings.businessNumberHint')}
                disabled={!isAdmin}
              />
            </Grid>
          </Grid>

          {!isAdmin && (
            <Alert severity="info" sx={{ mt: 2 }}>
              {t('settings.adminOnlyHotel')}
            </Alert>
          )}
        </CardContent>
      </Card>
      {/* Check-in/Check-out Settings */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
            <ScheduleIcon sx={{ mr: 1, color: "primary.main" }} />
            <Typography variant="h6">{t('settings.timesTitle')}</Typography>
          </Box>
          <Divider sx={{ mb: 3 }} />

          <Grid container spacing={3}>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                label={t('settings.checkInTime')}
                type="time"
                value={checkInTime}
                onChange={(e) => setCheckInTime(e.target.value)}
                helperText={t('settings.checkInTimeHint')}
                slotProps={{
                  inputLabel: { shrink: true }
                }}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                label={t('settings.checkOutTime')}
                type="time"
                value={checkOutTime}
                onChange={(e) => setCheckOutTime(e.target.value)}
                helperText={t('settings.checkOutTimeHint')}
                slotProps={{
                  inputLabel: { shrink: true }
                }}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                label={t('settings.nightShiftTime')}
                type="time"
                value={nightShiftTime}
                onChange={(e) => setNightShiftTime(e.target.value)}
                helperText={t('settings.nightShiftHint')}
                slotProps={{
                  inputLabel: { shrink: true }
                }}
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
                label={t('settings.nightAuditAuto')}
              />
              <Typography
                variant="caption"
                sx={{
                  color: "text.secondary",
                  display: "block"
                }}>
                {t('settings.nightAuditAutoHint')}
              </Typography>
            </Grid>
          </Grid>

          <Alert severity="info" sx={{ mt: 2 }}>
            {t('settings.nightShiftNote')}
          </Alert>
        </CardContent>
      </Card>
      {/* Operational Settings */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
            <MoneyIcon sx={{ mr: 1, color: "primary.main" }} />
            <Typography variant="h6">{t('settings.operationalTitle')}</Typography>
          </Box>
          <Divider sx={{ mb: 3 }} />

          <Grid container spacing={3}>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                select
                fullWidth
                label={t('settings.defaultCurrency')}
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                helperText={t('settings.defaultCurrencyHint')}
                disabled={!isAdmin}
                slotProps={{
                  select: { native: true }
                }}
              >
                <optgroup label={t('settings.currencyRecommended')}>
                  <option value="MYR">RM - Malaysian Ringgit (MYR)</option>
                  <option value="USD">$ - US Dollar (USD)</option>
                </optgroup>
                <optgroup label={t('settings.currencyOther')}>
                  {Object.entries(SUPPORTED_CURRENCIES)
                    .filter(([code]) => code !== "MYR" && code !== "USD")
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
                label={t('settings.timezone')}
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                helperText={t('settings.timezoneHint')}
                disabled={!isAdmin}
                slotProps={{
                  select: { native: true }
                }}
              >
                <optgroup label={t('settings.tzGroup.asiaPacific')}>
                  {TIMEZONES.filter(
                    (tz) => tz.region === "Asia" || tz.region === "Pacific",
                  ).map((tz) => (
                    <option key={tz.value} value={tz.value}>
                      {t(TIMEZONE_LABEL_KEYS[tz.value])}
                    </option>
                  ))}
                </optgroup>
                <optgroup label={t('settings.tzGroup.europe')}>
                  {TIMEZONES.filter((tz) => tz.region === "Europe").map(
                    (tz) => (
                      <option key={tz.value} value={tz.value}>
                        {t(TIMEZONE_LABEL_KEYS[tz.value])}
                      </option>
                    ),
                  )}
                </optgroup>
                <optgroup label={t('settings.tzGroup.americas')}>
                  {TIMEZONES.filter((tz) => tz.region === "Americas").map(
                    (tz) => (
                      <option key={tz.value} value={tz.value}>
                        {t(TIMEZONE_LABEL_KEYS[tz.value])}
                      </option>
                    ),
                  )}
                </optgroup>
              </TextField>
            </Grid>
          </Grid>

          <Alert severity="info" sx={{ mt: 2 }}>
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
              {t('settings.currencyTimezoneNoteTitle')}
            </Typography>
            <Typography variant="caption">
              {t('settings.currencyNote1')}
              <br />
              {t('settings.currencyNote2')}
            </Typography>
          </Alert>

          {!isAdmin && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              {t('settings.adminOnlyOps')}
            </Alert>
          )}
        </CardContent>
      </Card>
        </>
      )}
      {activeTab === "finance" && (
        <>
          {sectionResetButton(SECTION_KEYS.finance)}
          {/* Charges & Deposits */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
            <MoneyIcon sx={{ mr: 1, color: "primary.main" }} />
            <Typography variant="h6">{t('settings.chargesTitle')}</Typography>
          </Box>
          <Divider sx={{ mb: 3 }} />

          <Grid container spacing={3}>
            <Grid size={{ xs: 12, md: 3 }}>
              <TextField
                fullWidth
                label={t('settings.serviceTaxRate')}
                type="number"
                value={serviceTaxRate}
                onChange={(e) =>
                  setServiceTaxRate(parseFloat(e.target.value) || 0)
                }
                helperText={t('settings.serviceTaxHint')}
                slotProps={{
                  input: {
                    endAdornment: <Typography sx={{ ml: 0.5 }}>%</Typography>,
                  },

                  htmlInput: {
                    min: 0,
                    max: 100,
                    step: 0.1,
                  }
                }} />
            </Grid>
            <Grid size={{ xs: 12, md: 3 }}>
              <TextField
                fullWidth
                label={t('settings.tourismTaxRate')}
                type="number"
                value={tourismTaxRate}
                onChange={(e) =>
                  setTourismTaxRate(parseFloat(e.target.value) || 0)
                }
                helperText={t('settings.tourismTaxHint')}
                slotProps={{
                  input: {
                    startAdornment: (
                      <Typography sx={{ mr: 0.5 }}>{currencySymbol}</Typography>
                    ),
                  },

                  htmlInput: {
                    min: 0,
                    step: 1,
                  }
                }} />
            </Grid>
            <Grid size={{ xs: 12, md: 3 }}>
              <TextField
                fullWidth
                label={t('settings.depositAmount')}
                type="number"
                value={depositAmount}
                onChange={(e) =>
                  setDepositAmount(parseFloat(e.target.value) || 0)
                }
                helperText={t('settings.depositHint')}
                slotProps={{
                  input: {
                    startAdornment: (
                      <Typography sx={{ mr: 0.5 }}>{currencySymbol}</Typography>
                    ),
                  },

                  htmlInput: {
                    min: 0,
                    step: 1,
                  }
                }} />
            </Grid>
            <Grid size={{ xs: 12, md: 3 }}>
              <TextField
                fullWidth
                label={t('settings.unpaidHoldRelease')}
                type="number"
                value={unpaidHoldReleaseHours}
                onChange={(e) => {
                  // 0 is meaningful here (off), so this must not fall back to a
                  // truthy default the way the fields around it do.
                  const parsed = parseInt(e.target.value, 10);
                  setUnpaidHoldReleaseHours(Number.isFinite(parsed) && parsed > 0 ? parsed : 0);
                }}
                helperText={
                  unpaidHoldReleaseHours > 0
                    ? t('settings.unpaidHoldOn')
                    : t('settings.unpaidHoldOff')
                }
                slotProps={{
                  input: {
                    endAdornment: <Typography sx={{ ml: 0.5 }}>{t('common:units.hours')}</Typography>,
                  },

                  htmlInput: {
                    min: 0,
                    step: 1,
                  }
                }} />
            </Grid>
            <Grid size={{ xs: 12, md: 3 }}>
              <TextField
                fullWidth
                label={t('settings.paymentTerms')}
                type="number"
                value={defaultPaymentTermsDays}
                onChange={(e) =>
                  setDefaultPaymentTermsDays(parseInt(e.target.value, 10) || 1)
                }
                helperText={t('settings.paymentTermsHint')}
                slotProps={{
                  input: {
                    endAdornment: <Typography sx={{ ml: 0.5 }}>{t('common:units.days')}</Typography>,
                  },

                  htmlInput: {
                    min: 1,
                    step: 1,
                  }
                }} />
            </Grid>
          </Grid>

          <Alert severity="info" sx={{ mt: 2 }}>
            {t('settings.chargesNote')}
          </Alert>
        </CardContent>
      </Card>
        </>
      )}
      {activeTab === "reports" && (
        <>
          {sectionResetButton(SECTION_KEYS.reports)}
          {/* Report Settings */}
      <ReportSettingsCard
        isAdmin={isAdmin}
        reportFontSize={reportFontSize}
        onReportFontSizeChange={setReportFontSize}
        reportFontFamily={reportFontFamily}
        onReportFontFamilyChange={setReportFontFamily}
        reportHeadingFontSize={reportHeadingFontSize}
        onReportHeadingFontSizeChange={setReportHeadingFontSize}
        reportSectionHeadingFontSize={reportSectionHeadingFontSize}
        onReportSectionHeadingFontSizeChange={setReportSectionHeadingFontSize}
        reportTableFontSize={reportTableFontSize}
        onReportTableFontSizeChange={setReportTableFontSize}
        reportCaptionFontSize={reportCaptionFontSize}
        onReportCaptionFontSizeChange={setReportCaptionFontSize}
        reportChipFontSize={reportChipFontSize}
        onReportChipFontSizeChange={setReportChipFontSize}
      />
        </>
      )}
      {activeTab === "guest" && (
        <>
          {sectionResetButton(SECTION_KEYS.guest)}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6">{t('settings.guestCancelTitle')}</Typography>
          <Divider sx={{ my: 2 }} />
          <FormControlLabel
            control={
              <Switch
                checked={guestBookingCancellationEnabled}
                onChange={(event) =>
                  setGuestBookingCancellationEnabled(event.target.checked)
                }
                disabled={!isAdmin}
              />
            }
            label={t('settings.guestCancelToggle')}
          />
          <Typography variant="body2" sx={{
            color: "text.secondary"
          }}>
            {t('settings.guestCancelHint')}
          </Typography>
        </CardContent>
      </Card>
      {/* Guest Support Workflow */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
            <SupportIcon sx={{ mr: 1, color: "primary.main" }} />
            <Typography variant="h6">{t('settings.supportTitle')}</Typography>
          </Box>
          <Divider sx={{ mb: 2 }} />

          <FormControlLabel
            control={
              <Switch
                checked={supportEnabled}
                onChange={(event) => setSupportEnabled(event.target.checked)}
                disabled={!isAdmin}
              />
            }
            label={t('settings.supportToggle')}
          />
          <Typography
            variant="body2"
            sx={{
              color: "text.secondary",
              mb: 3
            }}>
            {t('settings.supportHint')}
          </Typography>

          <Typography variant="subtitle1" gutterBottom sx={{
            fontWeight: "medium"
          }}>
            {t('settings.supportTopics')}
          </Typography>
          <Stack
            direction="row"
            useFlexGap
            sx={{
              flexWrap: "wrap",
              mb: 3,
              columnGap: 1,
              rowGap: 0
            }}>
            {Object.entries(SUPPORT_CATEGORY_LABEL_KEYS).map(
              ([category, labelKey]) => {
                const isEnabled = supportCategories.includes(category);
                return (
                  <FormControlLabel
                    key={category}
                    label={t(labelKey)}
                    control={
                      <Switch
                        size="small"
                        checked={isEnabled}
                        disabled={
                          !isAdmin ||
                          (isEnabled && supportCategories.length === 1)
                        }
                        onChange={(event) =>
                          setSupportCategories((current) =>
                            event.target.checked
                              ? [...new Set([...current, category])]
                              : current.filter((value) => value !== category),
                          )
                        }
                      />
                    }
                  />
                );
              },
            )}
          </Stack>

          <Grid container spacing={3}>
            <Grid size={{ xs: 12, md: 6 }}>
              <Typography variant="subtitle1" gutterBottom sx={{
                fontWeight: "medium"
              }}>
                {t('settings.firstResponseTarget')}
              </Typography>
              <Grid container spacing={2}>
                {SUPPORT_PRIORITIES.map((priority) => (
                  <Grid key={priority} size={{ xs: 6, sm: 3 }}>
                    <TextField
                      fullWidth
                      label={`${t(SUPPORT_PRIORITY_LABEL_KEYS[priority])} (${t('common:units.minutes')})`}
                      type="number"
                      value={supportFirstResponseMinutes[priority]}
                      onChange={(event) =>
                        setSupportFirstResponseMinutes((current) => ({
                          ...current,
                          [priority]: Math.max(
                            1,
                            Number.parseInt(event.target.value, 10) || 1,
                          ),
                        }))
                      }
                      disabled={!isAdmin}
                      slotProps={{
                        htmlInput: { min: 1, step: 1 }
                      }}
                    />
                  </Grid>
                ))}
              </Grid>
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <Typography variant="subtitle1" gutterBottom sx={{
                fontWeight: "medium"
              }}>
                {t('settings.resolutionTarget')}
              </Typography>
              <Grid container spacing={2}>
                {SUPPORT_PRIORITIES.map((priority) => (
                  <Grid key={priority} size={{ xs: 6, sm: 3 }}>
                    <TextField
                      fullWidth
                      label={`${t(SUPPORT_PRIORITY_LABEL_KEYS[priority])} (${t('common:units.minutes')})`}
                      type="number"
                      value={supportResolutionMinutes[priority]}
                      onChange={(event) =>
                        setSupportResolutionMinutes((current) => ({
                          ...current,
                          [priority]: Math.max(
                            1,
                            Number.parseInt(event.target.value, 10) || 1,
                          ),
                        }))
                      }
                      disabled={!isAdmin}
                      slotProps={{
                        htmlInput: { min: 1, step: 1 }
                      }}
                    />
                  </Grid>
                ))}
              </Grid>
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <TextField
                fullWidth
                label={t('settings.reopenWindow')}
                type="number"
                value={supportReopenWindowDays}
                onChange={(event) =>
                  setSupportReopenWindowDays(
                    Math.max(1, Number.parseInt(event.target.value, 10) || 1),
                  )
                }
                helperText={t('settings.reopenWindowHint')}
                disabled={!isAdmin}
                slotProps={{
                  htmlInput: { min: 1, step: 1 }
                }}
              />
            </Grid>
          </Grid>
        </CardContent>
      </Card>
        </>
      )}
      {activeTab === "security" && (
        <>
          {sectionResetButton(SECTION_KEYS.security)}
          {/* Security & Identity */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
            <SecurityIcon sx={{ mr: 1, color: "primary.main" }} />
            <Typography variant="h6">{t('settings.securityTitle')}</Typography>
          </Box>
          <Divider sx={{ mb: 3 }} />

          <Grid container spacing={3}>
            <Grid size={{ xs: 12, md: 4 }}>
              <TextField
                fullWidth
                label={t('settings.maxLoginAttempts')}
                type="number"
                value={maxLoginAttempts}
                onChange={(e) =>
                  setMaxLoginAttempts(parseInt(e.target.value, 10) || 1)
                }
                helperText={t('settings.maxLoginAttemptsHint')}
                disabled={!isAdmin}
                slotProps={{
                  htmlInput: {
                    min: 1,
                    max: 20,
                    step: 1,
                  }
                }}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <TextField
                fullWidth
                label={t('settings.totpIssuer')}
                value={totpIssuerName}
                onChange={(e) => setTotpIssuerName(e.target.value)}
                placeholder={hotelName}
                helperText={t('settings.totpIssuerHint')}
                disabled={!isAdmin}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <TextField
                fullWidth
                label={t('settings.passkeyDisplayName')}
                value={passkeyRelyingPartyName}
                onChange={(e) => setPasskeyRelyingPartyName(e.target.value)}
                placeholder={hotelName}
                helperText={t('settings.passkeyDisplayNameHint')}
                disabled={!isAdmin}
              />
            </Grid>
          </Grid>
        </CardContent>
      </Card>
        </>
      )}
      {activeTab === "appearance" && (
        <>
          {/* Appearance — a local device preference, not a system setting, so
              there is nothing here for "reset to defaults" to restore. */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
            <PaletteIcon sx={{ mr: 1, color: "primary.main" }} />
            <Typography variant="h6">{t('settings.tabs.appearance')}</Typography>
          </Box>
          <Divider sx={{ mb: 3 }} />

          <Typography variant="subtitle1" gutterBottom sx={{
            fontWeight: "medium"
          }}>
            {t('settings.themeMode')}
          </Typography>
          <Typography variant="body2" gutterBottom sx={{
            color: "text.secondary"
          }}>
            {t('settings.themeModeHint')}
          </Typography>

          <ToggleButtonGroup
            exclusive
            value={themeMode}
            onChange={(_, value: ThemeMode | null) => {
              if (value === "light" || value === "dark")
                onThemeModeChange(value);
            }}
            sx={{ mt: 2 }}
          >
            <ToggleButton value="light" aria-label={t('settings.theme.lightMode')}>
              <Tooltip title={t('settings.theme.lightMode')}>
                <LightModeIcon fontSize="small" />
              </Tooltip>
              <Box component="span" sx={{ ml: 1 }}>
                {t('settings.theme.light')}
              </Box>
            </ToggleButton>
            <ToggleButton value="dark" aria-label={t('settings.theme.darkMode')}>
              <Tooltip title={t('settings.theme.darkMode')}>
                <DarkModeIcon fontSize="small" />
              </Tooltip>
              <Box component="span" sx={{ ml: 1 }}>
                {t('settings.theme.dark')}
              </Box>
            </ToggleButton>
          </ToggleButtonGroup>
        </CardContent>
      </Card>
        </>
      )}
      {activeTab === "system" && (
        <>
          {sectionResetButton(SECTION_KEYS.system)}
          {/* System Configuration */}
      <SystemConfigurationCard
        isAdmin={isAdmin}
        rateCodes={rateCodes}
        onRateCodesChange={setRateCodes}
        marketCodes={marketCodes}
        onMarketCodesChange={setMarketCodes}
        bookingChannels={bookingChannels}
        onBookingChannelsChange={setBookingChannels}
        paymentMethods={paymentMethods}
        onPaymentMethodsChange={setPaymentMethods}
      />
        </>
      )}
      {/* Sticky save bar — the dirty state was previously invisible anywhere
          but this bottom row, which a long form scrolls far away from. */}
      <Paper
        elevation={8}
        role="status"
        aria-live="polite"
        sx={{
          position: 'sticky',
          bottom: 0,
          zIndex: 10,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 2,
          flexWrap: 'wrap',
          mt: 3,
          px: 2.5,
          py: 1.5,
          borderTop: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
        }}
      >
        <Typography
          variant="body2"
          sx={{
            fontWeight: isDirty ? 700 : 500,
            color: isDirty ? 'warning.main' : 'text.secondary',
          }}
        >
          {isDirty ? t('settings.unsaved') : t('settings.allSaved')}
        </Typography>
        <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 2 }}>
          <Button variant="outlined" onClick={loadSettings} disabled={saving || (isAdmin && !isDirty)}>
            {t('common:actions.discardChanges')}
          </Button>
          <Button
            variant="contained"
            onClick={saveSettings}
            disabled={saving || (isAdmin && !isDirty)}
            startIcon={saving ? <CircularProgress size={20} /> : <SaveIcon />}
          >
            {saving ? t('common:state.saving') : t('settings.saveSettings')}
          </Button>
        </Box>
      </Paper>
    </Box>
  );
};

export default SettingsPage;

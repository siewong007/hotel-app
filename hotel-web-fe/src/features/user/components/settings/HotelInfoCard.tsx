import React from "react";
import {
  Alert,
  Box,
  Card,
  CardContent,
  Divider,
  FormControlLabel,
  Grid,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import {
  Business as BusinessIcon,
  Schedule as ScheduleIcon,
  AttachMoney as MoneyIcon,
} from "@mui/icons-material";

import { SUPPORTED_CURRENCIES } from "../../../../utils/currency";
import { useTranslation } from "../../../../i18n";

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

interface HotelInfoCardProps {
  isAdmin: boolean;
  hotelName: string;
  onHotelNameChange: React.Dispatch<React.SetStateAction<string>>;
  hotelAddress: string;
  onHotelAddressChange: React.Dispatch<React.SetStateAction<string>>;
  hotelPhone: string;
  onHotelPhoneChange: React.Dispatch<React.SetStateAction<string>>;
  hotelEmail: string;
  onHotelEmailChange: React.Dispatch<React.SetStateAction<string>>;
  hotelBusinessNumber: string;
  onHotelBusinessNumberChange: React.Dispatch<React.SetStateAction<string>>;
  checkInTime: string;
  onCheckInTimeChange: React.Dispatch<React.SetStateAction<string>>;
  checkOutTime: string;
  onCheckOutTimeChange: React.Dispatch<React.SetStateAction<string>>;
  nightShiftTime: string;
  onNightShiftTimeChange: React.Dispatch<React.SetStateAction<string>>;
  nightAuditAutoEnabled: boolean;
  onNightAuditAutoEnabledChange: React.Dispatch<React.SetStateAction<boolean>>;
  currency: string;
  onCurrencyChange: React.Dispatch<React.SetStateAction<string>>;
  timezone: string;
  onTimezoneChange: React.Dispatch<React.SetStateAction<string>>;
}

/**
 * "Hotel" tab cards of SettingsPage (hotel information, check-in/out times,
 * and operational settings — currency + timezone). Pure display + input: all
 * values and their setters come from the page.
 */
export function HotelInfoCard({
  isAdmin,
  hotelName,
  onHotelNameChange,
  hotelAddress,
  onHotelAddressChange,
  hotelPhone,
  onHotelPhoneChange,
  hotelEmail,
  onHotelEmailChange,
  hotelBusinessNumber,
  onHotelBusinessNumberChange,
  checkInTime,
  onCheckInTimeChange,
  checkOutTime,
  onCheckOutTimeChange,
  nightShiftTime,
  onNightShiftTimeChange,
  nightAuditAutoEnabled,
  onNightAuditAutoEnabledChange,
  currency,
  onCurrencyChange,
  timezone,
  onTimezoneChange,
}: HotelInfoCardProps) {
  const { t } = useTranslation('admin');

  return (
    <>
      {/* Hotel Information */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
            <BusinessIcon sx={{ mr: 1, color: "primary.main" }} />
            <Typography variant="h6" component="h2">{t('settings.hotelInfo')}</Typography>
          </Box>
          <Divider sx={{ mb: 3 }} />

          <Grid container spacing={3}>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                label={t('settings.hotelName')}
                value={hotelName}
                onChange={(e) => onHotelNameChange(e.target.value)}
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
                onChange={(e) => onHotelEmailChange(e.target.value)}
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
                onChange={(e) => onHotelPhoneChange(e.target.value)}
                helperText={t('settings.contactPhoneHint')}
                disabled={!isAdmin}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                label={t('common:field.address')}
                value={hotelAddress}
                onChange={(e) => onHotelAddressChange(e.target.value)}
                helperText={t('settings.addressHint')}
                disabled={!isAdmin}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                label={t('settings.businessNumber')}
                value={hotelBusinessNumber}
                onChange={(e) => onHotelBusinessNumberChange(e.target.value)}
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
            <Typography variant="h6" component="h2">{t('settings.timesTitle')}</Typography>
          </Box>
          <Divider sx={{ mb: 3 }} />

          <Grid container spacing={3}>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                label={t('settings.checkInTime')}
                type="time"
                value={checkInTime}
                onChange={(e) => onCheckInTimeChange(e.target.value)}
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
                onChange={(e) => onCheckOutTimeChange(e.target.value)}
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
                onChange={(e) => onNightShiftTimeChange(e.target.value)}
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
                    onChange={(e) => onNightAuditAutoEnabledChange(e.target.checked)}
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
            <Typography variant="h6" component="h2">{t('settings.operationalTitle')}</Typography>
          </Box>
          <Divider sx={{ mb: 3 }} />

          <Grid container spacing={3}>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                select
                fullWidth
                label={t('settings.defaultCurrency')}
                value={currency}
                onChange={(e) => onCurrencyChange(e.target.value)}
                helperText={t('settings.defaultCurrencyHint')}
                disabled={!isAdmin}
                slotProps={{
                  select: { native: true }
                }}
              >
                <optgroup label={t('settings.currencyRecommended')}>
                  {(['MYR', 'USD'] as const).map((code) => (
                    <option key={code} value={code}>
                      {SUPPORTED_CURRENCIES[code].symbol} - {SUPPORTED_CURRENCIES[code].name} ({code})
                    </option>
                  ))}
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
                onChange={(e) => onTimezoneChange(e.target.value)}
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
  );
}

export default HotelInfoCard;

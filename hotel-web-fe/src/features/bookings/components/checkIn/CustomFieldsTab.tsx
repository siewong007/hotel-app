import React from 'react';
import {
  Typography,
  Grid,
  TextField,
  MenuItem,
  Divider,
  FormControl,
  InputLabel,
  Select,
  InputAdornment,
} from '@mui/material';
import { Search as SearchIcon } from '@mui/icons-material';
import { multiplyMoney, toMoneyNumber } from '../../../../utils/money';
import { LOCALE_CODES, LOCALES, isLocaleCode, useTranslation } from '../../../../i18n';
import type { Booking, BookingWithDetails } from '../../../../types';

export interface CustomFieldsTabProps {
  allowsExtraBed: boolean;
  maxExtraBeds: number;
  extraBedChargePerBed: number;
  booking: Booking | BookingWithDetails;
  carPlateNo: string;
  currencySymbol: string;
  driversInfo: string;
  eta: string;
  extraBedCharge: number;
  extraBedCount: number;
  formatCurrency: (amount: number) => string;
  groupCode: string;
  languagePreference: string;
  setCarPlateNo: React.Dispatch<React.SetStateAction<string>>;
  setDriversInfo: React.Dispatch<React.SetStateAction<string>>;
  setEta: React.Dispatch<React.SetStateAction<string>>;
  setExtraBedCharge: React.Dispatch<React.SetStateAction<number>>;
  setExtraBedCount: React.Dispatch<React.SetStateAction<number>>;
  setGroupCode: React.Dispatch<React.SetStateAction<string>>;
  onLanguagePreferenceChange: (value: string) => void;
  setTravelAgent1: React.Dispatch<React.SetStateAction<string>>;
  setTravelAgent2: React.Dispatch<React.SetStateAction<string>>;
  travelAgent1: string;
  travelAgent2: string;
}

export function CustomFieldsTab({
  allowsExtraBed,
  maxExtraBeds,
  extraBedChargePerBed,
  booking,
  carPlateNo,
  currencySymbol,
  driversInfo,
  eta,
  extraBedCharge,
  extraBedCount,
  formatCurrency,
  groupCode,
  languagePreference,
  setCarPlateNo,
  setDriversInfo,
  setEta,
  setExtraBedCharge,
  setExtraBedCount,
  setGroupCode,
  onLanguagePreferenceChange,
  setTravelAgent1,
  setTravelAgent2,
  travelAgent1,
  travelAgent2,
}: CustomFieldsTabProps) {
  const { t } = useTranslation('bookings');
  return (
      <Grid container spacing={2}>
        <Grid size={12}>
          <Typography variant="subtitle2" color="primary" gutterBottom>
            {t('checkInForm.custom.guestVehicles')}
          </Typography>
          <Divider sx={{ mb: 2 }} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            fullWidth
            label={t('checkInForm.custom.carPlate')}
            value={carPlateNo}
            onChange={(e) => setCarPlateNo(e.target.value)}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            fullWidth
            label={t('checkInForm.custom.eta')}
            value={eta}
            onChange={(e) => setEta(e.target.value)}
            placeholder={t('checkInForm.custom.etaPlaceholder')}
          />
        </Grid>

        <Grid size={12}>
          <Typography variant="subtitle2" color="primary" gutterBottom sx={{ mt: 2 }}>
            {t('checkInForm.custom.travelInfo')}
          </Typography>
          <Divider sx={{ mb: 2 }} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            fullWidth
            label={t('checkInForm.custom.groupCode')}
            value={groupCode}
            onChange={(e) => setGroupCode(e.target.value)}
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              }
            }}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <FormControl fullWidth>
            <InputLabel>{t('checkInForm.custom.language')}</InputLabel>
            <Select
              value={languagePreference}
              onChange={(e) => onLanguagePreferenceChange(e.target.value)}
              label={t('checkInForm.custom.language')}
            >
              <MenuItem value="">{t('checkInForm.custom.langNotSpecified')}</MenuItem>
              {LOCALE_CODES.map((code) => (
                <MenuItem key={code} value={code}>{LOCALES[code].nativeName}</MenuItem>
              ))}
              {/* A stored value outside the locale registry (legacy free text)
                  stays selectable so it round-trips instead of showing blank. */}
              {languagePreference && !isLocaleCode(languagePreference) && (
                <MenuItem value={languagePreference}>{languagePreference}</MenuItem>
              )}
            </Select>
          </FormControl>
        </Grid>

        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            fullWidth
            label={t('checkInForm.custom.travelAgent1')}
            value={travelAgent1}
            onChange={(e) => setTravelAgent1(e.target.value)}
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              }
            }}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            fullWidth
            label={t('checkInForm.custom.travelAgent2')}
            value={travelAgent2}
            onChange={(e) => setTravelAgent2(e.target.value)}
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              }
            }}
          />
        </Grid>

        <Grid size={12}>
          <TextField
            fullWidth
            label={t('checkInForm.custom.driversInfo')}
            value={driversInfo}
            onChange={(e) => setDriversInfo(e.target.value)}
            multiline
            rows={2}
          />
        </Grid>

        <Grid size={12}>
          <Typography variant="subtitle2" color="primary" gutterBottom sx={{ mt: 2 }}>
            {t('checkInForm.custom.specialCharges')}
          </Typography>
          <Divider sx={{ mb: 2 }} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            fullWidth
            label={t('checkInForm.custom.tourismTax')}
            value={booking.tourism_tax_amount || 0}
            disabled
            slotProps={{
              input: {
                startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment>,
              }
            }}
          />
        </Grid>
        {allowsExtraBed && maxExtraBeds > 0 ? (
          <>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label={t('checkInForm.custom.extraBedCount')}
                type="number"
                value={extraBedCount}
                onChange={(e) => {
                  const count = Math.min(Math.max(parseInt(e.target.value) || 0, 0), maxExtraBeds);
                  setExtraBedCount(count);
                  setExtraBedCharge(multiplyMoney(extraBedChargePerBed, count));
                }}
                helperText={t('checkInForm.custom.perExtraBed', { rate: formatCurrency(extraBedChargePerBed), max: maxExtraBeds })}
                slotProps={{
                  htmlInput: { min: 0, max: maxExtraBeds }
                }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label={t('checkInForm.custom.extraBedCharge')}
                type="number"
                value={extraBedCharge}
                onChange={(e) => setExtraBedCharge(toMoneyNumber(e.target.value))}
                helperText={t('checkInForm.custom.extraBedChargeHelper')}
                slotProps={{
                  input: {
                    startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment>,
                  }
                }}
              />
            </Grid>
          </>
        ) : (
          <>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label={t('checkInForm.custom.extraBedCount')}
                type="number"
                value={extraBedCount}
                disabled
                helperText={t('checkInForm.custom.noExtraBeds')}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label={t('checkInForm.custom.extraBedCharge')}
                value={extraBedCharge}
                disabled
                slotProps={{
                  input: {
                    startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment>,
                  }
                }}
              />
            </Grid>
          </>
        )}
      </Grid>
  );
}

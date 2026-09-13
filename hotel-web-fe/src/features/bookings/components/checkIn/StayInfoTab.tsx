import React from 'react';
import { format } from 'date-fns';
import { toMoneyNumber } from '../../../../utils/money';
import {
  Typography,
  Grid,
  TextField,
  MenuItem,
  Paper,
  Divider,
  Autocomplete,
  FormControl,
  InputLabel,
  Select,
  Checkbox,
  FormControlLabel,
  InputAdornment,
} from '@mui/material';
import type { Booking, BookingUpdateRequest, BookingWithDetails } from '../../../../types';

const getDayOfWeek = (dateStr: string) => {
  try {
    return format(new Date(dateStr), 'EEEE');
  } catch {
    return '';
  }
};

export interface StayInfoTabProps {
  booking: Booking | BookingWithDetails;
  calculateNights: () => number;
  bookingData: BookingUpdateRequest;
  chargeIncidentals: boolean;
  currencySymbol: string;
  epiRate: number;
  extraBedCount: number;
  formatCurrency: (amount: number) => string;
  handleBookingChange: (field: keyof BookingUpdateRequest, value: string | number) => void;
  marketCodes: string[];
  nextPosting: string;
  overrideRate: boolean;
  rateCodes: string[];
  setChargeIncidentals: React.Dispatch<React.SetStateAction<boolean>>;
  setEpiRate: React.Dispatch<React.SetStateAction<number>>;
  setNextPosting: React.Dispatch<React.SetStateAction<string>>;
  setOverrideRate: React.Dispatch<React.SetStateAction<boolean>>;
  setVipGuest: React.Dispatch<React.SetStateAction<boolean>>;
  setWeekdayRate: React.Dispatch<React.SetStateAction<string>>;
  setWeekendRate: React.Dispatch<React.SetStateAction<string>>;
  vipGuest: boolean;
  weekdayRate: string;
  weekendRate: string;
}

export function StayInfoTab({
  booking,
  calculateNights,
  bookingData,
  chargeIncidentals,
  currencySymbol,
  epiRate,
  extraBedCount,
  formatCurrency,
  handleBookingChange,
  marketCodes,
  nextPosting,
  overrideRate,
  rateCodes,
  setChargeIncidentals,
  setEpiRate,
  setNextPosting,
  setOverrideRate,
  setVipGuest,
  setWeekdayRate,
  setWeekendRate,
  vipGuest,
  weekdayRate,
  weekendRate,
}: StayInfoTabProps) {
  return (
      <Grid container spacing={2}>
        <Grid size={12}>
          <Typography variant="subtitle2" color="primary" gutterBottom>
            Check-in/Check-out
          </Typography>
          <Divider sx={{ mb: 2 }} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            fullWidth
            label="Check-in Date"
            type="date"
            value={booking.check_in_date}
            disabled
            helperText={getDayOfWeek(booking.check_in_date)}
            slotProps={{
              inputLabel: { shrink: true }
            }}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            fullWidth
            label="Check-in Time"
            type="time"
            value={bookingData.check_in_time || '15:00'}
            onChange={(e) => handleBookingChange('check_in_time', e.target.value)}
            slotProps={{
              inputLabel: { shrink: true }
            }}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField
            fullWidth
            label="Nights"
            value={calculateNights()}
            disabled
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField
            fullWidth
            label="Check-out Date"
            type="date"
            value={booking.check_out_date}
            disabled
            helperText={getDayOfWeek(booking.check_out_date)}
            slotProps={{
              inputLabel: { shrink: true }
            }}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField
            fullWidth
            label="Check-out Time"
            type="time"
            value={bookingData.check_out_time || '11:00'}
            onChange={(e) => handleBookingChange('check_out_time', e.target.value)}
            slotProps={{
              inputLabel: { shrink: true }
            }}
          />
        </Grid>

        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField
            fullWidth
            label="Adults"
            type="number"
            value={booking.number_of_guests || 1}
            disabled
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField
            fullWidth
            label="Extra Beds"
            type="number"
            value={extraBedCount}
            disabled
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField
            fullWidth
            label="Room Number"
            value={booking.room_id}
            disabled
          />
        </Grid>

        <Grid size={12}>
          <Typography variant="subtitle2" color="primary" gutterBottom sx={{ mt: 2 }}>
            Rate & Charges
          </Typography>
          <Divider sx={{ mb: 2 }} />
        </Grid>

        <Grid size={{ xs: 12, sm: 4 }}>
          <FormControl fullWidth>
            <InputLabel>Rate Code</InputLabel>
            <Select
              value={bookingData.rate_code || 'RACK'}
              onChange={(e) => handleBookingChange('rate_code', e.target.value)}
              label="Rate Code"
            >
              {rateCodes.map(code => (
                <MenuItem key={code} value={code}>{code} - Standard Rack Rate</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <Autocomplete
            freeSolo
            options={marketCodes}
            value={bookingData.market_code || 'WKII'}
            onChange={(_, newValue) => handleBookingChange('market_code', newValue || '')}
            onInputChange={(_, newInputValue) => handleBookingChange('market_code', newInputValue)}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Market Code"
                placeholder="Type or select..."
              />
            )}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField
            fullWidth
            label="Discount %"
            type="number"
            value={bookingData.discount_percentage || 0}
            onChange={(e) => handleBookingChange('discount_percentage', parseFloat(e.target.value))}
            slotProps={{
              input: { inputProps: { min: 0, max: 100, step: 0.01 } }
            }}
          />
        </Grid>

        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField
            fullWidth
            label="Weekday Rate"
            type="number"
            value={weekdayRate}
            onChange={(e) => setWeekdayRate(e.target.value)}
            disabled={!overrideRate}
            slotProps={{
              input: {
                startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment>,
              }
            }}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField
            fullWidth
            label="Weekend Rate"
            type="number"
            value={weekendRate}
            onChange={(e) => setWeekendRate(e.target.value)}
            disabled={!overrideRate}
            slotProps={{
              input: {
                startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment>,
              }
            }}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <FormControlLabel
            control={
              <Checkbox
                checked={overrideRate}
                onChange={(e) => setOverrideRate(e.target.checked)}
              />
            }
            label="Override Rate"
          />
        </Grid>

        <Grid size={12}>
          <Paper sx={{ p: 2, bgcolor: 'var(--hotel-surface-sunken)' }}>
            <Typography variant="subtitle2" gutterBottom>
              Room Charge Summary
            </Typography>
            <Grid container spacing={1}>
              <Grid size={6}>
                <Typography variant="body2" sx={{
                  color: "text.secondary"
                }}>Total Amount:</Typography>
              </Grid>
              <Grid size={6}>
                <Typography variant="body2" sx={{
                  fontWeight: "bold"
                }}>{formatCurrency(toMoneyNumber(booking.total_amount))}</Typography>
              </Grid>
            </Grid>
          </Paper>
        </Grid>

        <Grid size={12}>
          <Typography variant="subtitle2" color="primary" gutterBottom sx={{ mt: 2 }}>
            Special Posting
          </Typography>
          <Divider sx={{ mb: 2 }} />
        </Grid>

        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField
            fullWidth
            label="EPI Rate"
            type="number"
            value={epiRate}
            onChange={(e) => setEpiRate(Number(e.target.value))}
            slotProps={{
              input: { inputProps: { min: 1, step: 1 } }
            }}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField
            fullWidth
            label="Next Posting"
            value={nextPosting}
            onChange={(e) => setNextPosting(e.target.value)}
          />
        </Grid>
        <Grid sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }} size={{ xs: 12, sm: 4 }}>
          <FormControlLabel
            control={
              <Checkbox
                checked={chargeIncidentals}
                onChange={(e) => setChargeIncidentals(e.target.checked)}
              />
            }
            label="Charge Incidentals"
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={vipGuest}
                onChange={(e) => setVipGuest(e.target.checked)}
              />
            }
            label="VIP Guest"
          />
        </Grid>
      </Grid>
  );
}

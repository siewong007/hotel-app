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
  language: string;
  setCarPlateNo: React.Dispatch<React.SetStateAction<string>>;
  setDriversInfo: React.Dispatch<React.SetStateAction<string>>;
  setEta: React.Dispatch<React.SetStateAction<string>>;
  setExtraBedCharge: React.Dispatch<React.SetStateAction<number>>;
  setExtraBedCount: React.Dispatch<React.SetStateAction<number>>;
  setGroupCode: React.Dispatch<React.SetStateAction<string>>;
  setLanguage: React.Dispatch<React.SetStateAction<string>>;
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
  language,
  setCarPlateNo,
  setDriversInfo,
  setEta,
  setExtraBedCharge,
  setExtraBedCount,
  setGroupCode,
  setLanguage,
  setTravelAgent1,
  setTravelAgent2,
  travelAgent1,
  travelAgent2,
}: CustomFieldsTabProps) {
  return (
      <Grid container spacing={2}>
        <Grid size={12}>
          <Typography variant="subtitle2" color="primary" gutterBottom>
            Guest Vehicles
          </Typography>
          <Divider sx={{ mb: 2 }} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            fullWidth
            label="Car Plate No."
            value={carPlateNo}
            onChange={(e) => setCarPlateNo(e.target.value)}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            fullWidth
            label="ETA"
            value={eta}
            onChange={(e) => setEta(e.target.value)}
            placeholder="Estimated Time of Arrival"
          />
        </Grid>

        <Grid size={12}>
          <Typography variant="subtitle2" color="primary" gutterBottom sx={{ mt: 2 }}>
            Travel Information
          </Typography>
          <Divider sx={{ mb: 2 }} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            fullWidth
            label="Group Code"
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
            <InputLabel>Language</InputLabel>
            <Select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              label="Language"
            >
              <MenuItem value="Default Language (English)">Default Language (English)</MenuItem>
              <MenuItem value="Bahasa Malaysia">Bahasa Malaysia</MenuItem>
              <MenuItem value="Mandarin">Mandarin</MenuItem>
              <MenuItem value="Tamil">Tamil</MenuItem>
            </Select>
          </FormControl>
        </Grid>

        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            fullWidth
            label="Travel Agent 1"
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
            label="Travel Agent 2"
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
            label="Drivers Info"
            value={driversInfo}
            onChange={(e) => setDriversInfo(e.target.value)}
            multiline
            rows={2}
          />
        </Grid>

        <Grid size={12}>
          <Typography variant="subtitle2" color="primary" gutterBottom sx={{ mt: 2 }}>
            Special Charges
          </Typography>
          <Divider sx={{ mb: 2 }} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            fullWidth
            label="Tourism Tax"
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
                label="Extra Bed Count"
                type="number"
                value={extraBedCount}
                onChange={(e) => {
                  const count = Math.min(Math.max(parseInt(e.target.value) || 0, 0), maxExtraBeds);
                  setExtraBedCount(count);
                  setExtraBedCharge(multiplyMoney(extraBedChargePerBed, count));
                }}
                helperText={`${formatCurrency(extraBedChargePerBed)} per extra bed (max ${maxExtraBeds})`}
                slotProps={{
                  htmlInput: { min: 0, max: maxExtraBeds }
                }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Extra Bed Charge"
                type="number"
                value={extraBedCharge}
                onChange={(e) => setExtraBedCharge(toMoneyNumber(e.target.value))}
                helperText="Auto-calculated or manually adjust"
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
                label="Extra Bed Count"
                type="number"
                value={extraBedCount}
                disabled
                helperText="This room type does not allow extra beds"
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Extra Bed Charge"
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

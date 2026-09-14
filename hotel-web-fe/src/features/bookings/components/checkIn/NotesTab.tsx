import React from 'react';
import {
  Typography,
  Grid,
  TextField,
  Paper,
  Divider,
} from '@mui/material';
import type { Booking, BookingWithDetails } from '../../../../types';
import { statusLabel, useTranslation } from '../../../../i18n';

export interface NotesTabProps {
  booking: Booking | BookingWithDetails;
  setSpecialRequests: React.Dispatch<React.SetStateAction<string>>;
  specialRequests: string;
}

export function NotesTab({
  booking,
  setSpecialRequests,
  specialRequests,
}: NotesTabProps) {
  const { t } = useTranslation('bookings');
  return (
      <Grid container spacing={2}>
        <Grid size={12}>
          <Typography variant="subtitle2" color="primary" gutterBottom>
            {t('checkInForm.notes.specialRequests')}
          </Typography>
          <Divider sx={{ mb: 2 }} />
        </Grid>
        <Grid size={12}>
          <TextField
            fullWidth
            label={t('checkInForm.notes.specialRequests')}
            multiline
            rows={4}
            value={specialRequests}
            onChange={(e) => setSpecialRequests(e.target.value)}
            helperText={t('checkInForm.notes.specialRequestsHelper')}
          />
        </Grid>
        <Grid size={12}>
          <Typography variant="subtitle2" color="primary" gutterBottom sx={{ mt: 2 }}>
            {t('checkInForm.notes.checkInInfo')}
          </Typography>
          <Divider sx={{ mb: 2 }} />
        </Grid>
        <Grid size={12}>
          <Paper sx={{ p: 2, bgcolor: 'info.50', borderLeft: 4, borderColor: 'info.main' }}>
            <Typography variant="body2">
              <strong>{t('checkInForm.notes.confirmationNumber')}</strong> {booking.folio_number || t('enhancedCheckIn.na')}
            </Typography>
            <Typography variant="body2" sx={{ mt: 1 }}>
              <strong>{t('checkInForm.notes.status')}</strong> {statusLabel(t, 'booking', booking.status)}
            </Typography>
            {booking.pre_checkin_completed && (
              <Typography
                variant="body2"
                sx={{
                  color: "success.main",
                  mt: 1
                }}>
                {t('checkInForm.notes.preCheckinDone')}
              </Typography>
            )}
          </Paper>
        </Grid>
      </Grid>
  );
}

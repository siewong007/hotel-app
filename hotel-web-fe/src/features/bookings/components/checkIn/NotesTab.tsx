import React from 'react';
import {
  Typography,
  Grid,
  TextField,
  Paper,
  Divider,
} from '@mui/material';
import type { Booking, BookingWithDetails } from '../../../../types';

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
  return (
      <Grid container spacing={2}>
        <Grid size={12}>
          <Typography variant="subtitle2" color="primary" gutterBottom>
            Special Requests
          </Typography>
          <Divider sx={{ mb: 2 }} />
        </Grid>
        <Grid size={12}>
          <TextField
            fullWidth
            label="Special Requests"
            multiline
            rows={4}
            value={specialRequests}
            onChange={(e) => setSpecialRequests(e.target.value)}
            helperText="Add or edit special requests for this booking"
          />
        </Grid>
        <Grid size={12}>
          <Typography variant="subtitle2" color="primary" gutterBottom sx={{ mt: 2 }}>
            Check-in Information
          </Typography>
          <Divider sx={{ mb: 2 }} />
        </Grid>
        <Grid size={12}>
          <Paper sx={{ p: 2, bgcolor: 'info.50', borderLeft: 4, borderColor: 'info.main' }}>
            <Typography variant="body2">
              <strong>Confirmation Number:</strong> {booking.folio_number || 'N/A'}
            </Typography>
            <Typography variant="body2" sx={{ mt: 1 }}>
              <strong>Status:</strong> {booking.status.toUpperCase()}
            </Typography>
            {booking.pre_checkin_completed && (
              <Typography
                variant="body2"
                sx={{
                  color: "success.main",
                  mt: 1
                }}>
                ✓ Pre-check-in completed
              </Typography>
            )}
          </Paper>
        </Grid>
      </Grid>
  );
}

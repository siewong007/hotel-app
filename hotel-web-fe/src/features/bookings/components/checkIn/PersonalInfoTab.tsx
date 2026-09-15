import React from 'react';
import {
  Grid,
  TextField,
} from '@mui/material';
import type { Booking, BookingWithDetails, GuestUpdateRequest } from '../../../../types';
import type { ValidationErrors } from './checkInTypes';
import { useTranslation } from '../../../../i18n';

export interface PersonalInfoTabProps {
  booking: Booking | BookingWithDetails;
  error: string | null;
  guestData: GuestUpdateRequest;
  handleBlur: (field: string, value: string) => void;
  handleGuestChange: (field: keyof GuestUpdateRequest, value: string) => void;
  touched: Record<string, boolean>;
  validationErrors: ValidationErrors;
}

export function PersonalInfoTab({
  booking,
  error,
  guestData,
  handleBlur,
  handleGuestChange,
  touched,
  validationErrors,
}: PersonalInfoTabProps) {
  const { t } = useTranslation('bookings');
  return (
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 3 }}>
          <TextField
            fullWidth
            label={t('checkInForm.personal.title')}
            value={guestData.title || ''}
            disabled
            slotProps={{
              input: { readOnly: true }
            }}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 4.5 }}>
          <TextField
            fullWidth
            required
            label={t('checkInForm.personal.firstName')}
            value={guestData.first_name || ''}
            onChange={(e) => handleGuestChange('first_name', e.target.value)}
            onBlur={(e) => handleBlur('first_name', e.target.value)}
            error={Boolean(touched.first_name && validationErrors.first_name)}
            helperText={touched.first_name ? validationErrors.first_name : undefined}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 4.5 }}>
          <TextField
            fullWidth
            required
            label={t('checkInForm.personal.lastName')}
            value={guestData.last_name || ''}
            onChange={(e) => handleGuestChange('last_name', e.target.value)}
            onBlur={(e) => handleBlur('last_name', e.target.value)}
            error={Boolean(touched.last_name && validationErrors.last_name)}
            helperText={touched.last_name ? validationErrors.last_name : undefined}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            fullWidth
            label={t('checkInForm.personal.email')}
            type="email"
            value={guestData.email || ''}
            disabled
            slotProps={{
              input: { readOnly: true }
            }}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            fullWidth
            type="tel"
            label={t('checkInForm.personal.phone1')}
            value={guestData.phone || ''}
            disabled
            slotProps={{
              input: { readOnly: true }
            }}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            fullWidth
            type="tel"
            label={t('checkInForm.personal.phone2')}
            value={guestData.alt_phone || ''}
            disabled
            slotProps={{
              input: { readOnly: true }
            }}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            fullWidth
            required
            label={t('checkInForm.personal.icNumber')}
            value={guestData.ic_number || ''}
            onChange={(e) => handleGuestChange('ic_number', e.target.value)}
            onBlur={(e) => handleBlur('ic_number', e.target.value)}
            error={touched.ic_number && Boolean(validationErrors.ic_number)}
            helperText={
              (touched.ic_number && validationErrors.ic_number)
              || t('checkInForm.personal.icHelper')
            }
          />
        </Grid>
        <Grid size={12}>
          <TextField
            fullWidth
            label={t('checkInForm.personal.streetAddress')}
            value={guestData.address_line1 || ''}
            disabled
            slotProps={{
              input: { readOnly: true }
            }}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            fullWidth
            label={t('checkInForm.personal.city')}
            value={guestData.city || ''}
            disabled
            slotProps={{
              input: { readOnly: true }
            }}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            fullWidth
            label={t('checkInForm.personal.stateProvince')}
            value={guestData.state_province || ''}
            disabled
            slotProps={{
              input: { readOnly: true }
            }}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            fullWidth
            label={t('checkInForm.personal.zipCode')}
            value={guestData.postal_code || ''}
            disabled
            slotProps={{
              input: { readOnly: true }
            }}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            fullWidth
            label={t('checkInForm.personal.country')}
            value={guestData.country || ''}
            disabled
            slotProps={{
              input: { readOnly: true }
            }}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            fullWidth
            label={t('checkInForm.personal.nationality')}
            value={guestData.nationality || ''}
            disabled
            slotProps={{
              input: { readOnly: true }
            }}
          />
        </Grid>
      </Grid>
  );
}

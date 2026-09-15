import React, { useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import type { BookingWithDetails } from '../../../../types';
import { emitApiNotification } from '../../../../utils/apiNotifications';
import { getErrorMessage } from '../../utils/bookingPageUtils';
import { useTranslation } from '../../../../i18n';
import { useUpdateBooking } from '../../hooks/useBookingQueries';

interface QuickEditFields {
  check_in_date: string;
  check_out_date: string;
  remarks: string;
  special_requests: string;
}

const initialFields = (booking: BookingWithDetails): QuickEditFields => ({
  check_in_date: booking.check_in_date.split('T')[0],
  check_out_date: booking.check_out_date.split('T')[0],
  remarks: booking.remarks ?? '',
  special_requests: booking.special_requests ?? '',
});

/**
 * Everything else (status, channel, company, rate, room, extra beds) stays in
 * the full Edit dialog one row of actions below; unlike that dialog this does
 * NOT re-run the room-availability picker on date changes — the backend still
 * validates conflicts. Remounted per booking via `key` so field state always
 * starts from that booking's current values.
 */
/**
 * Inline edit for the fields front-desk staff change most — stay dates and the
 * free-text notes. Shared by the /bookings drawer and the /bookings/$bookingId
 * page so the full page is not a strict subset of the preview that opens it.
 */
const BookingQuickEditSection: React.FC<{
  booking: BookingWithDetails;
  onError: (message: string) => void;
  onCompleted: () => Promise<void> | void;
}> = ({ booking, onError, onCompleted }) => {
  const { t } = useTranslation('bookings');
  const updateBooking = useUpdateBooking();
  const [fields, setFields] = useState<QuickEditFields>(() => initialFields(booking));
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    try {
      setSaving(true);
      await updateBooking.mutateAsync({
        bookingId: booking.id,
        data: {
          check_in_date: fields.check_in_date,
          check_out_date: fields.check_out_date,
          remarks: fields.remarks,
          special_requests: fields.special_requests,
        },
      });
      emitApiNotification({ severity: 'success', message: t('details.quickEditSuccess') });
      await onCompleted();
    } catch (err: unknown) {
      onError(getErrorMessage(err) || t('details.quickEditFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box sx={{ p: 2.5, borderBottom: '1px solid', borderColor: 'divider' }}>
      <Typography variant="overline" sx={{ color: 'text.secondary', fontWeight: 900 }}>
        {t('details.quickEdit')}
      </Typography>
      <Stack spacing={1.5} sx={{ mt: 1 }}>
        <Stack direction="row" spacing={1.5}>
          <TextField
            fullWidth
            size="small"
            label={t('edit.checkInDate')}
            type="date"
            value={fields.check_in_date}
            onChange={(e) => setFields((prev) => ({ ...prev, check_in_date: e.target.value }))}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            fullWidth
            size="small"
            label={t('edit.checkOutDate')}
            type="date"
            value={fields.check_out_date}
            onChange={(e) => setFields((prev) => ({ ...prev, check_out_date: e.target.value }))}
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </Stack>
        <TextField
          fullWidth
          size="small"
          label={t('edit.remarks')}
          value={fields.remarks}
          onChange={(e) => setFields((prev) => ({ ...prev, remarks: e.target.value }))}
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <TextField
          fullWidth
          size="small"
          label={t('edit.specialRequests')}
          value={fields.special_requests}
          onChange={(e) => setFields((prev) => ({ ...prev, special_requests: e.target.value }))}
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            size="small"
            variant="contained"
            onClick={handleSave}
            disabled={saving}
            startIcon={saving ? <CircularProgress size={14} /> : undefined}
          >
            {saving ? t('common:state.saving') : t('common:actions.saveChanges')}
          </Button>
        </Box>
      </Stack>
    </Box>
  );
};

export default BookingQuickEditSection;

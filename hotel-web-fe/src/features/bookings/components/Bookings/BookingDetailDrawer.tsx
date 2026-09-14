import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Drawer,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import type { BookingWithDetails } from '../../../../types';
import { emitApiNotification } from '../../../../utils/apiNotifications';
import { getErrorMessage } from '../../utils/bookingPageUtils';
import { useBooking, useUpdateBooking } from '../../hooks/useBookingQueries';
import type { BookingActionCallbacks } from '../../hooks/useBookingActions';
import BookingDetailsPanel from './BookingDetailsPanel';

interface BookingDetailDrawerProps extends BookingActionCallbacks {
  bookingId: string | null;
  open: boolean;
  onClose: () => void;
  isAdmin: boolean;
  onOpenFullDetails: (booking: BookingWithDetails) => void;
  onError: (message: string) => void;
  onCompleted: () => Promise<void> | void;
}

interface QuickEditFields {
  check_in_date: string;
  check_out_date: string;
  remarks: string;
  special_requests: string;
}

/**
 * Inline edit for the fields front-desk staff change most — stay dates and
 * free-text notes. Everything else (status, channel, company, rate, room,
 * extra beds) stays in the full Edit dialog one row of actions below; unlike
 * that dialog this does NOT re-run the room-availability picker on date
 * changes — the backend still validates conflicts.
 */
const BookingQuickEditSection: React.FC<{
  booking: BookingWithDetails;
  onError: (message: string) => void;
  onCompleted: () => Promise<void> | void;
}> = ({ booking, onError, onCompleted }) => {
  const updateBooking = useUpdateBooking();
  const [fields, setFields] = useState<QuickEditFields>({
    check_in_date: '',
    check_out_date: '',
    remarks: '',
    special_requests: '',
  });
  const [saving, setSaving] = useState(false);

  // Re-initialise when a different booking is opened.
  useEffect(() => {
    setFields({
      check_in_date: booking.check_in_date.split('T')[0],
      check_out_date: booking.check_out_date.split('T')[0],
      remarks: booking.remarks ?? '',
      special_requests: booking.special_requests ?? '',
    });
  }, [booking.id]);

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
      emitApiNotification({ severity: 'success', message: 'Booking updated successfully!' });
      await onCompleted();
    } catch (err: unknown) {
      onError(getErrorMessage(err) || 'Failed to update booking');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box sx={{ p: 2.5, borderBottom: '1px solid', borderColor: 'divider' }}>
      <Typography variant="overline" sx={{ color: 'text.secondary', fontWeight: 900 }}>
        Quick edit
      </Typography>
      <Stack spacing={1.5} sx={{ mt: 1 }}>
        <Stack direction="row" spacing={1.5}>
          <TextField
            fullWidth
            size="small"
            label="Check-In Date"
            type="date"
            value={fields.check_in_date}
            onChange={(e) => setFields((prev) => ({ ...prev, check_in_date: e.target.value }))}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            fullWidth
            size="small"
            label="Check-Out Date"
            type="date"
            value={fields.check_out_date}
            onChange={(e) => setFields((prev) => ({ ...prev, check_out_date: e.target.value }))}
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </Stack>
        <TextField
          fullWidth
          size="small"
          label="Remarks"
          value={fields.remarks}
          onChange={(e) => setFields((prev) => ({ ...prev, remarks: e.target.value }))}
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <TextField
          fullWidth
          size="small"
          label="Special Requests"
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
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </Box>
      </Stack>
    </Box>
  );
};

/**
 * Row-click surface for /bookings: the shared details panel inside a right
 * drawer, backed by useBooking(bookingId) so post-action state (check-in,
 * void, payments) refreshes even when the row leaves the current list filter.
 * The /bookings/$bookingId page stays reachable via onOpenFullDetails.
 */
const BookingDetailDrawer: React.FC<BookingDetailDrawerProps> = ({
  bookingId,
  open,
  onClose,
  isAdmin,
  onOpenFullDetails,
  onError,
  onCompleted,
  ...callbacks
}) => {
  const bookingQuery = useBooking(bookingId, open);
  const booking = bookingQuery.data;

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      slotProps={{ paper: { sx: { width: { xs: '100%', sm: 420 } } } }}
      aria-label="Booking details"
    >
      {!bookingId ? null : bookingQuery.isPending ? (
        <Box sx={{ p: 2.5, display: 'flex', justifyContent: 'center' }}>
          <CircularProgress size={24} />
        </Box>
      ) : bookingQuery.error || !booking ? (
        <Box sx={{ p: 2.5 }}>
          <Alert severity="warning">Booking details unavailable.</Alert>
        </Box>
      ) : (
        <BookingDetailsPanel
          booking={booking}
          isAdmin={isAdmin}
          onClose={onClose}
          onOpenFullDetails={onOpenFullDetails}
          quickEdit={
            isAdmin ? (
              <BookingQuickEditSection
                booking={booking}
                onError={onError}
                onCompleted={onCompleted}
              />
            ) : undefined
          }
          {...callbacks}
        />
      )}
    </Drawer>
  );
};

export default BookingDetailDrawer;

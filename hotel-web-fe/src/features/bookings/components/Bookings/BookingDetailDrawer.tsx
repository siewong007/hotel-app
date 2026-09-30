import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Drawer,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { LogoLoader } from '../../../../components';
import type { BookingWithDetails } from '../../../../types';
import { emitApiNotification } from '../../../../utils/apiNotifications';
import { getErrorMessage } from '../../utils/bookingPageUtils';
import { useTranslation } from '../../../../i18n';
import { useBooking, useUpdateBooking } from '../../hooks/useBookingQueries';
import type { BookingActionCallbacks } from '../../hooks/useBookingActions';
import BookingDetailsPanel from './BookingDetailsPanel';
import BookingQuickEditSection from './BookingQuickEditSection';

interface BookingDetailDrawerProps extends BookingActionCallbacks {
  bookingId: string | null;
  open: boolean;
  onClose: () => void;
  isAdmin: boolean;
  onOpenFullDetails: (booking: BookingWithDetails) => void;
  onError: (message: string) => void;
  onCompleted: () => Promise<void> | void;
}

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
  const { t } = useTranslation('bookings');
  const bookingQuery = useBooking(bookingId, open);
  const booking = bookingQuery.data;

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      slotProps={{
        paper: {
          sx: {
            // Fill the viewport and let BookingDetailsPanel scroll inside.
            // A height:100% + overflow:hidden child used to clip Notes and
            // Quick edit with no scrollbar. maxWidth 100% (not 100vw) keeps
            // the phone drawer from forcing the page sideways.
            width: { xs: '100%', sm: 420 },
            maxWidth: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            // Longhands, not the `overflow` shorthand: MUI's paper sets
            // overflowY: 'auto', which wins over a shorthand and leaves the
            // drawer itself as the scrollport (header scrolls away).
            overflowX: 'hidden',
            overflowY: 'hidden',
          },
        },
      }}
      aria-label={t('details.ariaLabel')}
    >
      {!bookingId ? null : bookingQuery.isPending ? (
        <LogoLoader variant="page" minHeight={120} />
      ) : bookingQuery.error || !booking ? (
        <Box sx={{ p: 2.5 }}>
          <Alert severity="warning">{t('details.unavailable')}</Alert>
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
                key={booking.id}
                booking={booking}
                onError={onError}
                onCompleted={onCompleted}
              />
            ) : undefined
          }
          {...callbacks}
          scrollWithinParent
        />
      )}
    </Drawer>
  );
};

export default BookingDetailDrawer;

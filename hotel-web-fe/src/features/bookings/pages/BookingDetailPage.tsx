import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Link as MuiLink,
} from '@mui/material';
import { ArrowBackOutlined as BackIcon } from '@mui/icons-material';
import { useAuth } from '../../../auth/AuthContext';
import { Link, useNavigate } from '../../../router';
import { useTranslation } from '../../../i18n';
import { getQueryErrorMessage } from '../../../api/queryConfig';
import PageHeader from '../../../components/common/PageHeader';
import EmptyState from '../../../components/common/EmptyState';
import LoadingSpinner from '../../../components/common/LoadingSpinner';
import BookingDetailsPanel from '../components/Bookings/BookingDetailsPanel';
import BookingQuickEditSection from '../components/Bookings/BookingQuickEditSection';
import { useBookingActions } from '../hooks/useBookingActions';
import { useBooking } from '../hooks/useBookingQueries';
import { useRooms } from '../../rooms/hooks/useRoomQueries';

interface BookingDetailPageProps {
  /** Route param — the route file passes `Route.useParams().bookingId` in
   *  here (same precedent as `GuestProfilePage` receiving `guestId`). */
  bookingId: string;
}

/**
 * `/bookings/$bookingId` — a single booking's detail surface for direct links
 * and phone navigation. Fetches the joined detail row (`BookingWithDetails`),
 * renders the same `BookingDetailsPanel` as the list page, and mounts the same
 * action dialogs through `useBookingActions`.
 */
const BookingDetailPage: React.FC<BookingDetailPageProps> = ({ bookingId }) => {
  const { hasPermission } = useAuth();
  const { t: tNav } = useTranslation('nav');
  const { t } = useTranslation('bookings');
  const navigate = useNavigate();
  const isAdmin = hasPermission('bookings:update') || hasPermission('bookings:manage');

  const bookingQuery = useBooking(bookingId);
  const roomsQuery = useRooms();
  const [pageError, setPageError] = useState<string | null>(null);
  const booking = bookingQuery.data;

  const { callbacks, dialogs } = useBookingActions({
    rooms: roomsQuery.data ?? [],
    onError: setPageError,
    onCompleted: async () => {
      await bookingQuery.refetch();
    },
  });

  const backToList = () => navigate('/bookings');
  const bookingRef = booking
    ? booking.invoice_number || booking.folio_number || booking.booking_number || `#${booking.id}`
    : '';

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, pb: 4 }}>
      <MuiLink
        component={Link}
        to="/bookings"
        underline="hover"
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.5,
          fontSize: 13,
          fontWeight: 600,
          mb: 1.5,
          color: 'text.secondary',
        }}
      >
        <BackIcon sx={{ fontSize: 15 }} />
        {tNav('mobile.backToList')}
      </MuiLink>

      {pageError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setPageError(null)}>
          {pageError}
        </Alert>
      )}

      {bookingQuery.isPending ? (
        <Box sx={{ py: 10, display: 'flex', justifyContent: 'center' }}>
          <LoadingSpinner size={36} />
        </Box>
      ) : bookingQuery.error || !booking ? (
        <EmptyState
          title={t('details.notFoundTitle')}
          description={
            getQueryErrorMessage(bookingQuery.error, t('details.loadFailed'))
            ?? t('details.notFoundHint')
          }
          action={
            <Button variant="outlined" startIcon={<BackIcon />} onClick={backToList}>
              {t('details.backToList')}
            </Button>
          }
        />
      ) : (
        <>
          <PageHeader
            kicker="Booking"
            title={booking.guest_name || bookingRef}
            subtitle={booking.guest_name ? bookingRef : undefined}
          />
          <BookingDetailsPanel
            booking={booking}
            isAdmin={isAdmin}
            onClose={backToList}
            quickEdit={
              isAdmin ? (
                <BookingQuickEditSection
                  key={booking.id}
                  booking={booking}
                  onError={setPageError}
                  onCompleted={async () => {
                    await bookingQuery.refetch();
                  }}
                />
              ) : undefined
            }
            {...callbacks}
          />
        </>
      )}

      {dialogs}
    </Box>
  );
};

export default BookingDetailPage;

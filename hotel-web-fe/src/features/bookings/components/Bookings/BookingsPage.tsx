import React, { useEffect, useState, useMemo } from 'react';
import {
  Box,
  Typography,
  Card,
  Button,
  Alert,
  Grid,
  Stack,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  Add as AddIcon,
} from '@mui/icons-material';
import {
  BookingWithDetails,
} from '../../../../types';
import { useNavigate, useSearchParams } from '../../../../router';
import { useAuth } from '../../../../auth/AuthContext';
import UnifiedBookingModal from '../../../rooms/components/UnifiedBooking';
import { getHotelSettings } from '../../../../utils/hotelSettings';
import { useBookings, PAGE_SIZE } from '../../hooks/useBookings';
import { useBookingBoardSummary } from '../../hooks/useBookingQueries';
import { useBookingActions } from '../../hooks/useBookingActions';
import { emitApiNotification } from '../../../../utils/apiNotifications';
import { getPaginationState } from '../../../../utils/pagination';
import { toMoneyNumber } from '../../../../utils/money';
import {
  buildMonthOptions,
  formatOperationalDate,
  type BookingView,
} from '../../utils/bookingPageUtils';
import BookingSummarySection from './BookingSummarySection';
import BookingFiltersBar from './BookingFiltersBar';
import BookingListPanel from './BookingListPanel';
import { useTranslation } from '../../../../i18n';
import BookingDetailDrawer from './BookingDetailDrawer';

const BookingsPage: React.FC = () => {
  const { t } = useTranslation('bookings');
  const [pageSearchParams, setPageSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const isAdmin = hasPermission('bookings:update') || hasPermission('bookings:manage');
  const [drawerBookingId, setDrawerBookingId] = useState<string | null>(null);
  const PAYMENT_METHODS = getHotelSettings().payment_methods;
  const ONLINE_CHANNELS = getHotelSettings()
    .booking_channels.map((channel) => channel.name?.trim())
    .filter((name): name is string => Boolean(name));

  const {
    bookings,
    rooms,
    loading,
    error,
    setError,
    totalBookings,
    statsData,
    sortField,
    searchQuery,
    setSearchQuery,
    roomNumberFilter,
    setRoomNumberFilter,
    paymentMethodFilter,
    setPaymentMethodFilter,
    onlineChannelFilter,
    setOnlineChannelFilter,
    statusFilter,
    setStatusFilter,
    dateFilter,
    setDateFilter,
    setCustomStartDate,
    setCustomEndDate,
    searchDate,
    setSearchDate,
    monthSearch,
    setMonthSearch,
    boardView,
    setBoardView,
    currentPage,
    setCurrentPage,
    reload: loadData,
    handleSort,
    clearFilters,
  } = useBookings();

  // The view lives in useBookings because it is a server-side filter now; this
  // alias keeps the rest of the page reading the way it did.
  const bookingView = boardView;
  const routedBookingSearch = pageSearchParams.get('search') || '';
  const routedBookingId = pageSearchParams.get('booking_id') || '';
  const createRequested = pageSearchParams.get('create') === '1';
  const routedView = pageSearchParams.get('view') || '';
  // Nine numbers from one aggregate. This replaced `useBookingsWithDetails()`,
  // which paged the entire non-voided bookings table (5 requests / ~3.1 MB
  // measured on 2,756 bookings) so the browser could reduce it to these same
  // nine values -- and did it again on every booking mutation, including ones
  // made by other staff via the data_changed socket.
  const summaryQuery = useBookingBoardSummary();
  const summary = summaryQuery.data;

  // Legacy deep link: /bookings?booking_id=<id> used to select the row and
  // auto-open the inline details panel. The /bookings/$bookingId route owns
  // the detail surface now, so redirect there instead — `replace` keeps the
  // back button on the list rather than looping through the redirect.
  useEffect(() => {
    if (!routedBookingId) return;
    navigate(`/bookings/${routedBookingId}`, { replace: true });
  }, [routedBookingId, navigate]);

  useEffect(() => {
    if (!routedBookingSearch || routedBookingId) return;

    setBoardView('all');
    setSearchQuery(routedBookingSearch);
    setRoomNumberFilter('');
    setPaymentMethodFilter('');
    setStatusFilter('all');
    setDateFilter('all');
    setCustomStartDate('');
    setCustomEndDate('');
    setSearchDate('');
    setCurrentPage(1);
  }, [
    routedBookingSearch,
    routedBookingId,
    setSearchQuery,
    setRoomNumberFilter,
    setPaymentMethodFilter,
    setStatusFilter,
    setDateFilter,
    setCustomStartDate,
    setCustomEndDate,
    setSearchDate,
    setCurrentPage,
    setBoardView,
  ]);

  // Deep link: ?view=arriving|departing|in_house|upcoming|balance selects the
  // same summary-strip views (quick actions + dashboard "View all" links).
  useEffect(() => {
    const valid: BookingView[] = [
      'all', 'arriving', 'in_house', 'departing', 'upcoming',
      'balance', 'normal_balance', 'company_balance',
    ];
    if (valid.includes(routedView as BookingView)) {
      setBoardView(routedView as BookingView);
    }
  }, [routedView, setBoardView]);

  // Create booking dialog (using UnifiedBookingModal)
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  // Deep link: ?create=1 opens the create dialog (sidebar CTA / command
  // palette navigate to /bookings?create=1). The param is stripped on close so
  // refresh or history navigation doesn't re-trigger it.
  useEffect(() => {
    if (createRequested) setCreateDialogOpen(true);
  }, [createRequested]);

  const closeCreateDialog = () => {
    setCreateDialogOpen(false);
    if (createRequested) {
      const next = new URLSearchParams(pageSearchParams);
      next.delete('create');
      setPageSearchParams(next, { replace: true });
    }
  };

  const showSnackbar = (message: string) => {
    emitApiNotification({ message, severity: 'success' });
  };

  const reloadBookingData = async () => {
    await Promise.all([loadData(), summaryQuery.refetch()]);
  };

  // Row clicks open the detail drawer; the shared hook's callbacks drive the
  // drawer's action buttons while its dialogs stay mounted at page level (and
  // the create flow's onBookingCreated routes into the Check-In dialog).
  const {
    callbacks: bookingActionCallbacks,
    dialogs: bookingActionDialogs,
    openCheckInDialog,
  } = useBookingActions({
    rooms,
    onError: setError,
    onCompleted: reloadBookingData,
  });

  // Server handles all filtering and sorting — bookings is already the correct page
  const filteredAndSortedBookings = bookings;

  // Statistics — use server-side stats for global accuracy
  const todayCheckIns = statsData.today_check_ins;

  const monthOptions = useMemo(() => buildMonthOptions(), []);

  const bookingPagination = useMemo(
    () => getPaginationState({ page: currentPage, pageSize: PAGE_SIZE, totalItems: totalBookings }),
    [currentPage, totalBookings]
  );

  // The server applies the view, so the page it returns IS the view. The old
  // code filtered a full-table fetch client-side while ALSO setting server
  // filters, which left the paginator describing a different set of rows than
  // the list showed.
  const visibleBookings = filteredAndSortedBookings;

  const roomCount = rooms.length || 0;
  const totalGuestsInHouse = summary?.guests_in_house ?? 0;
  const normalOutstandingDue = toMoneyNumber(summary?.normal_due_amount ?? 0);
  const companyOutstandingDue = toMoneyNumber(summary?.company_due_amount ?? 0);
  const companyOutstandingMonths = summary?.company_outstanding_months ?? 1;
  // Counts are whole-dataset now, never "this page only".
  const normalBalanceScope = t('page.scopeAll');
  const companyBalanceScope = t('page.scopeCompanyAll', { months: companyOutstandingMonths });

  const selectBookingView = (view: BookingView) => {
    // The view is the filter. It no longer sets status/date filters as a proxy:
    // those could not express "arriving today" or "past checkout with a balance"
    // and disagreed with the counts on the cards.
    if (view === 'all') {
      clearFilters();
      return;
    }
    setBoardView(view);
  };

  const handleTakePaymentAction = () => {
    // Open the outstanding-balance view. This used to jump straight to
    // `normalDueBookings[0]` from the full-table fetch; with the view resolved
    // server-side the rows arrive after this returns, and picking a guest to
    // charge is the clerk's call anyway.
    selectBookingView('normal_balance');
  };

  const hasActiveFilters = Boolean(
    searchQuery || roomNumberFilter || paymentMethodFilter || onlineChannelFilter || statusFilter !== 'all' || dateFilter !== 'all'
  );

  return (
    <Box sx={{ pb: 4 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: { xs: 'flex-start', md: 'center' }, gap: 2, mb: 3, flexDirection: { xs: 'column', md: 'row' } }}>
        <Box>
          <Typography variant="overline" sx={{ color: 'text.secondary', fontWeight: 900, letterSpacing: 2 }}>
            {t('page.kicker', { date: formatOperationalDate() })}
          </Typography>
          <Typography variant="h4" sx={{ fontWeight: 900, color: 'text.primary', lineHeight: 1.05 }}>
            {t('title')}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={reloadBookingData}
            sx={{ minHeight: 44 }}
          >
            {t('common:actions.refresh')}
          </Button>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setCreateDialogOpen(true)}
            disabled={rooms.length === 0}
            sx={{ minHeight: 44, px: 2.5, bgcolor: 'primary.main', '&:hover': { bgcolor: 'primary.dark' } }}
          >
            {t('page.newBooking')}
          </Button>
        </Stack>
      </Box>
      {error && (
        <Alert
          severity="error"
          sx={{ mb: 3 }}
          action={
            <Button color="inherit" size="small" onClick={reloadBookingData}>
              {t('common:actions.retry')}
            </Button>
          }
        >
          {error}
        </Alert>
      )}
      <BookingSummarySection
        stats={{
          arrivingCount: summary?.arriving ?? 0,
          readyToCheckInCount: summary?.ready_to_check_in ?? 0,
          todayCheckIns,
          totalGuestsInHouse,
          inHouseCount: summary?.in_house ?? 0,
          roomCount,
          departingCount: summary?.departing ?? 0,
          upcomingCount: summary?.upcoming ?? 0,
          normalOutstandingDue,
          normalDueCount: summary?.normal_due ?? 0,
          normalBalanceScope,
          companyOutstandingDue,
          companyDueCount: summary?.company_due ?? 0,
          companyBalanceScope,
        }}
        activeView={bookingView}
        onSelectView={selectBookingView}
        onTakePayment={handleTakePaymentAction}
      />
      <Grid container spacing={2.5} sx={{
        alignItems: "stretch"
      }}>
        <Grid size={{ xs: 12 }}>
          <Card elevation={0} sx={{ overflow: 'hidden', height: '100%' }}>
            <BookingFiltersBar
              searchQuery={searchQuery}
              onSearchQueryChange={setSearchQuery}
              paymentMethodFilter={paymentMethodFilter}
              onPaymentMethodFilterChange={(value) => {
                setPaymentMethodFilter(value);
                setBoardView('all');
              }}
              onlineChannelFilter={onlineChannelFilter}
              onOnlineChannelFilterChange={(value) => {
                setOnlineChannelFilter(value);
                setBoardView('all');
              }}
              searchDate={searchDate}
              onSearchDateChange={(value) => {
                setSearchDate(value);
                setDateFilter(value ? 'date_search' : 'all');
                setBoardView('all');
                setCurrentPage(1);
              }}
              onClearSearchDate={() => {
                setSearchDate('');
                setDateFilter('all');
                setCurrentPage(1);
              }}
              monthSearch={monthSearch}
              onMonthSearchChange={(value) => {
                setMonthSearch(value);
                setDateFilter(value ? 'calendar_month' : 'all');
                setBoardView('all');
                setCurrentPage(1);
              }}
              onClearMonthSearch={() => {
                setMonthSearch('');
                setDateFilter('all');
                setCurrentPage(1);
              }}
              bookingView={bookingView}
              onSelectView={selectBookingView}
              viewCounts={{
                all: totalBookings || bookings.length,
                arriving: summary?.arriving ?? 0,
                inHouse: summary?.in_house ?? 0,
                upcoming: summary?.upcoming ?? 0,
                // `balance` is the union of the two disjoint buckets.
                due: (summary?.normal_due ?? 0) + (summary?.company_due ?? 0),
                normalDue: summary?.normal_due ?? 0,
                companyDue: summary?.company_due ?? 0,
              }}
              hasActiveFilters={hasActiveFilters}
              onClearFilters={() => {
                setBoardView('all');
                clearFilters();
              }}
              paymentMethods={PAYMENT_METHODS}
              onlineChannels={ONLINE_CHANNELS}
              monthOptions={monthOptions}
            />
            <BookingListPanel
              bookings={visibleBookings}
              loading={loading}
              totalBookings={totalBookings}
              bookingView={bookingView}
              onOpenBooking={(booking) => setDrawerBookingId(String(booking.id))}
              sortField={sortField}
              onToggleSort={() => handleSort(sortField === 'check_in_date' ? 'guest_name' : 'check_in_date')}
              pagination={bookingPagination}
              onPageChange={setCurrentPage}
            />
          </Card>
        </Grid>
      </Grid>
      {/* Create Booking Modal (Unified) */}
      <UnifiedBookingModal
        open={createDialogOpen}
        onClose={closeCreateDialog}
        room={null}
        rooms={rooms}
        onSuccess={(message) => {
          showSnackbar(message);
        }}
        onError={(message) => {
          setError(message);
        }}
        onRefreshData={reloadBookingData}
        onBookingCreated={(booking, guest) => {
          // Direct booking: open Enhanced Check-In modal
          const selectedRoom = rooms.find(r => r.id === booking.room_id);
          const bookingWithDetails: BookingWithDetails = {
            id: booking.id,
            booking_number: booking.folio_number || '',
            folio_number: booking.folio_number,
            guest_id: String(guest.id),
            guest_name: guest.nick_name,
            guest_email: guest.email || '',
            guest_type: guest.guest_type,
            room_id: booking.room_id,
            room_number: selectedRoom?.room_number || '',
            room_type: selectedRoom?.room_type || booking.room_type || '',
            room_type_code: '',
            check_in_date: booking.check_in_date,
            check_out_date: booking.check_out_date,
            price_per_night: selectedRoom?.price_per_night || 0,
            total_amount: booking.total_amount,
            status: booking.status,
            payment_status: 'unpaid',
            payment_method: booking.payment_method,
            source: 'walk_in',
            remarks: '',
            is_complimentary: false,
            deposit_paid: false,
            deposit_amount: 0,
            room_card_deposit: 0, // deprecated but kept for type compatibility
            created_at: booking.created_at,
            is_posted: false,
          };
          openCheckInDialog(bookingWithDetails);
        }}
      />
      <BookingDetailDrawer
        bookingId={drawerBookingId}
        open={Boolean(drawerBookingId)}
        onClose={() => setDrawerBookingId(null)}
        isAdmin={isAdmin}
        onOpenFullDetails={(booking) => navigate(`/bookings/${booking.id}`)}
        onError={setError}
        onCompleted={reloadBookingData}
        {...bookingActionCallbacks}
      />
      {/* Booking-action dialogs stay mounted via the shared hook — MUI Dialogs
          layer above the Drawer, so drawer actions reuse them as-is. */}
      {bookingActionDialogs}
    </Box>
  );
};

export default BookingsPage;

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
import { useBookingsWithDetails } from '../../hooks/useBookingQueries';
import { useBookingActions } from '../../hooks/useBookingActions';
import { emitApiNotification } from '../../../../utils/apiNotifications';
import { getPaginationState } from '../../../../utils/pagination';
import { formatLocalDate } from '../../../../utils/date';
import { sumMoney } from '../../../../utils/money';
import {
  COMPANY_OUTSTANDING_MONTHS_AFTER_CHECKOUT,
  buildMonthOptions,
  canCheckIn,
  formatOperationalDate,
  getBookingBalance,
  getBookingViewSlices,
  type BookingView,
} from '../../utils/bookingPageUtils';
import BookingSummarySection from './BookingSummarySection';
import BookingFiltersBar from './BookingFiltersBar';
import BookingListPanel from './BookingListPanel';
import BookingDetailDrawer from './BookingDetailDrawer';

const BookingsPage: React.FC = () => {
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
    guests,
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
    currentPage,
    setCurrentPage,
    loadGuests,
    reload: loadData,
    handleSort,
    clearFilters,
  } = useBookings();

  const [bookingView, setBookingView] = useState<BookingView>('all');
  const routedBookingSearch = pageSearchParams.get('search') || '';
  const routedBookingId = pageSearchParams.get('booking_id') || '';
  const createRequested = pageSearchParams.get('create') === '1';
  const routedView = pageSearchParams.get('view') || '';
  const summaryBookingsQuery = useBookingsWithDetails();
  const summaryBookings = summaryBookingsQuery.data ?? [];
  const summaryLoaded = summaryBookingsQuery.isSuccess;

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

    setBookingView('all');
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
  ]);

  // Deep link: ?view=arriving|departing|in_house|upcoming|balance selects the
  // same summary-strip views (quick actions + dashboard "View all" links).
  useEffect(() => {
    const valid: BookingView[] = [
      'all', 'arriving', 'in_house', 'departing', 'upcoming',
      'balance', 'normal_balance', 'company_balance',
    ];
    if (valid.includes(routedView as BookingView)) {
      setBookingView(routedView as BookingView);
    }
  }, [routedView]);

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
    await Promise.all([loadData(), summaryBookingsQuery.refetch()]);
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
    bookings,
    summaryBookings,
    onError: setError,
    onCompleted: reloadBookingData,
  });

  // Server handles all filtering and sorting — bookings is already the correct page
  const filteredAndSortedBookings = bookings;

  // Statistics — use server-side stats for global accuracy
  const todayCheckIns = statsData.today_check_ins;

  const todayIso = useMemo(() => formatLocalDate(), []);

  const monthOptions = useMemo(() => buildMonthOptions(), []);

  const operationsBookings = summaryLoaded ? summaryBookings : bookings;
  const bookingPagination = useMemo(
    () => getPaginationState({ page: currentPage, pageSize: PAGE_SIZE, totalItems: totalBookings }),
    [currentPage, totalBookings]
  );

  const slices = useMemo(
    () => getBookingViewSlices(operationsBookings, todayIso),
    [operationsBookings, todayIso]
  );
  const {
    arriving: arrivingBookings,
    departing: departingBookings,
    inHouse: inHouseBookings,
    upcoming: upcomingBookings,
    due: dueBookings,
    normalDue: normalDueBookings,
    companyDue: companyDueBookings,
  } = slices;

  const visibleBookings = useMemo(() => {
    if (bookingView === 'arriving') return arrivingBookings;
    if (bookingView === 'in_house') return inHouseBookings;
    if (bookingView === 'departing') return departingBookings;
    if (bookingView === 'upcoming') return upcomingBookings;
    if (bookingView === 'balance') return dueBookings;
    if (bookingView === 'normal_balance') return normalDueBookings;
    if (bookingView === 'company_balance') return companyDueBookings;
    return filteredAndSortedBookings;
  }, [arrivingBookings, bookingView, companyDueBookings, departingBookings, dueBookings, filteredAndSortedBookings, inHouseBookings, normalDueBookings, upcomingBookings]);

  const totalGuestsInHouse = inHouseBookings.reduce((sum, booking) => sum + Number(booking.adults || 1) + Number(booking.children || 0), 0);
  const roomCount = rooms.length || 0;
  const normalOutstandingDue = normalDueBookings.reduce((sum, booking) => sumMoney([sum, getBookingBalance(booking)]), 0);
  const companyOutstandingDue = companyDueBookings.reduce((sum, booking) => sumMoney([sum, getBookingBalance(booking)]), 0);
  const normalBalanceScope = summaryLoaded ? 'past checkout date' : 'past checkout date on this page';
  const companyBalanceScope = summaryLoaded ? `past ${COMPANY_OUTSTANDING_MONTHS_AFTER_CHECKOUT} month from checkout` : `past ${COMPANY_OUTSTANDING_MONTHS_AFTER_CHECKOUT} month from checkout on this page`;

  const selectBookingView = (view: BookingView) => {
    setBookingView(view);
    setCurrentPage(1);
    if (view === 'all') {
      clearFilters();
    } else if (view === 'arriving') {
      setDateFilter('today');
      setStatusFilter('all');
      setSearchDate('');
    } else if (view === 'in_house') {
      setStatusFilter('checked_in');
      setDateFilter('all');
      setSearchDate('');
    } else if (view === 'departing') {
      setStatusFilter('checked_in');
      setDateFilter('date_search');
      setSearchDate(todayIso);
    } else if (view === 'upcoming') {
      setStatusFilter('confirmed');
      setDateFilter('month');
      setSearchDate('');
    } else if (view === 'balance' || view === 'normal_balance' || view === 'company_balance') {
      setStatusFilter('all');
      setDateFilter('all');
      setSearchDate('');
    }
  };

  const handleTakePaymentAction = () => {
    selectBookingView('normal_balance');
    // Straight into the first outstanding booking's detail page — the payment
    // action lives there now that the inline panel is gone.
    const firstDue = normalDueBookings[0];
    if (firstDue) navigate(`/bookings/${firstDue.id}`);
  };

  const hasActiveFilters = Boolean(
    searchQuery || roomNumberFilter || paymentMethodFilter || onlineChannelFilter || statusFilter !== 'all' || dateFilter !== 'all'
  );

  return (
    <Box sx={{ pb: 4 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: { xs: 'flex-start', md: 'center' }, gap: 2, mb: 3, flexDirection: { xs: 'column', md: 'row' } }}>
        <Box>
          <Typography variant="overline" sx={{ color: 'text.secondary', fontWeight: 900, letterSpacing: 2 }}>
            Front Desk · {formatOperationalDate()}
          </Typography>
          <Typography variant="h4" sx={{ fontWeight: 900, color: 'text.primary', lineHeight: 1.05 }}>
            Bookings
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={reloadBookingData}
            sx={{ minHeight: 44 }}
          >
            Refresh
          </Button>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => {
              setCreateDialogOpen(true);
              // Refresh the guest list so recently-added guests are searchable
              // in the modal (the cached list may predate them otherwise).
              loadGuests();
            }}
            disabled={rooms.length === 0}
            sx={{ minHeight: 44, px: 2.5, bgcolor: 'primary.main', '&:hover': { bgcolor: 'primary.dark' } }}
          >
            New booking
          </Button>
        </Stack>
      </Box>
      {error && (
        <Alert
          severity="error"
          sx={{ mb: 3 }}
          action={
            <Button color="inherit" size="small" onClick={reloadBookingData}>
              Retry
            </Button>
          }
        >
          {error}
        </Alert>
      )}
      <BookingSummarySection
        stats={{
          arrivingCount: arrivingBookings.length,
          readyToCheckInCount: arrivingBookings.filter(canCheckIn).length,
          todayCheckIns,
          totalGuestsInHouse,
          inHouseCount: inHouseBookings.length,
          roomCount,
          departingCount: departingBookings.length,
          upcomingCount: upcomingBookings.length,
          normalOutstandingDue,
          normalDueCount: normalDueBookings.length,
          normalBalanceScope,
          companyOutstandingDue,
          companyDueCount: companyDueBookings.length,
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
                setBookingView('all');
              }}
              onlineChannelFilter={onlineChannelFilter}
              onOnlineChannelFilterChange={(value) => {
                setOnlineChannelFilter(value);
                setBookingView('all');
              }}
              searchDate={searchDate}
              onSearchDateChange={(value) => {
                setSearchDate(value);
                setDateFilter(value ? 'date_search' : 'all');
                setBookingView('all');
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
                setBookingView('all');
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
                arriving: arrivingBookings.length,
                inHouse: inHouseBookings.length,
                upcoming: upcomingBookings.length,
                due: dueBookings.length,
                normalDue: normalDueBookings.length,
                companyDue: companyDueBookings.length,
              }}
              hasActiveFilters={hasActiveFilters}
              onClearFilters={() => {
                setBookingView('all');
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
        guests={guests}
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

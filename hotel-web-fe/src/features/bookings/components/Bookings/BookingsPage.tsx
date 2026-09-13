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
  BookingTimelineEntry,
  BookingWithDetails,
  PaymentWorkflowSummary,
} from '../../../../types';
import { useAuth } from '../../../../auth/AuthContext';
import { useSearchParams } from '../../../../router';
import CheckoutInvoiceModals from '../../../invoices/components/CheckoutInvoiceModals';
import { useCheckoutFlow } from '../../../invoices/hooks/useCheckoutFlow';
import { LedgerService } from '../../../../api/ledger.service';
import UnifiedBookingModal from '../../../rooms/components/UnifiedBooking';
import { getHotelSettings } from '../../../../utils/hotelSettings';
import { useBookings, PAGE_SIZE } from '../../hooks/useBookings';
import {
  useBookingWorkflowFetcher,
  useBookingsWithDetails,
  useUpdateBooking,
} from '../../hooks/useBookingQueries';
import { emitApiNotification } from '../../../../utils/apiNotifications';
import { getPaginationState } from '../../../../utils/pagination';
import { formatLocalDate } from '../../../../utils/date';
import { isPositiveMoney, sumMoney } from '../../../../utils/money';
import {
  COMPANY_OUTSTANDING_MONTHS_AFTER_CHECKOUT,
  buildMonthOptions,
  canCheckIn,
  formatOperationalDate,
  getBookingBalance,
  getBookingViewSlices,
  getErrorMessage,
  isCompanyBooking,
  type BookingView,
} from '../../utils/bookingPageUtils';
import BookingSummarySection from './BookingSummarySection';
import BookingFiltersBar from './BookingFiltersBar';
import BookingListPanel from './BookingListPanel';
import BookingDetailsPanel from './BookingDetailsPanel';
import WorkflowDialog from './dialogs/WorkflowDialog';
import ReleaseDialog from './dialogs/ReleaseDialog';
import VoidDialog from './dialogs/VoidDialog';
import ReactivateDialog from './dialogs/ReactivateDialog';
import PaymentDialog, { type PaymentDialogContext } from './dialogs/PaymentDialog';
import CheckInDialog from './dialogs/CheckInDialog';
import EditBookingDialog from './dialogs/EditBookingDialog';

const BookingsPage: React.FC = () => {
  const [pageSearchParams, setPageSearchParams] = useSearchParams();
  const { hasPermission } = useAuth();
  const PAYMENT_METHODS = getHotelSettings().payment_methods;
  const ONLINE_CHANNELS = getHotelSettings()
    .booking_channels.map((channel) => channel.name?.trim())
    .filter((name): name is string => Boolean(name));
  const isAdmin = hasPermission('bookings:update') || hasPermission('bookings:manage');
  const updateBookingMutation = useUpdateBooking();

  // Shared checkout + read-only receipt flow. Bookings keeps its react-query
  // mutation (cache invalidation) and lets the backend mark the room dirty.
  const checkoutFlow = useCheckoutFlow({
    updateBooking: (bookingId, data) => updateBookingMutation.mutateAsync({ bookingId: String(bookingId), data }),
    setRoomDirty: false,
    onAfterCheckout: () => reloadBookingData(),
    successMessage: () => 'Guest checked out successfully!',
    notify: (message) => showSnackbar(message),
  });

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

  const [checkinBooking, setCheckinBooking] = useState<BookingWithDetails | null>(null);
  const [showCheckinModal, setShowCheckinModal] = useState(false);
  const [workflowDialogOpen, setWorkflowDialogOpen] = useState(false);
  const [workflowBooking, setWorkflowBooking] = useState<BookingWithDetails | null>(null);
  const [workflowSummary, setWorkflowSummary] = useState<PaymentWorkflowSummary | null>(null);
  const [workflowTimeline, setWorkflowTimeline] = useState<BookingTimelineEntry[]>([]);
  const [workflowLoading, setWorkflowLoading] = useState(false);
  const [selectedBookingId, setSelectedBookingId] = useState<string | number | null>(null);
  const [bookingDetailsOpen, setBookingDetailsOpen] = useState(true);
  const [bookingView, setBookingView] = useState<BookingView>('all');
  const routedBookingSearch = pageSearchParams.get('search') || '';
  const routedBookingId = pageSearchParams.get('booking_id') || '';
  const createRequested = pageSearchParams.get('create') === '1';
  const summaryBookingsQuery = useBookingsWithDetails();
  const fetchBookingWorkflow = useBookingWorkflowFetcher();
  const summaryBookings = summaryBookingsQuery.data ?? [];
  const summaryLoaded = summaryBookingsQuery.isSuccess;

  useEffect(() => {
    if (!routedBookingSearch && !routedBookingId) return;

    const nextSearch = routedBookingSearch || routedBookingId;
    setBookingView('all');
    setSearchQuery(nextSearch);
    setRoomNumberFilter('');
    setPaymentMethodFilter('');
    setStatusFilter('all');
    setDateFilter('all');
    setCustomStartDate('');
    setCustomEndDate('');
    setSearchDate('');
    setCurrentPage(1);
    if (routedBookingId) {
      setSelectedBookingId(routedBookingId);
      setBookingDetailsOpen(true);
    }
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

  // Edit booking dialog (admin only)
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingBooking, setEditingBooking] = useState<BookingWithDetails | null>(null);

  // Release / void / reactivate dialogs
  const [releaseDialogOpen, setReleaseDialogOpen] = useState(false);
  const [releasingBooking, setReleasingBooking] = useState<BookingWithDetails | null>(null);
  const [voidDialogOpen, setVoidDialogOpen] = useState(false);
  const [voidingBooking, setVoidingBooking] = useState<BookingWithDetails | null>(null);
  const [reactivateDialogOpen, setReactivateDialogOpen] = useState(false);
  const [reactivatingBooking, setReactivatingBooking] = useState<BookingWithDetails | null>(null);

  // Payment status update dialog
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [paymentBooking, setPaymentBooking] = useState<BookingWithDetails | null>(null);
  const [paymentDialogContext, setPaymentDialogContext] = useState<PaymentDialogContext>('manual');

  const showSnackbar = (message: string) => {
    emitApiNotification({ message, severity: 'success' });
  };

  const reloadBookingData = async () => {
    await Promise.all([loadData(), summaryBookingsQuery.refetch()]);
  };

  // Server handles all filtering and sorting — bookings is already the correct page
  const filteredAndSortedBookings = bookings;

  const handleEditBooking = (booking: BookingWithDetails) => {
    setEditingBooking(booking);
    setEditDialogOpen(true);
  };

  const handleReleaseBooking = (booking: BookingWithDetails) => {
    setReleasingBooking(booking);
    setReleaseDialogOpen(true);
  };

  const handleVoidBooking = (booking: BookingWithDetails) => {
    setVoidingBooking(booking);
    setVoidDialogOpen(true);
  };

  const handleReactivateBooking = (booking: BookingWithDetails) => {
    setReactivatingBooking(booking);
    setReactivateDialogOpen(true);
  };

  // Payment status handlers
  const handleUpdatePaymentStatus = (booking: BookingWithDetails) => {
    setPaymentBooking(booking);
    setPaymentDialogContext('manual');
    setPaymentDialogOpen(true);
  };

  // Check-in functions
  const handleCheckIn = async (bookingId: string) => {
    const booking = bookings.find(b => String(b.id) === String(bookingId)) ||
      summaryBookings.find(b => String(b.id) === String(bookingId));
    if (!booking) {
      setError('Booking not found');
      return;
    }
    setCheckinBooking(booking);
    setShowCheckinModal(true);
  };

  // View invoice for checked-out bookings. For company city-ledger bookings the
  // payments live on the customer ledger (not the booking `payments` table), so
  // look up the backing room-charge ledger and pass it through — the invoice
  // then renders the ledger's payment history, same as the ledger page.
  const handleViewInvoice = async (booking: BookingWithDetails) => {
    const isCompanyBilling = isCompanyBooking(booking);
    if (!isCompanyBilling) {
      checkoutFlow.openReceipt(booking);
      return;
    }
    try {
      const ledger = await LedgerService.getRoomChargeLedgerForBooking(
        Number(booking.id),
        booking.room_number,
      );
      checkoutFlow.openReceipt(booking, ledger);
    } catch {
      // Fall back to the booking-sourced receipt if the ledger lookup fails.
      checkoutFlow.openReceipt(booking);
    }
  };

  const handleViewWorkflow = async (booking: BookingWithDetails) => {
    setWorkflowBooking(booking);
    setWorkflowDialogOpen(true);
    setWorkflowLoading(true);
    setWorkflowSummary(null);
    setWorkflowTimeline([]);

    try {
      const [summary, timeline] = await fetchBookingWorkflow(booking.id);
      setWorkflowSummary(summary);
      setWorkflowTimeline(timeline);
    } catch (err: unknown) {
      setError(getErrorMessage(err) || 'Failed to load booking workflow');
    } finally {
      setWorkflowLoading(false);
    }
  };

  // Check-out functions
  const handleCheckOut = (booking: BookingWithDetails) => {
    const balanceDue = getBookingBalance(booking);
    if (isPositiveMoney(balanceDue) && !isCompanyBooking(booking)) {
      setPaymentBooking(booking);
      setPaymentDialogContext('checkout_required');
      setPaymentDialogOpen(true);
      return;
    }

    checkoutFlow.openCheckout(booking);
  };

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

  const selectedBooking = useMemo(() => {
    if (!bookingDetailsOpen) return null;
    if (selectedBookingId == null) return visibleBookings[0] || null;
    return visibleBookings.find((booking) => String(booking.id) === String(selectedBookingId)) || visibleBookings[0] || null;
  }, [bookingDetailsOpen, selectedBookingId, visibleBookings]);

  useEffect(() => {
    if (!bookingDetailsOpen) return;
    if (visibleBookings.length === 0) {
      setSelectedBookingId(null);
      return;
    }
    if (!selectedBookingId || !visibleBookings.some((booking) => String(booking.id) === String(selectedBookingId))) {
      setSelectedBookingId(visibleBookings[0].id);
    }
  }, [bookingDetailsOpen, selectedBookingId, visibleBookings]);

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
    if (normalDueBookings.length > 0) {
      setSelectedBookingId(normalDueBookings[0].id);
      setBookingDetailsOpen(true);
    }
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
            sx={{ minHeight: 44, px: 2.5, bgcolor: '#2f6f52', '&:hover': { bgcolor: '#255a42' } }}
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
        <Grid size={{ xs: 12, lg: selectedBooking ? 8 : 12 }}>
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
              selectedBooking={selectedBooking}
              onSelectBooking={(booking) => {
                setSelectedBookingId(booking.id);
                setBookingDetailsOpen(true);
              }}
              sortField={sortField}
              onToggleSort={() => handleSort(sortField === 'check_in_date' ? 'guest_name' : 'check_in_date')}
              pagination={bookingPagination}
              onPageChange={setCurrentPage}
            />
          </Card>
        </Grid>

        {selectedBooking && (
        <Grid size={{ xs: 12, lg: 4 }}>
          <BookingDetailsPanel
            booking={selectedBooking}
            isAdmin={isAdmin}
            onClose={() => {
              setSelectedBookingId(null);
              setBookingDetailsOpen(false);
            }}
            onCheckIn={handleCheckIn}
            onCheckOut={handleCheckOut}
            onPayment={handleUpdatePaymentStatus}
            onWorkflow={handleViewWorkflow}
            onEdit={handleEditBooking}
            onInvoice={handleViewInvoice}
            onRelease={handleReleaseBooking}
            onVoid={handleVoidBooking}
            onReactivate={handleReactivateBooking}
          />
        </Grid>
        )}
      </Grid>
      {/* Booking Workflow Dialog */}
      <WorkflowDialog
        open={workflowDialogOpen}
        booking={workflowBooking}
        summary={workflowSummary}
        timeline={workflowTimeline}
        loading={workflowLoading}
        onClose={() => setWorkflowDialogOpen(false)}
      />
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
          setCheckinBooking(bookingWithDetails);
          setShowCheckinModal(true);
        }}
      />
      {/* Edit Booking Dialog (Admin Only) */}
      <EditBookingDialog
        open={editDialogOpen}
        booking={editingBooking}
        rooms={rooms}
        onClose={() => setEditDialogOpen(false)}
        onError={setError}
        onCompleted={reloadBookingData}
      />
      <ReleaseDialog
        open={releaseDialogOpen}
        booking={releasingBooking}
        onClose={() => setReleaseDialogOpen(false)}
        onError={setError}
        onCompleted={reloadBookingData}
      />
      <VoidDialog
        open={voidDialogOpen}
        booking={voidingBooking}
        onClose={() => setVoidDialogOpen(false)}
        onError={setError}
        onCompleted={reloadBookingData}
      />
      {/* Reactivate Booking Dialog */}
      <ReactivateDialog
        open={reactivateDialogOpen}
        booking={reactivatingBooking}
        onClose={() => setReactivateDialogOpen(false)}
        onError={setError}
        onCompleted={reloadBookingData}
      />
      <PaymentDialog
        open={paymentDialogOpen}
        booking={paymentBooking}
        context={paymentDialogContext}
        onClose={() => {
          setPaymentDialogOpen(false);
          setPaymentBooking(null);
          setPaymentDialogContext('manual');
        }}
        onError={setError}
        onCompleted={reloadBookingData}
      />
      {/* Checkout Invoice Modal */}
      {/* Shared checkout + read-only receipt modals */}
      <CheckoutInvoiceModals
        flow={checkoutFlow}
        onReceiptPaymentsChanged={() => { void reloadBookingData(); }}
      />
      {/* Check-In Dialog */}
      <CheckInDialog
        open={showCheckinModal}
        booking={checkinBooking}
        onClose={() => { setShowCheckinModal(false); setCheckinBooking(null); }}
        onError={setError}
        onCompleted={reloadBookingData}
      />
    </Box>
  );
};

export default BookingsPage;

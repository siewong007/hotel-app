import React, { useState, useMemo } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Paper,
  Chip,
  Alert,
  CircularProgress,
  Button,
  IconButton,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  MenuItem,
  Grid,
  Divider,
  Checkbox,
  FormControlLabel,
  FormGroup,
  TextField as SearchField,
  InputAdornment,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  EventNote as BookingIcon,
  Receipt as ReceiptIcon,
  CardGiftcard as CreditIcon,
  HotelOutlined as RoomIcon,
  Redeem as GiftIcon,
  Search as SearchIcon,
  Cancel as CancelIcon,
} from '@mui/icons-material';
import { BookingWithDetails } from '../../../types';
import { DataTable, type ColumnDef } from '../../../components';
import { BookingsService } from '../../../api';
import InvoiceModal from '../../invoices/components/InvoiceModal';
import { useBookWithCreditsMutation, useMyBookings } from '../hooks/useBookingQueries';
import { useMyGuestsWithCredits } from '../../guests/hooks/useGuestQueries';
import { useRooms } from '../../rooms/hooks/useRoomQueries';
import { formatLocalDate, parseLocalDate, addLocalDays } from '../../../utils/date';
import { toMoneyNumber } from '../../../utils/money';

// Type for guest with credits by room type
interface GuestWithCredits {
  id: number;
  full_name: string;
  email: string;
  total_complimentary_credits: number;
  credits_by_room_type: {
    room_type_id: number;
    room_type_name: string;
    room_type_code: string;
    nights_available: number;
  }[];
}

const MyBookingsPage: React.FC = () => {
  const [error, setError] = useState<string | null>(null);
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false);
  const [selectedBookingId, setSelectedBookingId] = useState<string>('');
  const [bookingToCancel, setBookingToCancel] = useState<BookingWithDetails | null>(null);
  const [cancellingBooking, setCancellingBooking] = useState(false);

  // Complimentary credits state - now with room type breakdown
  const myBookingsQuery = useMyBookings();
  const guestsWithCreditsQuery = useMyGuestsWithCredits();
  const roomsQuery = useRooms(false);
  const bookWithCreditsMutation = useBookWithCreditsMutation();
  const bookings = myBookingsQuery.data ?? [];
  const loading = myBookingsQuery.isPending;
  const queryError = myBookingsQuery.error instanceof Error ? myBookingsQuery.error.message : null;
  const pageError = error || queryError;
  const guestsWithCredits = (guestsWithCreditsQuery.data ?? []) as GuestWithCredits[];
  const guestsLoading = guestsWithCreditsQuery.isPending;
  const rooms = (roomsQuery.data ?? []).filter(room => room.available || room.status === 'available');
  const roomsLoading = roomsQuery.isFetching;

  // Book with credits modal state
  const [bookingModalOpen, setBookingModalOpen] = useState(false);
  const [selectedGuest, setSelectedGuest] = useState<GuestWithCredits | null>(null);
  const [bookingForm, setBookingForm] = useState({
    room_id: '',
    check_in_date: '',
    check_out_date: '',
    adults: 1,
    children: 0,
    special_requests: '',
  });
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [bookingSubmitting, setBookingSubmitting] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [bookingSuccess, setBookingSuccess] = useState<string | null>(null);

  const loadMyBookings = async () => {
    setError(null);
    await myBookingsQuery.refetch();
  };

  const loadGuestsWithCredits = async () => {
    await guestsWithCreditsQuery.refetch();
  };

  const loadAvailableRooms = async () => {
    await roomsQuery.refetch();
  };

  const handleOpenBookingModal = (guest: GuestWithCredits) => {
    setSelectedGuest(guest);
    setBookingForm({
      room_id: '',
      check_in_date: '',
      check_out_date: '',
      adults: 1,
      children: 0,
      special_requests: '',
    });
    setSelectedDates([]);
    setBookingError(null);
    setBookingSuccess(null);
    loadAvailableRooms();
    setBookingModalOpen(true);
  };

  const handleCloseBookingModal = () => {
    setBookingModalOpen(false);
    setSelectedGuest(null);
    setSelectedDates([]);
    setBookingError(null);
    setBookingSuccess(null);
  };

  const handleCancelPendingBooking = async () => {
    if (!bookingToCancel) return;

    try {
      setCancellingBooking(true);
      setError(null);
      await BookingsService.cancelMyPendingBooking(bookingToCancel.id, 'Cancelled by guest before payment');
      setBookingToCancel(null);
      await myBookingsQuery.refetch();
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : 'Failed to cancel booking');
    } finally {
      setCancellingBooking(false);
    }
  };

  const calculateNights = () => {
    if (!bookingForm.check_in_date || !bookingForm.check_out_date) return 0;
    const checkIn = new Date(bookingForm.check_in_date);
    const checkOut = new Date(bookingForm.check_out_date);
    const diffTime = checkOut.getTime() - checkIn.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays > 0 ? diffDays : 0;
  };

  // Generate all dates in the booking range
  const bookingDates = useMemo(() => {
    if (!bookingForm.check_in_date || !bookingForm.check_out_date) return [];
    const dates: string[] = [];
    const checkOut = parseLocalDate(bookingForm.check_out_date);
    let current = parseLocalDate(bookingForm.check_in_date);

    while (current < checkOut) {
      dates.push(formatLocalDate(current));
      current = addLocalDays(current, 1);
    }
    return dates;
  }, [bookingForm.check_in_date, bookingForm.check_out_date]);

  // Get total available credits for the selected room type
  const getAvailableCreditsForRoom = () => {
    if (!selectedGuest || !bookingForm.room_id) return 0;
    const room = rooms.find(r => r.id.toString() === bookingForm.room_id);
    if (!room) return 0;

    // Find credits for this room type
    const roomTypeCredit = selectedGuest.credits_by_room_type.find(
      c => c.room_type_name === room.room_type
    );
    const roomTypeCredits = roomTypeCredit?.nights_available || 0;
    return roomTypeCredits;
  };

  const handleDateToggle = (date: string) => {
    const maxCredits = getAvailableCreditsForRoom();
    setSelectedDates(prev => {
      if (prev.includes(date)) {
        return prev.filter(d => d !== date);
      } else if (prev.length < maxCredits) {
        return [...prev, date].sort();
      }
      return prev;
    });
  };

  const selectAllDates = () => {
    const maxCredits = getAvailableCreditsForRoom();
    setSelectedDates(bookingDates.slice(0, maxCredits));
  };

  const handleBookWithCredits = async () => {
    if (!selectedGuest) return;

    const nights = calculateNights();
    if (nights <= 0) {
      setBookingError('Please select valid check-in and check-out dates');
      return;
    }

    if (selectedDates.length < 1) {
      setBookingError('You must select at least 1 complimentary date');
      return;
    }

    const availableCredits = getAvailableCreditsForRoom();
    if (selectedDates.length > availableCredits) {
      setBookingError(`Not enough credits. Selected: ${selectedDates.length}, Available: ${availableCredits}`);
      return;
    }

    if (!bookingForm.room_id) {
      setBookingError('Please select a room');
      return;
    }

    try {
      setBookingSubmitting(true);
      setBookingError(null);

      const result = await bookWithCreditsMutation.mutateAsync({
        guest_id: selectedGuest.id,
        room_id: parseInt(bookingForm.room_id, 10),
        check_in_date: bookingForm.check_in_date,
        check_out_date: bookingForm.check_out_date,
        adults: bookingForm.adults,
        children: bookingForm.children,
        special_requests: bookingForm.special_requests || undefined,
        complimentary_dates: selectedDates,
      });

      const paidMessage = result.paid_nights > 0
        ? ` ${result.paid_nights} night(s) to be paid ($${result.total_amount}).`
        : '';
      const giftMessage = result.is_free_gift ? ' (Free Gift)' : '';
      setBookingSuccess(`Booking confirmed!${giftMessage} ${result.complimentary_nights} complimentary night(s) used for ${result.room_type}.${paidMessage}`);

      // Refresh data
      await Promise.all([loadMyBookings(), loadGuestsWithCredits()]);

      // Close modal after 3 seconds
      setTimeout(() => {
        handleCloseBookingModal();
      }, 3000);
    } catch (err: any) {
      setBookingError(err.message || 'Failed to create booking');
    } finally {
      setBookingSubmitting(false);
    }
  };

  const getStatusColor = (status: string): "default" | "primary" | "secondary" | "error" | "info" | "success" | "warning" => {
    switch (status.toLowerCase()) {
      case 'confirmed':
        return 'success';
      case 'pending':
        return 'warning';
      case 'voided':
        return 'error';
      case 'completed':
        return 'info';
      default:
        return 'default';
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const handleViewInvoice = (bookingId: string) => {
    setSelectedBookingId(bookingId);
    setInvoiceModalOpen(true);
  };

  const canDownloadInvoice = (booking: BookingWithDetails) => {
    return booking.status === 'checked_out' || booking.status === 'completed';
  };

  const [bookingSearch, setBookingSearch] = useState('');

  const bookingColumns = useMemo<ColumnDef<BookingWithDetails, any>[]>(() => [
    {
      id: 'folio',
      header: 'Folio Number',
      accessorFn: (b) => b.folio_number || '',
      cell: (info) => (info.getValue() as string) || '-',
    },
    {
      id: 'guest',
      header: 'Guest Name',
      accessorFn: (b) => b.guest_name,
      cell: (info) => <Box sx={{ fontWeight: 500 }}>{String(info.getValue() ?? '')}</Box>,
    },
    {
      id: 'roomType',
      header: 'Room Type',
      accessorFn: (b) => b.room_type,
      cell: (info) => <Box sx={{ fontWeight: 500 }}>{String(info.getValue() ?? '')}</Box>,
    },
    {
      id: 'roomNumber',
      header: 'Room Number',
      accessorFn: (b) => b.room_number,
    },
    {
      id: 'checkIn',
      header: 'Check-in',
      accessorFn: (b) => new Date(b.check_in_date).getTime(),
      cell: (info) => formatDate(new Date(info.getValue() as number).toISOString()),
    },
    {
      id: 'checkOut',
      header: 'Check-out',
      accessorFn: (b) => new Date(b.check_out_date).getTime(),
      cell: (info) => formatDate(new Date(info.getValue() as number).toISOString()),
    },
    {
      id: 'amount',
      header: 'Amount',
      accessorFn: (b) => toMoneyNumber(b.total_amount),
      cell: (info) => (
        <Box sx={{ fontWeight: 600, color: 'primary.main' }}>
          ${toMoneyNumber(info.getValue() as number).toFixed(2)}
        </Box>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      accessorFn: (b) => b.status,
      cell: (info) => {
        const status = info.getValue() as string;
        return (
          <Chip
            label={status}
            color={getStatusColor(status)}
            size="small"
            sx={{ fontWeight: 500 }}
          />
        );
      },
    },
    {
      id: 'actions',
      header: 'Actions',
      enableSorting: false,
      enableColumnFilter: false,
      meta: { stopRowClick: true },
      cell: (info) => {
        const booking = info.row.original;
        const canCancel = booking.status.toLowerCase() === 'pending';
        if (!canDownloadInvoice(booking) && !canCancel) return null;
        return (
          <Box display="flex" gap={0.5}>
            {canDownloadInvoice(booking) && (
              <Tooltip title="Download Invoice">
                <IconButton size="small" color="primary" onClick={() => handleViewInvoice(booking.id)}>
                  <ReceiptIcon />
                </IconButton>
              </Tooltip>
            )}
            {canCancel && (
              <Tooltip title="Cancel unpaid booking">
                <IconButton size="small" color="error" onClick={() => setBookingToCancel(booking)}>
                  <CancelIcon />
                </IconButton>
              </Tooltip>
            )}
          </Box>
        );
      },
    },
  ], []);

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" component="h1" gutterBottom sx={{ fontWeight: 700, color: 'text.primary' }}>
            My Bookings
          </Typography>
          <Typography variant="body1" color="text.secondary">
            View all your hotel room reservations
          </Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={loadMyBookings}
          disabled={loading}
        >
          Refresh
        </Button>
      </Box>

      {pageError && (
        <Alert
          severity="error"
          sx={{ mb: 3 }}
          action={
            <Button color="inherit" size="small" onClick={loadMyBookings}>
              Retry
            </Button>
          }
        >
          {pageError}
        </Alert>
      )}

      <Card>
        <CardContent>
          <Box display="flex" alignItems="center" justifyContent="space-between" mb={2} gap={2} flexWrap="wrap">
            <Box display="flex" alignItems="center">
              <BookingIcon sx={{ mr: 1, color: 'primary.main' }} />
              <Typography variant="h6" sx={{ fontWeight: 600 }}>
                Your Reservations ({bookings.length})
              </Typography>
            </Box>
            {bookings.length > 0 && (
              <SearchField
                size="small"
                placeholder="Search bookings..."
                value={bookingSearch}
                onChange={(e) => setBookingSearch(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" color="action" />
                    </InputAdornment>
                  ),
                }}
                sx={{ width: 240 }}
              />
            )}
          </Box>

          {bookings.length === 0 ? (
            <Box textAlign="center" py={4}>
              <Typography variant="h6" color="text.secondary" gutterBottom>
                No bookings yet
              </Typography>
              <Typography variant="body2" color="text.secondary">
                You haven't made any reservations yet. Visit the Rooms tab to book a room!
              </Typography>
            </Box>
          ) : (
            <DataTable<BookingWithDetails>
              data={bookings}
              columns={bookingColumns}
              globalFilter={bookingSearch}
              emptyMessage="No bookings match your search"
              getRowId={(row) => String(row.id)}
            />
          )}
        </CardContent>
      </Card>

      <Box mt={2}>
        <Alert severity="info">
          <Typography variant="body2">
            <strong>Note:</strong> Pending bookings can be cancelled before payment using the cancel icon.
            To modify a booking or cancel a paid booking, please contact support or visit the front desk.
            For checked-out bookings, you can download your invoice using the receipt icon in the Actions column.
          </Typography>
        </Alert>
      </Box>

      <Dialog open={Boolean(bookingToCancel)} onClose={() => !cancellingBooking && setBookingToCancel(null)}>
        <DialogTitle>Cancel pending booking?</DialogTitle>
        <DialogContent>
          <Typography>
            This booking has not been paid for and will be cancelled. This action cannot be undone here.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBookingToCancel(null)} disabled={cancellingBooking}>Keep booking</Button>
          <Button color="error" variant="contained" onClick={handleCancelPendingBooking} disabled={cancellingBooking}>
            {cancellingBooking ? 'Cancelling…' : 'Cancel booking'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Complimentary Credits Section */}
      <Card sx={{ mt: 4 }}>
        <CardContent>
          <Box display="flex" alignItems="center" mb={2}>
            <GiftIcon sx={{ mr: 1, color: 'secondary.main' }} />
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              Complimentary Night Credits (Free Gift)
            </Typography>
          </Box>

          {guestsLoading ? (
            <Box display="flex" justifyContent="center" py={3}>
              <CircularProgress size={30} />
            </Box>
          ) : guestsWithCredits.length === 0 ? (
            <Box textAlign="center" py={3}>
              <Typography variant="body1" color="text.secondary">
                No linked guest profiles found.
              </Typography>
              <Typography variant="body2" color="text.secondary" mt={1}>
                Contact the hotel to link your guest profile to your account.
              </Typography>
            </Box>
          ) : (
            <Grid container spacing={2}>
              {guestsWithCredits.map((guest) => {
                const totalCredits = guest.total_complimentary_credits;
                return (
                  <Grid key={guest.id} size={{ xs: 12, sm: 6, md: 4 }}>
                    <Paper
                      variant="outlined"
                      sx={{
                        p: 2,
                        borderRadius: 2,
                        transition: 'all 0.2s',
                        '&:hover': {
                          boxShadow: 2,
                          borderColor: 'primary.main',
                        },
                      }}
                    >
                      <Typography variant="subtitle1" fontWeight={600}>
                        {guest.full_name}
                      </Typography>
                      <Typography variant="body2" color="text.secondary" mb={2}>
                        {guest.email}
                      </Typography>

                      {/* Credits by Room Type */}
                      {guest.credits_by_room_type.length > 0 && (
                        <Box mb={2}>
                          <Typography variant="body2" fontWeight={500} mb={1}>
                            Credits by Room Type:
                          </Typography>
                          {guest.credits_by_room_type.map((credit) => (
                            <Box
                              key={credit.room_type_id}
                              sx={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                backgroundColor: 'success.light',
                                borderRadius: 1,
                                px: 1.5,
                                py: 0.5,
                                mb: 0.5,
                              }}
                            >
                              <Typography variant="body2">
                                {credit.room_type_name}
                              </Typography>
                              <Chip
                                icon={<GiftIcon sx={{ fontSize: 14 }} />}
                                label={`${credit.nights_available} night${credit.nights_available !== 1 ? 's' : ''}`}
                                color="success"
                                size="small"
                              />
                            </Box>
                          ))}
                        </Box>
                      )}

                      {/* Total */}
                      <Box
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          borderTop: '1px solid',
                          borderColor: 'divider',
                          pt: 1,
                          mb: 2,
                        }}
                      >
                        <Typography variant="body2" fontWeight={600}>
                          Total Available:
                        </Typography>
                        <Chip
                          label={`${totalCredits} night${totalCredits !== 1 ? 's' : ''}`}
                          color={totalCredits > 0 ? 'success' : 'default'}
                          size="small"
                        />
                      </Box>

                      {totalCredits > 0 && (
                        <Button
                          variant="contained"
                          color="secondary"
                          fullWidth
                          startIcon={<GiftIcon />}
                          onClick={() => handleOpenBookingModal(guest)}
                        >
                          Book Free Gift
                        </Button>
                      )}
                    </Paper>
                  </Grid>
                );
              })}
            </Grid>
          )}
        </CardContent>
      </Card>

      {/* Invoice Modal */}
      <InvoiceModal
        open={invoiceModalOpen}
        onClose={() => setInvoiceModalOpen(false)}
        bookingId={selectedBookingId}
      />

      {/* Book with Credits Modal */}
      <Dialog
        open={bookingModalOpen}
        onClose={handleCloseBookingModal}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          <Box display="flex" alignItems="center">
            <GiftIcon sx={{ mr: 1, color: 'secondary.main' }} />
            Book with Free Gift Credits
          </Box>
        </DialogTitle>
        <DialogContent>
          {selectedGuest && (
            <>
              <Alert severity="info" sx={{ mb: 3 }}>
                <Typography variant="body2">
                  Booking for <strong>{selectedGuest.full_name}</strong>
                </Typography>
                {selectedGuest.credits_by_room_type.length > 0 && (
                  <Box mt={1}>
                    {selectedGuest.credits_by_room_type.map((c) => (
                      <Typography key={c.room_type_id} variant="body2">
                        {c.room_type_name}: <strong>{c.nights_available} night(s)</strong>
                      </Typography>
                    ))}
                  </Box>
                )}
              </Alert>

              {bookingError && (
                <Alert severity="error" sx={{ mb: 2 }}>
                  {bookingError}
                </Alert>
              )}

              {bookingSuccess && (
                <Alert severity="success" sx={{ mb: 2 }}>
                  {bookingSuccess}
                </Alert>
              )}

              <Grid container spacing={2}>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    label="Check-in Date"
                    type="date"
                    fullWidth
                    InputLabelProps={{ shrink: true }}
                    value={bookingForm.check_in_date}
                    onChange={(e) => {
                      setBookingForm({ ...bookingForm, check_in_date: e.target.value });
                      setSelectedDates([]);
                    }}
                    inputProps={{ min: formatLocalDate() }}
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    label="Check-out Date"
                    type="date"
                    fullWidth
                    InputLabelProps={{ shrink: true }}
                    value={bookingForm.check_out_date}
                    onChange={(e) => {
                      setBookingForm({ ...bookingForm, check_out_date: e.target.value });
                      setSelectedDates([]);
                    }}
                    inputProps={{ min: bookingForm.check_in_date || formatLocalDate() }}
                  />
                </Grid>

                <Grid size={12}>
                  <TextField
                    select
                    label="Select Room"
                    fullWidth
                    value={bookingForm.room_id}
                    onChange={(e) => {
                      setBookingForm({ ...bookingForm, room_id: e.target.value });
                      setSelectedDates([]);
                    }}
                    disabled={roomsLoading}
                    helperText={roomsLoading ? 'Loading available rooms...' : ''}
                  >
                    {rooms.map((room) => (
                      <MenuItem key={room.id} value={room.id.toString()}>
                        Room {room.room_number} - {room.room_type} (${room.price_per_night}/night)
                      </MenuItem>
                    ))}
                  </TextField>
                </Grid>

                <Grid size={6}>
                  <TextField
                    label="Adults"
                    type="number"
                    fullWidth
                    value={bookingForm.adults}
                    onChange={(e) => setBookingForm({ ...bookingForm, adults: parseInt(e.target.value, 10) || 1 })}
                    inputProps={{ min: 1, max: 10 }}
                  />
                </Grid>
                <Grid size={6}>
                  <TextField
                    label="Children"
                    type="number"
                    fullWidth
                    value={bookingForm.children}
                    onChange={(e) => setBookingForm({ ...bookingForm, children: parseInt(e.target.value, 10) || 0 })}
                    inputProps={{ min: 0, max: 10 }}
                  />
                </Grid>

                <Grid size={12}>
                  <TextField
                    label="Special Requests (Optional)"
                    fullWidth
                    multiline
                    rows={2}
                    value={bookingForm.special_requests}
                    onChange={(e) => setBookingForm({ ...bookingForm, special_requests: e.target.value })}
                    placeholder="Any special requests or preferences..."
                  />
                </Grid>

                {/* Date Selection for Complimentary Nights */}
                {bookingDates.length > 0 && bookingForm.room_id && (
                  <Grid size={12}>
                    <Divider sx={{ my: 2 }} />
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                      <Typography variant="subtitle1" fontWeight={600}>
                        Select Complimentary Dates (at least 1 required)
                      </Typography>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={selectAllDates}
                        disabled={getAvailableCreditsForRoom() === 0}
                      >
                        Select All Available
                      </Button>
                    </Box>
                    <Typography variant="body2" color="text.secondary" mb={2}>
                      Available credits for this room: <strong>{getAvailableCreditsForRoom()}</strong> |
                      Selected: <strong>{selectedDates.length}</strong> of {bookingDates.length} nights
                    </Typography>
                    <Paper variant="outlined" sx={{ p: 2, maxHeight: 200, overflow: 'auto' }}>
                      <FormGroup>
                        {bookingDates.map((date) => {
                          const isSelected = selectedDates.includes(date);
                          const canSelect = isSelected || selectedDates.length < getAvailableCreditsForRoom();
                          return (
                            <FormControlLabel
                              key={date}
                              control={
                                <Checkbox
                                  checked={isSelected}
                                  onChange={() => handleDateToggle(date)}
                                  disabled={!canSelect && !isSelected}
                                  color="secondary"
                                />
                              }
                              label={
                                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                  <Typography variant="body2">
                                    {formatDate(date)}
                                  </Typography>
                                  {isSelected && (
                                    <Chip
                                      label="Free Gift"
                                      size="small"
                                      color="secondary"
                                      icon={<GiftIcon sx={{ fontSize: 14 }} />}
                                      sx={{ ml: 1, height: 20 }}
                                    />
                                  )}
                                </Box>
                              }
                              sx={{
                                backgroundColor: isSelected ? 'rgba(156, 39, 176, 0.08)' : 'transparent',
                                borderRadius: 1,
                                mb: 0.5,
                                mx: 0,
                                px: 1,
                              }}
                            />
                          );
                        })}
                      </FormGroup>
                    </Paper>
                    {selectedDates.length > 0 && (
                      <Alert severity="success" sx={{ mt: 2 }}>
                        <Typography variant="body2">
                          <strong>{selectedDates.length}</strong> night(s) will be complimentary (Free Gift).
                          {calculateNights() - selectedDates.length > 0 && (
                            <span> <strong>{calculateNights() - selectedDates.length}</strong> night(s) will be charged at regular rate.</span>
                          )}
                        </Typography>
                      </Alert>
                    )}
                  </Grid>
                )}
              </Grid>
            </>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={handleCloseBookingModal} disabled={bookingSubmitting}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color="secondary"
            onClick={handleBookWithCredits}
            disabled={
              bookingSubmitting ||
              !bookingForm.room_id ||
              calculateNights() <= 0 ||
              selectedDates.length < 1 ||
              !!bookingSuccess
            }
          >
            {bookingSubmitting ? <CircularProgress size={24} /> : 'Confirm Booking'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default MyBookingsPage;

import React, { useEffect, useState, useMemo } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
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
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  EventNote as BookingIcon,
  Receipt as ReceiptIcon,
  CardGiftcard as CreditIcon,
  HotelOutlined as RoomIcon,
  Redeem as GiftIcon,
} from '@mui/icons-material';
import { HotelAPIService, GuestsService, BookingsService, RoomsService } from '../../../api';
import { BookingWithDetails, Room } from '../../../types';
import InvoiceModal from '../../invoices/components/InvoiceModal';

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
  const [bookings, setBookings] = useState<BookingWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false);
  const [selectedBookingId, setSelectedBookingId] = useState<string>('');

  // Complimentary credits state - now with room type breakdown
  const [guestsWithCredits, setGuestsWithCredits] = useState<GuestWithCredits[]>([]);
  const [guestsLoading, setGuestsLoading] = useState(true);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(false);

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
    try {
      setLoading(true);
      setError(null);
      // This will call a new endpoint that returns only the current user's bookings
      const data = await HotelAPIService.getMyBookings();
      setBookings(data);
    } catch (err: any) {
      console.error('Failed to load your bookings:', err);
      setError(err.message || 'Failed to load your bookings. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const loadGuestsWithCredits = async () => {
    try {
      setGuestsLoading(true);
      const guests = await GuestsService.getMyGuestsWithCredits();
      setGuestsWithCredits(guests);
    } catch (err: any) {
      console.error('Failed to load guests with credits:', err);
    } finally {
      setGuestsLoading(false);
    }
  };

  const loadAvailableRooms = async () => {
    try {
      setRoomsLoading(true);
      const allRooms = await RoomsService.getAllRooms();
      // Filter to only show available rooms
      const availableRooms = allRooms.filter(room => room.available || room.status === 'available');
      setRooms(availableRooms);
    } catch (err: any) {
      console.error('Failed to load rooms:', err);
    } finally {
      setRoomsLoading(false);
    }
  };

  useEffect(() => {
    loadMyBookings();
    loadGuestsWithCredits();
  }, []);

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
    const checkIn = new Date(bookingForm.check_in_date);
    const checkOut = new Date(bookingForm.check_out_date);
    const current = new Date(checkIn);

    while (current < checkOut) {
      dates.push(current.toISOString().split('T')[0]);
      current.setDate(current.getDate() + 1);
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

      const result = await BookingsService.bookWithCredits({
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
      loadMyBookings();
      loadGuestsWithCredits();

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
      case 'cancelled':
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

      {error && (
        <Alert
          severity="error"
          sx={{ mb: 3 }}
          action={
            <Button color="inherit" size="small" onClick={loadMyBookings}>
              Retry
            </Button>
          }
        >
          {error}
        </Alert>
      )}

      <Card>
        <CardContent>
          <Box display="flex" alignItems="center" mb={2}>
            <BookingIcon sx={{ mr: 1, color: 'primary.main' }} />
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              Your Reservations ({bookings.length})
            </Typography>
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
            <TableContainer component={Paper} variant="outlined">
              <Table>
                <TableHead>
                  <TableRow sx={{ backgroundColor: '#f5f5f5' }}>
                    <TableCell sx={{ fontWeight: 600 }}>Folio Number</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Guest Name</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Room Type</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Room Number</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Check-in</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Check-out</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Amount</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {bookings.map((booking) => (
                    <TableRow
                      key={booking.id}
                      sx={{
                        '&:hover': { backgroundColor: '#f9f9f9' },
                        transition: 'background-color 0.2s'
                      }}
                    >
                      <TableCell>{booking.folio_number || '-'}</TableCell>
                      <TableCell sx={{ fontWeight: 500 }}>{booking.guest_name}</TableCell>
                      <TableCell sx={{ fontWeight: 500 }}>{booking.room_type}</TableCell>
                      <TableCell>{booking.room_number}</TableCell>
                      <TableCell>{formatDate(booking.check_in_date)}</TableCell>
                      <TableCell>{formatDate(booking.check_out_date)}</TableCell>
                      <TableCell sx={{ fontWeight: 600, color: 'primary.main' }}>
                        ${typeof booking.total_amount === 'string'
                          ? parseFloat(booking.total_amount).toFixed(2)
                          : booking.total_amount.toFixed(2)}
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={booking.status}
                          color={getStatusColor(booking.status)}
                          size="small"
                          sx={{ fontWeight: 500 }}
                        />
                      </TableCell>
                      <TableCell>
                        {canDownloadInvoice(booking) && (
                          <Tooltip title="Download Invoice">
                            <IconButton
                              size="small"
                              color="primary"
                              onClick={() => handleViewInvoice(booking.id)}
                            >
                              <ReceiptIcon />
                            </IconButton>
                          </Tooltip>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>

      <Box mt={2}>
        <Alert severity="info">
          <Typography variant="body2">
            <strong>Note:</strong> To modify or cancel a booking, please contact our support team or visit the front desk.
            For checked-out bookings, you can download your invoice using the receipt icon in the Actions column.
          </Typography>
        </Alert>
      </Box>

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
                  <Grid item xs={12} sm={6} md={4} key={guest.id}>
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
                <Grid item xs={12} sm={6}>
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
                    inputProps={{ min: new Date().toISOString().split('T')[0] }}
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
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
                    inputProps={{ min: bookingForm.check_in_date || new Date().toISOString().split('T')[0] }}
                  />
                </Grid>

                <Grid item xs={12}>
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

                <Grid item xs={6}>
                  <TextField
                    label="Adults"
                    type="number"
                    fullWidth
                    value={bookingForm.adults}
                    onChange={(e) => setBookingForm({ ...bookingForm, adults: parseInt(e.target.value, 10) || 1 })}
                    inputProps={{ min: 1, max: 10 }}
                  />
                </Grid>
                <Grid item xs={6}>
                  <TextField
                    label="Children"
                    type="number"
                    fullWidth
                    value={bookingForm.children}
                    onChange={(e) => setBookingForm({ ...bookingForm, children: parseInt(e.target.value, 10) || 0 })}
                    inputProps={{ min: 0, max: 10 }}
                  />
                </Grid>

                <Grid item xs={12}>
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
                  <Grid item xs={12}>
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

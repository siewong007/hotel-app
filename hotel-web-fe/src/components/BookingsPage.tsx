import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Card,
  CardContent,
  Chip,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  MenuItem,
  Alert,
  CircularProgress,
  Snackbar
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  EventAvailable as BookIcon,
  Person as PersonIcon,
  Hotel as HotelIcon
} from '@mui/icons-material';
import { HotelAPIService } from '../api';
import { BookingWithDetails, Room, Guest } from '../types';

const BookingsPage: React.FC = () => {
  const [bookings, setBookings] = useState<BookingWithDetails[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create booking dialog
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [selectedGuestId, setSelectedGuestId] = useState<string>('');
  const [selectedRoomId, setSelectedRoomId] = useState<string>('');
  const [checkInDate, setCheckInDate] = useState('');
  const [checkOutDate, setCheckOutDate] = useState('');
  const [creating, setCreating] = useState(false);

  // Notifications
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [bookingsData, roomsData, guestsData] = await Promise.all([
        HotelAPIService.getBookingsWithDetails(),
        HotelAPIService.getAllRooms(),
        HotelAPIService.getAllGuests()
      ]);

      setBookings(bookingsData);
      setRooms(roomsData);
      setGuests(guestsData);
      setError(null);
    } catch (err) {
      setError('Failed to load bookings data');
    } finally {
      setLoading(false);
    }
  };

  const availableRooms = rooms.filter(room => room.available);

  const handleCreateBooking = async () => {
    if (!selectedGuestId || !selectedRoomId || !checkInDate || !checkOutDate) return;

    try {
      setCreating(true);
      await HotelAPIService.createBooking({
        guest_id: selectedGuestId,
        room_id: selectedRoomId,
        check_in: new Date(checkInDate).toISOString(),
        check_out: new Date(checkOutDate).toISOString()
      });

      setSnackbarMessage('Booking created successfully!');
      setSnackbarOpen(true);

      // Reset form and close dialog
      resetBookingForm();
      setCreateDialogOpen(false);

      // Reload data
      await loadData();

    } catch (err) {
      setError('Failed to create booking');
    } finally {
      setCreating(false);
    }
  };

  const resetBookingForm = () => {
    setSelectedGuestId('');
    setSelectedRoomId('');
    setCheckInDate('');
    setCheckOutDate('');
  };

  const isFormValid = selectedGuestId && selectedRoomId && checkInDate && checkOutDate;

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4" component="h1">
          Booking Management
        </Typography>
        <Box display="flex" gap={2}>
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={loadData}
          >
            Refresh
          </Button>
          <Button
            variant="contained"
            startIcon={<BookIcon />}
            onClick={() => setCreateDialogOpen(true)}
            disabled={availableRooms.length === 0 || guests.length === 0}
          >
            New Booking
          </Button>
        </Box>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {/* Statistics Cards */}
      <Box display="flex" gap={3} mb={3}>
        <Card sx={{ flex: 1 }}>
          <CardContent>
            <Box display="flex" alignItems="center" mb={1}>
              <BookIcon color="primary" sx={{ mr: 1 }} />
              <Typography variant="h6">Total Bookings</Typography>
            </Box>
            <Typography variant="h4" color="primary">
              {bookings.length}
            </Typography>
          </CardContent>
        </Card>

        <Card sx={{ flex: 1 }}>
          <CardContent>
            <Box display="flex" alignItems="center" mb={1}>
              <HotelIcon color="success" sx={{ mr: 1 }} />
              <Typography variant="h6">Available Rooms</Typography>
            </Box>
            <Typography variant="h4" color="success.main">
              {availableRooms.length}
            </Typography>
          </CardContent>
        </Card>

        <Card sx={{ flex: 1 }}>
          <CardContent>
            <Box display="flex" alignItems="center" mb={1}>
              <PersonIcon color="secondary" sx={{ mr: 1 }} />
              <Typography variant="h6">Total Guests</Typography>
            </Box>
            <Typography variant="h4" color="secondary.main">
              {guests.length}
            </Typography>
          </CardContent>
        </Card>
      </Box>

      {/* Bookings Table */}
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow sx={{ backgroundColor: '#f5f5f5' }}>
              <TableCell><strong>Booking ID</strong></TableCell>
              <TableCell><strong>Guest Name</strong></TableCell>
              <TableCell><strong>Room Type</strong></TableCell>
              <TableCell><strong>Room ID</strong></TableCell>
              <TableCell><strong>Check-in</strong></TableCell>
              <TableCell><strong>Check-out</strong></TableCell>
              <TableCell><strong>Status</strong></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {bookings.map((booking) => (
              <TableRow key={booking.id} hover>
                <TableCell>#{booking.id}</TableCell>
                <TableCell>{booking.guestName}</TableCell>
                <TableCell>{booking.roomType}</TableCell>
                <TableCell>Room {booking.room_id}</TableCell>
                <TableCell>{booking.checkInDate}</TableCell>
                <TableCell>{booking.checkOutDate}</TableCell>
                <TableCell>
                  <Chip
                    label="Active"
                    color="success"
                    size="small"
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {bookings.length === 0 && (
        <Box textAlign="center" py={4}>
          <Typography variant="h6" color="text.secondary">
            No bookings yet
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Create your first booking using the "New Booking" button above
          </Typography>
        </Box>
      )}

      {/* Create Booking Dialog */}
      <Dialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Create New Booking</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              select
              fullWidth
              label="Select Guest"
              value={selectedGuestId}
              onChange={(e) => setSelectedGuestId(e.target.value)}
            >
              <MenuItem value="">Choose a guest</MenuItem>
              {guests.map((guest) => (
                <MenuItem key={guest.id} value={guest.id}>
                  {guest.name} ({guest.email})
                </MenuItem>
              ))}
            </TextField>

            <TextField
              select
              fullWidth
              label="Select Room"
              value={selectedRoomId}
              onChange={(e) => setSelectedRoomId(e.target.value)}
            >
              <MenuItem value="">Choose an available room</MenuItem>
              {availableRooms.map((room) => (
                <MenuItem key={room.id} value={room.id}>
                  Room {room.id} - {room.room_type} (${room.price_per_night}/night)
                </MenuItem>
              ))}
            </TextField>

            <Box display="flex" gap={2}>
              <TextField
                fullWidth
                label="Check-in Date"
                type="date"
                value={checkInDate}
                onChange={(e) => setCheckInDate(e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
              <TextField
                fullWidth
                label="Check-out Date"
                type="date"
                value={checkOutDate}
                onChange={(e) => setCheckOutDate(e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
          <Button
            onClick={handleCreateBooking}
            variant="contained"
            disabled={creating || !isFormValid}
          >
            {creating ? <CircularProgress size={20} /> : 'Create Booking'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Success Snackbar */}
      <Snackbar
        open={snackbarOpen}
        autoHideDuration={4000}
        onClose={() => setSnackbarOpen(false)}
      >
        <Alert onClose={() => setSnackbarOpen(false)} severity="success">
          {snackbarMessage}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default BookingsPage;

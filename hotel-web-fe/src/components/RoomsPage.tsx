import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  Button,
  TextField,
  MenuItem,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  CircularProgress,
  Snackbar
} from '@mui/material';
import {
  Hotel as HotelIcon,
  Search as SearchIcon,
  EventAvailable as BookIcon
} from '@mui/icons-material';
import { HotelAPIService } from '../api';
import { Room, GuestCreateRequest, BookingCreateRequest } from '../types';

const RoomsPage: React.FC = () => {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [filteredRooms, setFilteredRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Search filters
  const [roomTypeFilter, setRoomTypeFilter] = useState<string>('');
  const [maxPriceFilter, setMaxPriceFilter] = useState<string>('');

  // Booking dialog
  const [bookingDialogOpen, setBookingDialogOpen] = useState(false);
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [bookingLoading, setBookingLoading] = useState(false);

  // Notifications
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');

  const roomTypes = ['Deluxe', 'Standard', 'Suite'];

  useEffect(() => {
    loadRooms();
  }, []);

  useEffect(() => {
    filterRooms();
  }, [rooms, roomTypeFilter, maxPriceFilter]);

  const loadRooms = async () => {
    try {
      setLoading(true);
      const data = await HotelAPIService.getAllRooms();
      setRooms(data);
      setError(null);
    } catch (err) {
      setError('Failed to load rooms');
    } finally {
      setLoading(false);
    }
  };

  const filterRooms = () => {
    let filtered = rooms;

    if (roomTypeFilter) {
      filtered = filtered.filter(room =>
        room.room_type.toLowerCase().includes(roomTypeFilter.toLowerCase())
      );
    }

    if (maxPriceFilter) {
      const maxPrice = parseFloat(maxPriceFilter);
      if (!isNaN(maxPrice)) {
        filtered = filtered.filter(room => room.price_per_night <= maxPrice);
      }
    }

    setFilteredRooms(filtered);
  };

  const handleSearch = async () => {
    try {
      setLoading(true);
      const data = await HotelAPIService.searchRooms(
        roomTypeFilter || undefined,
        maxPriceFilter ? parseFloat(maxPriceFilter) : undefined
      );
      setFilteredRooms(data);
      setError(null);
    } catch (err) {
      setError('Failed to search rooms');
    } finally {
      setLoading(false);
    }
  };

  const handleBookRoom = (room: Room) => {
    setSelectedRoom(room);
    setBookingDialogOpen(true);
  };

  const handleConfirmBooking = async () => {
    if (!selectedRoom || !guestName || !guestEmail) return;

    try {
      setBookingLoading(true);

      // Create guest
      const guest = await HotelAPIService.createGuest({
        name: guestName,
        email: guestEmail
      });

      // Create booking
      const checkIn = new Date().toISOString();
      const checkOut = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // +1 day

      await HotelAPIService.createBooking({
        guest_id: guest.id,
        room_id: selectedRoom.id,
        check_in: checkIn,
        check_out: checkOut
      });

      setSnackbarMessage(`Booking confirmed! Booking ID will be displayed.`);
      setSnackbarOpen(true);

      // Reset form and close dialog
      setGuestName('');
      setGuestEmail('');
      setBookingDialogOpen(false);
      setSelectedRoom(null);

      // Reload rooms to update availability
      await loadRooms();

    } catch (err) {
      setError('Failed to create booking');
    } finally {
      setBookingLoading(false);
    }
  };

  const clearFilters = () => {
    setRoomTypeFilter('');
    setMaxPriceFilter('');
  };

  if (loading && rooms.length === 0) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" component="h1" gutterBottom sx={{ fontWeight: 700 }}>
          Room Management
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Browse and manage hotel rooms. Search by type or price to find the perfect room.
        </Typography>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {/* Search Filters */}
      <Card sx={{ mb: 3, p: 3, background: 'linear-gradient(135deg, #f5f7fa 0%, #ffffff 100%)' }}>
        <Box display="flex" alignItems="center" mb={2}>
          <SearchIcon sx={{ mr: 1, color: 'primary.main' }} />
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            Search & Filter Rooms
          </Typography>
        </Box>
        <Grid container spacing={3} alignItems="center">
          <Grid item xs={12} sm={4}>
            <TextField
              select
              fullWidth
              label="Room Type"
              value={roomTypeFilter}
              onChange={(e) => setRoomTypeFilter(e.target.value)}
            >
              <MenuItem value="">All Types</MenuItem>
              {roomTypes.map((type) => (
                <MenuItem key={type} value={type}>
                  {type}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField
              fullWidth
              label="Max Price ($)"
              type="number"
              value={maxPriceFilter}
              onChange={(e) => setMaxPriceFilter(e.target.value)}
              placeholder="Enter max price"
            />
          </Grid>
          <Grid item xs={12} sm={4}>
            <Box display="flex" gap={1}>
              <Button
                variant="contained"
                startIcon={<SearchIcon />}
                onClick={handleSearch}
                fullWidth
              >
                Search
              </Button>
              <Button
                variant="outlined"
                onClick={clearFilters}
              >
                Clear
              </Button>
            </Box>
          </Grid>
        </Grid>
      </Card>

      {/* Active Filters Display */}
      {(roomTypeFilter || maxPriceFilter) && (
        <Box mb={2}>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Active filters:
          </Typography>
          {roomTypeFilter && (
            <Chip
              label={`Type: ${roomTypeFilter}`}
              onDelete={() => setRoomTypeFilter('')}
              sx={{ mr: 1 }}
            />
          )}
          {maxPriceFilter && (
            <Chip
              label={`Max Price: $${maxPriceFilter}`}
              onDelete={() => setMaxPriceFilter('')}
            />
          )}
        </Box>
      )}

      {/* Rooms Grid */}
      {filteredRooms.length === 0 ? (
        <Card sx={{ p: 4, textAlign: 'center' }}>
          <HotelIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
          <Typography variant="h6" color="text.secondary">
            No rooms found matching your criteria
          </Typography>
        </Card>
      ) : (
        <Grid container spacing={3}>
          {filteredRooms.map((room) => (
            <Grid item xs={12} sm={6} md={4} key={room.id}>
              <Card sx={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                position: 'relative',
                overflow: 'hidden',
                border: room.available ? '1px solid #e0e0e0' : '1px solid #ffcdd2',
                '&:hover': {
                  transform: 'translateY(-4px)',
                  boxShadow: '0px 12px 24px rgba(0,0,0,0.15)',
                },
              }}>
                {room.available && (
                  <Box sx={{
                    position: 'absolute',
                    top: 0,
                    right: 0,
                    width: 0,
                    height: 0,
                    borderStyle: 'solid',
                    borderWidth: '0 60px 60px 0',
                    borderColor: 'transparent #4caf50 transparent transparent',
                  }} />
                )}
                <CardContent sx={{ flexGrow: 1, p: 3 }}>
                  <Box display="flex" alignItems="flex-start" justifyContent="space-between" mb={2}>
                    <Box>
                      <Box display="flex" alignItems="center" mb={1}>
                        <HotelIcon sx={{ mr: 1, color: room.available ? 'primary.main' : 'text.secondary', fontSize: 28 }} />
                        <Typography variant="h5" sx={{ fontWeight: 600 }}>
                          Room {room.room_number}
                        </Typography>
                      </Box>
                      <Chip
                        label={room.room_type}
                        size="small"
                        sx={{ 
                          mt: 0.5,
                          backgroundColor: room.available ? 'primary.light' : 'grey.300',
                          color: room.available ? 'white' : 'text.secondary',
                          fontWeight: 500,
                        }}
                      />
                    </Box>
                    <Chip
                      label={room.available ? 'Available' : 'Booked'}
                      color={room.available ? 'success' : 'error'}
                      size="small"
                      sx={{ fontWeight: 600 }}
                    />
                  </Box>

                  {room.description && (
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2, minHeight: 40 }}>
                      {room.description}
                    </Typography>
                  )}

                  <Box sx={{ mb: 2 }}>
                    <Typography variant="body2" color="text.secondary" gutterBottom>
                      Max Occupancy
                    </Typography>
                    <Typography variant="h6" color="text.primary">
                      {room.max_occupancy} {room.max_occupancy === 1 ? 'Guest' : 'Guests'}
                    </Typography>
                  </Box>

                  <Box sx={{ mb: 3, display: 'flex', alignItems: 'baseline' }}>
                    <Typography variant="h4" color="primary" sx={{ fontWeight: 700 }}>
                      ${typeof room.price_per_night === 'string' ? parseFloat(room.price_per_night).toFixed(0) : room.price_per_night.toFixed(0)}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ ml: 0.5 }}>
                      /night
                    </Typography>
                  </Box>

                  <Button
                    variant="contained"
                    fullWidth
                    disabled={!room.available}
                    onClick={() => handleBookRoom(room)}
                    startIcon={<BookIcon />}
                    sx={{
                      py: 1.5,
                      fontWeight: 600,
                      fontSize: '1rem',
                      background: room.available 
                        ? 'linear-gradient(135deg, #1a73e8 0%, #4285f4 100%)'
                        : undefined,
                    }}
                  >
                    {room.available ? 'Book Now' : 'Unavailable'}
                  </Button>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      {filteredRooms.length === 0 && !loading && (
        <Box textAlign="center" py={4}>
          <Typography variant="h6" color="text.secondary">
            No rooms found matching your criteria
          </Typography>
        </Box>
      )}

      {/* Booking Dialog */}
      <Dialog open={bookingDialogOpen} onClose={() => setBookingDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Book Room {selectedRoom?.id}</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            <TextField
              fullWidth
              label="Guest Name"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth
              label="Guest Email"
              type="email"
              value={guestEmail}
              onChange={(e) => setGuestEmail(e.target.value)}
              sx={{ mb: 2 }}
            />
            {selectedRoom && (
              <Box sx={{ p: 2, backgroundColor: '#f5f5f5', borderRadius: 1 }}>
                <Typography variant="body2">
                  Room: {selectedRoom.room_type} - ${selectedRoom.price_per_night}/night
                </Typography>
                <Typography variant="body2">
                  Check-in: Today | Check-out: Tomorrow
                </Typography>
              </Box>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBookingDialogOpen(false)}>Cancel</Button>
          <Button
            onClick={handleConfirmBooking}
            variant="contained"
            disabled={bookingLoading || !guestName || !guestEmail}
          >
            {bookingLoading ? <CircularProgress size={20} /> : 'Confirm Booking'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Success Snackbar */}
      <Snackbar
        open={snackbarOpen}
        autoHideDuration={6000}
        onClose={() => setSnackbarOpen(false)}
      >
        <Alert onClose={() => setSnackbarOpen(false)} severity="success">
          {snackbarMessage}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default RoomsPage;

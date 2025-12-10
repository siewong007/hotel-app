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
  Snackbar,
  Divider,
  List,
  ListItem,
  ListItemText,
  ListItemAvatar,
  Avatar,
  Paper
} from '@mui/material';
import {
  Hotel as HotelIcon,
  Search as SearchIcon,
  EventAvailable as BookIcon,
  Star as StarIcon,
  StarBorder as StarBorderIcon,
  StarHalf as StarHalfIcon,
  Close as CloseIcon,
  ThumbUp as ThumbUpIcon,
  Verified as VerifiedIcon,
  Person as PersonIcon
} from '@mui/icons-material';
import { HotelAPIService } from '../api';
import { Room, GuestCreateRequest, BookingCreateRequest } from '../types';

interface GuestReview {
  id: number;
  guest_name: string;
  overall_rating: number;
  cleanliness_rating?: number;
  staff_rating?: number;
  facilities_rating?: number;
  value_rating?: number;
  location_rating?: number;
  title?: string;
  review_text?: string;
  pros?: string;
  cons?: string;
  recommend?: boolean;
  stay_type?: string;
  is_verified: boolean;
  helpful_count: number;
  created_at: string;
}

interface AggregatedRoomType {
  room_type: string;
  available_count: number;
  total_count: number;
  available_rooms: Room[];
  price_per_night: number;
  max_occupancy: number;
  description?: string;
  average_rating?: number;
  review_count?: number;
}

const RoomsPage: React.FC = () => {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [filteredRooms, setFilteredRooms] = useState<Room[]>([]);
  const [aggregatedRoomTypes, setAggregatedRoomTypes] = useState<AggregatedRoomType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Helper function to render star rating
  const renderStars = (rating: number | undefined) => {
    if (!rating) return null;

    const stars = [];
    const fullStars = Math.floor(rating);
    const hasHalfStar = rating % 1 >= 0.5;

    for (let i = 0; i < fullStars; i++) {
      stars.push(<StarIcon key={`full-${i}`} sx={{ fontSize: 16, color: '#FFB400' }} />);
    }
    if (hasHalfStar) {
      stars.push(<StarHalfIcon key="half" sx={{ fontSize: 16, color: '#FFB400' }} />);
    }
    const emptyStars = 5 - Math.ceil(rating);
    for (let i = 0; i < emptyStars; i++) {
      stars.push(<StarBorderIcon key={`empty-${i}`} sx={{ fontSize: 16, color: '#FFB400' }} />);
    }

    return stars;
  };

  // Search filters
  const [roomTypeFilter, setRoomTypeFilter] = useState<string>('');
  const [maxPriceFilter, setMaxPriceFilter] = useState<string>('');

  // Booking dialog
  const [bookingDialogOpen, setBookingDialogOpen] = useState(false);
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [selectedRoomType, setSelectedRoomType] = useState<AggregatedRoomType | null>(null);
  const [availableRoomsForBooking, setAvailableRoomsForBooking] = useState<Room[]>([]);
  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [checkInDate, setCheckInDate] = useState('');
  const [checkOutDate, setCheckOutDate] = useState('');
  const [postType, setPostType] = useState<'normal_stay' | 'same_day'>('normal_stay');
  const [rateCode, setRateCode] = useState('RACK');
  const [bookingLoading, setBookingLoading] = useState(false);

  // Room details dialog
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [selectedRoomTypeForDetails, setSelectedRoomTypeForDetails] = useState<AggregatedRoomType | null>(null);
  const [roomReviews, setRoomReviews] = useState<GuestReview[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);

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

  // Aggregate rooms by type
  const aggregateRoomsByType = (roomsList: Room[]): AggregatedRoomType[] => {
    const typeMap: { [key: string]: AggregatedRoomType } = {};

    roomsList.forEach(room => {
      if (!typeMap[room.room_type]) {
        typeMap[room.room_type] = {
          room_type: room.room_type,
          available_count: 0,
          total_count: 0,
          available_rooms: [],
          price_per_night: typeof room.price_per_night === 'string'
            ? parseFloat(room.price_per_night)
            : room.price_per_night,
          max_occupancy: room.max_occupancy,
          description: room.description,
          average_rating: 0,
          review_count: 0,
        };
      }

      typeMap[room.room_type].total_count++;
      if (room.available) {
        typeMap[room.room_type].available_count++;
        typeMap[room.room_type].available_rooms.push(room);
      }

      // Aggregate ratings - since reviews are by room type, not individual rooms,
      // we take the rating/count from the first room with data
      if (room.average_rating && room.review_count) {
        const current = typeMap[room.room_type];
        // Only set if not already set (use first room's data)
        if (!current.average_rating || current.average_rating === 0) {
          current.average_rating = room.average_rating;
          current.review_count = room.review_count;
        }
      }
    });

    return Object.values(typeMap);
  };

  // Calculate fully reserved room types
  const getFullyReservedRoomTypes = (): string[] => {
    return aggregatedRoomTypes
      .filter(type => type.available_count === 0 && type.total_count > 0)
      .map(type => type.room_type);
  };

  const filterRooms = () => {
    let filtered = rooms;

    // Only show available rooms
    filtered = filtered.filter(room => room.available);

    if (roomTypeFilter) {
      filtered = filtered.filter(room =>
        room.room_type.toLowerCase().includes(roomTypeFilter.toLowerCase())
      );
    }

    if (maxPriceFilter) {
      const maxPrice = parseFloat(maxPriceFilter);
      if (!isNaN(maxPrice)) {
        filtered = filtered.filter(room => {
          const price = typeof room.price_per_night === 'string'
            ? parseFloat(room.price_per_night)
            : room.price_per_night;
          return price <= maxPrice;
        });
      }
    }

    setFilteredRooms(filtered);

    // Create aggregated view
    const aggregated = aggregateRoomsByType(filtered);
    setAggregatedRoomTypes(aggregated);
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

  const handleBookRoomType = (roomType: AggregatedRoomType) => {
    setSelectedRoomType(roomType);
    setAvailableRoomsForBooking(roomType.available_rooms);
    // Pre-select first available room
    if (roomType.available_rooms.length > 0) {
      setSelectedRoom(roomType.available_rooms[0]);
    }
    // Set default dates: today and tomorrow
    const today = new Date().toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    setCheckInDate(today);
    setCheckOutDate(tomorrow);
    setBookingDialogOpen(true);
  };

  const handleConfirmBooking = async () => {
    if (!selectedRoom || !guestName || !guestEmail || !checkInDate || !checkOutDate) {
      setError('Please fill in all required fields including dates');
      return;
    }

    // Validate dates
    const checkIn = new Date(checkInDate);
    const checkOut = new Date(checkOutDate);
    if (checkOut <= checkIn) {
      setError('Check-out date must be after check-in date');
      return;
    }

    try {
      setBookingLoading(true);

      // Create guest
      const nameParts = guestName.trim().split(' ');
      const first_name = nameParts[0] || '';
      const last_name = nameParts.slice(1).join(' ') || '';

      const guest = await HotelAPIService.createGuest({
        first_name,
        last_name,
        email: guestEmail
      });

      // Create booking with selected dates and new fields
      await HotelAPIService.createBooking({
        guest_id: guest.id,
        room_id: selectedRoom.id,
        check_in_date: checkInDate,
        check_out_date: checkOutDate,
        post_type: postType,
        rate_code: rateCode
      });

      setSnackbarMessage(`Booking confirmed! Check-in: ${checkInDate}, Check-out: ${checkOutDate}`);
      setSnackbarOpen(true);

      // Reset form and close dialog
      setGuestName('');
      setGuestEmail('');
      setCheckInDate('');
      setCheckOutDate('');
      setPostType('normal_stay');
      setRateCode('RACK');
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

  const handleRoomTypeClick = async (roomType: AggregatedRoomType) => {
    // Store the aggregated room type for details
    setSelectedRoomTypeForDetails(roomType);
    setDetailsDialogOpen(true);
    setReviewsLoading(true);

    try {
      const reviews = await HotelAPIService.getRoomReviews(roomType.room_type);
      console.log(`Fetched ${reviews.length} reviews for room type: ${roomType.room_type}`);
      console.log('Reviews:', reviews);
      setRoomReviews(reviews);
    } catch (err) {
      console.error('Failed to load reviews:', err);
      setRoomReviews([]);
    } finally {
      setReviewsLoading(false);
    }
  };

  const handleCloseDetails = () => {
    setDetailsDialogOpen(false);
    setSelectedRoomTypeForDetails(null);
    setRoomReviews([]);
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
          Book Room
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Browse available rooms and make reservations. Search by type or price to find the perfect room.
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

      {/* Fully Reserved Room Types Display */}
      {rooms.length > 0 && getFullyReservedRoomTypes().length > 0 && (
        <Alert severity="warning" sx={{ mb: 3 }}>
          <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
            Fully Reserved Room Types
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {getFullyReservedRoomTypes().map(type => (
              <Chip
                key={type}
                label={type}
                color="error"
                size="small"
                icon={<HotelIcon />}
              />
            ))}
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            All rooms of these types are currently booked. Please check back later or choose a different room type.
          </Typography>
        </Alert>
      )}

      {/* Room Types List */}
      {aggregatedRoomTypes.length === 0 ? (
        <Card sx={{ p: 4, textAlign: 'center' }}>
          <HotelIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
          <Typography variant="h6" color="text.secondary">
            No rooms found matching your criteria
          </Typography>
        </Card>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {aggregatedRoomTypes.map((roomType) => (
            <Card
              key={roomType.room_type}
              onClick={() => handleRoomTypeClick(roomType)}
              sx={{
                border: roomType.available_count > 0 ? '1px solid #e0e0e0' : '1px solid #ffcdd2',
                transition: 'all 0.3s ease',
                cursor: 'pointer',
                '&:hover': {
                  boxShadow: '0px 4px 20px rgba(0,0,0,0.1)',
                  transform: 'translateX(4px)',
                },
              }}
            >
              <CardContent sx={{ p: 2.5 }}>
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 3,
                    flexWrap: 'wrap',
                  }}
                >
                  {/* Room Type Icon */}
                  <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 180 }}>
                    <HotelIcon sx={{ mr: 1, color: 'primary.main', fontSize: 32 }} />
                    <Box>
                      <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                        ROOM TYPE
                      </Typography>
                      <Typography variant="h5" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                        {roomType.room_type}
                      </Typography>
                    </Box>
                  </Box>

                  {/* Availability */}
                  <Box sx={{ minWidth: 140 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                      AVAILABILITY
                    </Typography>
                    <Typography variant="body1" sx={{ fontWeight: 600, color: roomType.available_count > 0 ? 'success.main' : 'error.main' }}>
                      {roomType.available_count} / {roomType.total_count} Available
                    </Typography>
                  </Box>

                  {/* Max Occupancy */}
                  <Box sx={{ minWidth: 100 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                      OCCUPANCY
                    </Typography>
                    <Typography variant="body1" sx={{ fontWeight: 500 }}>
                      {roomType.max_occupancy} {roomType.max_occupancy === 1 ? 'Guest' : 'Guests'}
                    </Typography>
                  </Box>

                  {/* Price */}
                  <Box sx={{ minWidth: 120 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                      PRICE/NIGHT
                    </Typography>
                    <Typography variant="h6" color="primary" sx={{ fontWeight: 700 }}>
                      ${roomType.price_per_night.toFixed(0)}
                    </Typography>
                  </Box>

                  {/* Rating */}
                  {roomType.average_rating && roomType.average_rating > 0 && (
                    <Box sx={{ minWidth: 140 }}>
                      <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                        GUEST RATING
                      </Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Box sx={{ display: 'flex' }}>
                          {renderStars(roomType.average_rating)}
                        </Box>
                        <Typography variant="body2" sx={{ fontWeight: 600, ml: 0.5 }}>
                          {roomType.average_rating.toFixed(1)}
                        </Typography>
                        {roomType.review_count && roomType.review_count > 0 && (
                          <Typography variant="caption" color="text.secondary">
                            ({roomType.review_count} {roomType.review_count === 1 ? 'review' : 'reviews'})
                          </Typography>
                        )}
                      </Box>
                    </Box>
                  )}

                  {/* Description */}
                  {roomType.description && (
                    <Box sx={{ flex: 1, minWidth: 200 }}>
                      <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                        DESCRIPTION
                      </Typography>
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                        }}
                      >
                        {roomType.description}
                      </Typography>
                    </Box>
                  )}

                  {/* Action Button */}
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, ml: 'auto' }}>
                    <Button
                      variant="contained"
                      disabled={roomType.available_count === 0}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleBookRoomType(roomType);
                      }}
                      startIcon={<BookIcon />}
                      sx={{
                        minWidth: 160,
                        fontWeight: 600,
                        background: roomType.available_count > 0
                          ? 'linear-gradient(135deg, #1a73e8 0%, #4285f4 100%)'
                          : undefined,
                      }}
                    >
                      {roomType.available_count > 0 ? 'Book Now' : 'Fully Booked'}
                    </Button>
                  </Box>
                </Box>
              </CardContent>
            </Card>
          ))}
        </Box>
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
        <DialogTitle>Book {selectedRoomType?.room_type} Room</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            {/* Room Selection (if multiple available) */}
            {availableRoomsForBooking.length > 1 && (
              <TextField
                select
                fullWidth
                label="Select Room"
                value={selectedRoom?.id || ''}
                onChange={(e) => {
                  const room = availableRoomsForBooking.find(r => r.id === e.target.value);
                  if (room) setSelectedRoom(room);
                }}
                sx={{ mb: 2 }}
              >
                {availableRoomsForBooking.map((room) => (
                  <MenuItem key={room.id} value={room.id}>
                    Room {room.room_number} - {room.room_type}
                  </MenuItem>
                ))}
              </TextField>
            )}

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
            <TextField
              fullWidth
              label="Check-in Date"
              type="date"
              value={checkInDate}
              onChange={(e) => setCheckInDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
              inputProps={{ min: new Date().toISOString().split('T')[0] }}
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth
              label="Check-out Date"
              type="date"
              value={checkOutDate}
              onChange={(e) => setCheckOutDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
              inputProps={{ min: checkInDate || new Date().toISOString().split('T')[0] }}
              sx={{ mb: 2 }}
            />
            <TextField
              select
              fullWidth
              label="Post Type"
              value={postType}
              onChange={(e) => setPostType(e.target.value as 'normal_stay' | 'same_day')}
              sx={{ mb: 2 }}
            >
              <MenuItem value="normal_stay">Normal Stay</MenuItem>
              <MenuItem value="same_day">Same Day</MenuItem>
            </TextField>
            <TextField
              select
              fullWidth
              label="Rate Code"
              value={rateCode}
              onChange={(e) => setRateCode(e.target.value)}
              sx={{ mb: 2 }}
            >
              <MenuItem value="RACK">RACK (Standard Rate)</MenuItem>
              <MenuItem value="OVR">OVR (Override Rate)</MenuItem>
            </TextField>
            {selectedRoom && selectedRoomType && (
              <Box sx={{ p: 2, backgroundColor: '#f5f5f5', borderRadius: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
                  Booking Summary
                </Typography>
                <Typography variant="body2">
                  Room Type: {selectedRoomType.room_type}
                </Typography>
                <Typography variant="body2">
                  Room Number: #{selectedRoom.room_number}
                </Typography>
                <Typography variant="body2">
                  Available Rooms: {selectedRoomType.available_count} of {selectedRoomType.total_count}
                </Typography>
                <Typography variant="body2">
                  Price: ${typeof selectedRoom.price_per_night === 'string'
                    ? parseFloat(selectedRoom.price_per_night).toFixed(0)
                    : selectedRoom.price_per_night.toFixed(0)}/night
                </Typography>
                <Typography variant="body2">
                  Post Type: {postType === 'normal_stay' ? 'Normal Stay' : 'Same Day'}
                </Typography>
                <Typography variant="body2">
                  Rate Code: {rateCode}
                </Typography>
                {checkInDate && checkOutDate && (
                  <Typography variant="body2" sx={{ mt: 1, fontWeight: 500 }}>
                    Duration: {Math.ceil((new Date(checkOutDate).getTime() - new Date(checkInDate).getTime()) / (1000 * 60 * 60 * 24))} night(s)
                  </Typography>
                )}
              </Box>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBookingDialogOpen(false)}>Cancel</Button>
          <Button
            onClick={handleConfirmBooking}
            variant="contained"
            disabled={bookingLoading || !guestName || !guestEmail || !checkInDate || !checkOutDate}
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

      {/* Room Details Dialog */}
      <Dialog
        open={detailsDialogOpen}
        onClose={handleCloseDetails}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', pb: 1 }}>
          <Box>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>
              {selectedRoomTypeForDetails?.room_type}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              All reviews for this room type
            </Typography>
            {selectedRoomTypeForDetails?.average_rating && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
                <Box sx={{ display: 'flex' }}>
                  {renderStars(selectedRoomTypeForDetails.average_rating)}
                </Box>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {selectedRoomTypeForDetails.average_rating.toFixed(1)}
                </Typography>
                {selectedRoomTypeForDetails.review_count && (
                  <Typography variant="caption" color="text.secondary">
                    ({selectedRoomTypeForDetails.review_count} {selectedRoomTypeForDetails.review_count === 1 ? 'review' : 'reviews'})
                  </Typography>
                )}
              </Box>
            )}
          </Box>
          <Button onClick={handleCloseDetails} sx={{ minWidth: 'auto' }}>
            <CloseIcon />
          </Button>
        </DialogTitle>
        <DialogContent dividers>
          {/* Room Type Details */}
          <Box sx={{ mb: 3 }}>
            <Grid container spacing={2}>
              <Grid item xs={6} sm={3}>
                <Typography variant="caption" color="text.secondary">Price/Night</Typography>
                <Typography variant="h6" color="primary" sx={{ fontWeight: 700 }}>
                  ${selectedRoomTypeForDetails?.price_per_night?.toFixed(0)}
                </Typography>
              </Grid>
              <Grid item xs={6} sm={3}>
                <Typography variant="caption" color="text.secondary">Occupancy</Typography>
                <Typography variant="body1" sx={{ fontWeight: 600 }}>
                  {selectedRoomTypeForDetails?.max_occupancy} Guests
                </Typography>
              </Grid>
              <Grid item xs={6} sm={3}>
                <Typography variant="caption" color="text.secondary">Availability</Typography>
                <Typography variant="body1" sx={{ fontWeight: 600, color: selectedRoomTypeForDetails && selectedRoomTypeForDetails.available_count > 0 ? 'success.main' : 'error.main' }}>
                  {selectedRoomTypeForDetails?.available_count} / {selectedRoomTypeForDetails?.total_count}
                </Typography>
              </Grid>
              <Grid item xs={6} sm={3}>
                <Typography variant="caption" color="text.secondary">Total Rooms</Typography>
                <Typography variant="body1" sx={{ fontWeight: 600 }}>
                  {selectedRoomTypeForDetails?.total_count} {selectedRoomTypeForDetails?.total_count === 1 ? 'Room' : 'Rooms'}
                </Typography>
              </Grid>
            </Grid>
            {selectedRoomTypeForDetails?.description && (
              <Box sx={{ mt: 2 }}>
                <Typography variant="body2" color="text.secondary">
                  {selectedRoomTypeForDetails.description}
                </Typography>
              </Box>
            )}
          </Box>

          <Divider sx={{ my: 2 }} />

          {/* Customer Reviews */}
          <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Box>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>
                  Customer Reviews for {selectedRoomTypeForDetails?.room_type}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Reviews from all guests who stayed in this room type
                </Typography>
              </Box>
              {roomReviews.length > 0 && (
                <Chip
                  label={`${roomReviews.length} ${roomReviews.length === 1 ? 'Review' : 'Reviews'}`}
                  size="small"
                  color="primary"
                  sx={{ fontWeight: 600 }}
                />
              )}
            </Box>

            {reviewsLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                <CircularProgress />
              </Box>
            ) : roomReviews.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
                No reviews yet for this room type.
              </Typography>
            ) : (
              <Box>
                {roomReviews.length > 3 && (
                  <Alert severity="info" sx={{ mb: 2 }}>
                    <Typography variant="body2">
                      Showing all {roomReviews.length} reviews. Scroll down to see more.
                    </Typography>
                  </Alert>
                )}
                <List sx={{
                  maxHeight: 600,
                  overflow: 'auto',
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 1,
                  bgcolor: 'background.paper'
                }}>
                {roomReviews.map((review, index) => (
                  <React.Fragment key={review.id}>
                    {index > 0 && <Divider sx={{ my: 2 }} />}
                    <ListItem alignItems="flex-start" sx={{ px: 0 }}>
                      <ListItemAvatar>
                        <Avatar sx={{ bgcolor: 'primary.main' }}>
                          <PersonIcon />
                        </Avatar>
                      </ListItemAvatar>
                      <ListItemText
                        primary={
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                              {review.guest_name}
                            </Typography>
                            {review.is_verified && (
                              <VerifiedIcon sx={{ fontSize: 16, color: 'primary.main' }} />
                            )}
                            <Box sx={{ display: 'flex', ml: 'auto' }}>
                              {renderStars(review.overall_rating)}
                            </Box>
                          </Box>
                        }
                        secondary={
                          <Box>
                            {review.title && (
                              <Typography variant="subtitle2" sx={{ fontWeight: 600, mt: 0.5 }}>
                                {review.title}
                              </Typography>
                            )}
                            {review.review_text && (
                              <Typography variant="body2" color="text.primary" sx={{ mt: 0.5 }}>
                                {review.review_text}
                              </Typography>
                            )}
                            {review.pros && (
                              <Box sx={{ mt: 1 }}>
                                <Typography variant="caption" color="success.main" sx={{ fontWeight: 600 }}>
                                  Pros:
                                </Typography>
                                <Typography variant="body2" color="text.secondary">
                                  {review.pros}
                                </Typography>
                              </Box>
                            )}
                            {review.cons && (
                              <Box sx={{ mt: 1 }}>
                                <Typography variant="caption" color="error.main" sx={{ fontWeight: 600 }}>
                                  Cons:
                                </Typography>
                                <Typography variant="body2" color="text.secondary">
                                  {review.cons}
                                </Typography>
                              </Box>
                            )}
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 1 }}>
                              <Typography variant="caption" color="text.secondary">
                                {new Date(review.created_at).toLocaleDateString()}
                              </Typography>
                              {review.helpful_count > 0 && (
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                  <ThumbUpIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                                  <Typography variant="caption" color="text.secondary">
                                    {review.helpful_count}
                                  </Typography>
                                </Box>
                              )}
                            </Box>
                          </Box>
                        }
                      />
                    </ListItem>
                  </React.Fragment>
                ))}
              </List>
              </Box>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDetails}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default RoomsPage;

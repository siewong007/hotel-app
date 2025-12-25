import React, { useState, useEffect, useRef } from 'react';
import {
  Box,
  Paper,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  CircularProgress,
  Alert,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Button,
  IconButton,
} from '@mui/material';
import {
  ChevronLeft,
  ChevronRight,
  CalendarMonth,
  Refresh,
} from '@mui/icons-material';
import { HotelAPIService } from '../../../api';
import { Room, BookingWithDetails } from '../../../types';
import {
  getUnifiedStatusColor,
  getUnifiedStatusLabel,
} from '../../../config/roomStatusConfig';
import { useCurrency } from '../../../hooks/useCurrency';

interface TimelineBooking {
  id: number | string;
  room_id: number | string;
  guest_name: string;
  guest_email?: string;
  guest_phone?: string;
  check_in_date: string;
  check_out_date: string;
  status: string;
}

interface TimelineCell {
  booking: TimelineBooking | null;
  isStart: boolean;
  isEnd: boolean;
  isContinuation: boolean;
}

const RoomReservationTimeline: React.FC = () => {
  const { format: formatCurrency } = useCurrency();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [bookings, setBookings] = useState<TimelineBooking[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [daysToShow, setDaysToShow] = useState(14);
  const [startDate, setStartDate] = useState(new Date());
  const loadingRef = useRef(false);

  useEffect(() => {
    loadData();
    // Auto-refresh every 30 seconds to stay in sync with room management
    const interval = setInterval(() => {
      loadData();
    }, 30000);
    return () => clearInterval(interval);
  }, [startDate, daysToShow]);

  const loadData = async () => {
    // Prevent duplicate calls
    if (loadingRef.current) {
      console.log('Timeline - Skipping duplicate API call');
      return;
    }

    loadingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const [roomsData, bookingsData] = await Promise.all([
        HotelAPIService.getAllRooms(),
        HotelAPIService.getBookingsWithDetails(),
      ]);

      console.log('Timeline - Loaded rooms:', roomsData.length);
      console.log('Timeline - Loaded bookings:', bookingsData.length);
      console.log('Timeline - Sample booking:', bookingsData[0]);

      // Sort rooms by room number
      const sortedRooms = roomsData.sort((a, b) => {
        const numA = parseInt(a.room_number);
        const numB = parseInt(b.room_number);
        return numA - numB;
      });

      // Filter bookings to only include relevant date range and active statuses
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + daysToShow);

      console.log('Timeline - Date range:', startDate.toISOString().split('T')[0], 'to', endDate.toISOString().split('T')[0]);

      // Debug all bookings first
      console.log('Timeline - All bookings details:');
      bookingsData.forEach((b: BookingWithDetails) => {
        console.log(`  Room ${b.room_number} (ID: ${b.room_id}): ${b.guest_name}, ${b.check_in_date} to ${b.check_out_date}, status: ${b.status}`);
      });

      const relevantBookings: TimelineBooking[] = bookingsData
        .filter((b: BookingWithDetails) => {
          // Don't filter out any bookings - show all active ones
          if (['cancelled', 'no_show'].includes(b.status as string)) {
            console.log(`  Filtering out ${b.guest_name} in room ${b.room_number}: ${b.status}`);
            return false;
          }

          const bookingEnd = new Date(b.check_out_date);
          const bookingStart = new Date(b.check_in_date);

          // More lenient date filtering - include if booking overlaps with timeline at all
          const isRelevant = bookingStart <= endDate && bookingEnd >= startDate;

          if (isRelevant) {
            console.log(`  Including ${b.guest_name} in room ${b.room_number}: ${b.check_in_date} to ${b.check_out_date}, status: ${b.status}`);
          } else {
            console.log(`  Excluding ${b.guest_name} in room ${b.room_number}: outside date range (${b.check_in_date} to ${b.check_out_date})`);
          }

          return isRelevant;
        })
        .map((b: BookingWithDetails) => ({
          id: b.id,
          room_id: b.room_id,
          guest_name: b.guest_name || 'Unknown Guest',
          guest_email: b.guest_email,
          guest_phone: b.guest_phone,
          check_in_date: b.check_in_date,
          check_out_date: b.check_out_date,
          status: b.status as string,
        }));

      console.log('Timeline - Filtered bookings from API:', relevantBookings.length);

      // Create synthetic bookings ONLY for rooms with "occupied" or "checked_in" status that don't have bookings
      // Note: "reserved" rooms should ALWAYS have proper bookings with guest details now
      const syntheticBookings: TimelineBooking[] = [];
      roomsData.forEach((room: Room) => {
        // Skip if this room already has a booking in the date range
        const hasBooking = relevantBookings.some(b => Number(b.room_id) === Number(room.id));
        if (hasBooking) return;

        // Only create synthetic entries for occupied/checked_in (not reserved - those must have bookings)
        const occupiedStatuses = ['occupied', 'checked_in'];
        if (room.status && occupiedStatuses.includes(room.status)) {
          // Use reserved dates if available, otherwise show for entire timeline
          const hasDefinedDates = room.reserved_start_date && room.reserved_end_date;
          const syntheticStart = room.reserved_start_date || startDate.toISOString().split('T')[0];
          const syntheticEnd = room.reserved_end_date || endDate.toISOString().split('T')[0];

          // Create a descriptive name indicating manual occupation
          let guestName = 'Manual Occupancy';
          if (!hasDefinedDates) {
            guestName += ' (No end date)';
          }

          console.log(`  Creating synthetic booking for room ${room.room_number} (status: ${room.status}, has dates: ${hasDefinedDates})`);

          syntheticBookings.push({
            id: `synthetic-${room.id}`,
            room_id: room.id,
            guest_name: guestName,
            check_in_date: syntheticStart,
            check_out_date: syntheticEnd,
            status: room.status,
          });
        }

        // Log warning for reserved rooms without bookings (this shouldn't happen with new logic)
        if (room.status === 'reserved' && !hasBooking) {
          console.warn(`  WARNING: Room ${room.room_number} is reserved but has no booking! This indicates data inconsistency.`);
        }
      });

      console.log('Timeline - Synthetic bookings created:', syntheticBookings.length);

      // Merge actual and synthetic bookings
      const allBookings = [...relevantBookings, ...syntheticBookings];
      console.log('Timeline - Total bookings (actual + synthetic):', allBookings.length);

      setRooms(sortedRooms);
      setBookings(allBookings);
    } catch (err: any) {
      console.error('Timeline - Error loading data:', err);
      setError(err.message || 'Failed to load timeline data');
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  };

  const getDates = (): Date[] => {
    const dates: Date[] = [];
    for (let i = 0; i < daysToShow; i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      dates.push(date);
    }
    return dates;
  };

  const getTimelineCell = (room: Room, date: Date): TimelineCell => {
    const dateStr = date.toISOString().split('T')[0];
    const nextDateStr = new Date(date.getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const booking = bookings.find((b) => {
      const roomIdMatch = Number(b.room_id) === Number(room.id);
      if (!roomIdMatch) return false;

      const checkIn = b.check_in_date.split('T')[0];
      const checkOut = b.check_out_date.split('T')[0];

      // Include checkout day in display when booking is still checked_in
      // This ensures guests who haven't checked out yet still show on the timeline
      const isCheckedIn = b.status === 'checked_in' || b.status === 'auto_checked_in';
      const dateMatch = isCheckedIn
        ? (dateStr >= checkIn && dateStr <= checkOut)  // Include checkout day for active stays
        : (dateStr >= checkIn && dateStr < checkOut);  // Standard: exclude checkout day for completed/upcoming

      return dateMatch;
    });

    if (!booking) {
      return { booking: null, isStart: false, isEnd: false, isContinuation: false };
    }

    const checkIn = booking.check_in_date.split('T')[0];
    const checkOut = booking.check_out_date.split('T')[0];
    const isCheckoutDay = dateStr === checkOut;

    return {
      booking,
      isStart: dateStr === checkIn,
      isEnd: nextDateStr === checkOut || isCheckoutDay,
      isContinuation: !!(dateStr !== checkIn && !isCheckoutDay),
    };
  };

  // Use centralized status config for consistent colors
  const getStatusColor = (status: string): string => {
    return getUnifiedStatusColor(status);
  };

  // Use centralized status config for consistent labels
  const getStatusLabel = (status: string): string => {
    return getUnifiedStatusLabel(status);
  };

  const goToPreviousWeek = () => {
    const newDate = new Date(startDate);
    newDate.setDate(newDate.getDate() - 7);
    setStartDate(newDate);
  };

  const goToNextWeek = () => {
    const newDate = new Date(startDate);
    newDate.setDate(newDate.getDate() + 7);
    setStartDate(newDate);
  };

  const goToToday = () => {
    setStartDate(new Date());
  };

  const dates = getDates();

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h4" sx={{ fontWeight: 600, color: 'primary.main' }}>
          Room Reservation Timeline
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel>Days to Show</InputLabel>
            <Select
              value={daysToShow}
              label="Days to Show"
              onChange={(e) => setDaysToShow(Number(e.target.value))}
            >
              <MenuItem value={7}>7 Days</MenuItem>
              <MenuItem value={14}>14 Days</MenuItem>
              <MenuItem value={30}>30 Days</MenuItem>
              <MenuItem value={60}>60 Days</MenuItem>
            </Select>
          </FormControl>
          <Button
            variant="outlined"
            size="small"
            startIcon={<CalendarMonth />}
            onClick={goToToday}
          >
            Today
          </Button>
          <IconButton onClick={goToPreviousWeek} size="small">
            <ChevronLeft />
          </IconButton>
          <Typography variant="body2" sx={{ minWidth: 150, textAlign: 'center' }}>
            {startDate.toLocaleDateString()} - {dates[dates.length - 1]?.toLocaleDateString()}
          </Typography>
          <IconButton onClick={goToNextWeek} size="small">
            <ChevronRight />
          </IconButton>
          <IconButton onClick={loadData} size="small">
            <Refresh />
          </IconButton>
        </Box>
      </Box>

      {/* Debug Info & Legend */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 600 }}>
          Status Legend:
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
          <Chip label="Reserved" sx={{ bgcolor: '#42a5f5', color: 'white' }} size="small" />
          <Chip label="Occupied" sx={{ bgcolor: '#ffa726', color: 'white' }} size="small" />
          <Chip label="Available" sx={{ bgcolor: '#66bb6a', color: 'white' }} size="small" />
          <Chip label="Pending" sx={{ bgcolor: '#ffeb3b', color: 'black' }} size="small" />
        </Box>
        <Box sx={{ mb: 1 }}>
          <Typography variant="caption" color="text.secondary" display="block">
            <strong>Diagonal stripes</strong> indicate manually occupied rooms without a proper booking record.
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block">
            <strong>Reserved rooms</strong> always show guest details from their associated booking.
          </Typography>
        </Box>
        <Typography variant="caption" color="text.secondary">
          Loaded: {rooms.length} rooms, {bookings.length} bookings in date range
        </Typography>
      </Paper>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {bookings.some(b => String(b.id).startsWith('synthetic-')) && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
            Manual Occupancy Detected
          </Typography>
          <Typography variant="caption">
            Some rooms (with diagonal stripes) are manually marked as occupied without a proper booking record.
            For proper guest tracking, please create a booking through "Walk-in Check-in" or "Book Room" options.
          </Typography>
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
          <CircularProgress />
        </Box>
      ) : (
        <TableContainer component={Paper} sx={{ maxHeight: 'calc(100vh - 300px)', overflow: 'auto' }}>
          <Table stickyHeader size="small">
            <TableHead>
              <TableRow>
                <TableCell
                  sx={{
                    fontWeight: 700,
                    minWidth: 100,
                    position: 'sticky',
                    left: 0,
                    bgcolor: 'background.paper',
                    zIndex: 3,
                    borderRight: '2px solid',
                    borderColor: 'divider',
                  }}
                >
                  Room
                </TableCell>
                {dates.map((date) => {
                  const isToday =
                    date.toDateString() === new Date().toDateString();
                  return (
                    <TableCell
                      key={date.toISOString()}
                      align="center"
                      sx={{
                        minWidth: 80,
                        fontWeight: 600,
                        bgcolor: isToday ? 'primary.50' : 'background.paper',
                        borderLeft: isToday ? '2px solid' : undefined,
                        borderRight: isToday ? '2px solid' : undefined,
                        borderColor: 'primary.main',
                      }}
                    >
                      <Box>
                        <Typography variant="caption" display="block">
                          {date.toLocaleDateString('en-US', { weekday: 'short' })}
                        </Typography>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {date.getDate()}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {date.toLocaleDateString('en-US', { month: 'short' })}
                        </Typography>
                      </Box>
                    </TableCell>
                  );
                })}
              </TableRow>
            </TableHead>
            <TableBody>
              {rooms.map((room) => (
                <TableRow key={room.id} hover>
                  <TableCell
                    sx={{
                      fontWeight: 600,
                      position: 'sticky',
                      left: 0,
                      bgcolor: 'background.paper',
                      zIndex: 2,
                      borderRight: '2px solid',
                      borderColor: 'divider',
                    }}
                  >
                    <Box>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>
                        {room.room_number}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" display="block">
                        {room.room_type}
                      </Typography>
                      <Typography variant="caption" sx={{ color: 'success.main', fontWeight: 600 }}>
                        {formatCurrency(Number(room.price_per_night))}/night
                      </Typography>
                    </Box>
                  </TableCell>
                  {dates.map((date) => {
                    const cell = getTimelineCell(room, date);
                    const isToday =
                      date.toDateString() === new Date().toDateString();

                    if (!cell.booking) {
                      return (
                        <TableCell
                          key={date.toISOString()}
                          sx={{
                            bgcolor: isToday ? 'primary.50' : 'background.paper',
                            borderLeft: isToday ? '2px solid' : undefined,
                            borderRight: isToday ? '2px solid' : undefined,
                            borderColor: 'primary.main',
                          }}
                        />
                      );
                    }

                    const statusColor = getStatusColor(cell.booking.status);
                    const statusLabel = getStatusLabel(cell.booking.status);

                    const isSyntheticBooking = String(cell.booking.id).startsWith('synthetic-');

                    return (
                      <TableCell
                        key={date.toISOString()}
                        sx={{
                          bgcolor: statusColor,
                          borderLeft: cell.isStart ? '3px solid #000' : '1px solid rgba(255,255,255,0.3)',
                          borderRight: cell.isEnd ? '3px solid #000' : '1px solid rgba(255,255,255,0.3)',
                          borderTop: isSyntheticBooking ? '2px dashed #000' : '1px solid rgba(255,255,255,0.3)',
                          borderBottom: isSyntheticBooking ? '2px dashed #000' : '1px solid rgba(255,255,255,0.3)',
                          cursor: 'pointer',
                          position: 'relative',
                          padding: '6px 8px',
                          minHeight: '60px',
                          verticalAlign: 'top',
                          '&:hover': {
                            opacity: 0.8,
                          },
                          // Add diagonal stripes for synthetic bookings
                          ...(isSyntheticBooking && {
                            backgroundImage: `repeating-linear-gradient(
                              45deg,
                              ${statusColor},
                              ${statusColor} 10px,
                              rgba(0,0,0,0.1) 10px,
                              rgba(0,0,0,0.1) 20px
                            )`,
                          }),
                        }}
                      >
                        <Box
                          sx={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 0.25,
                            height: '100%',
                          }}
                        >
                          {/* Guest Name - shown on all cells */}
                          <Typography
                            variant="caption"
                            sx={{
                              color: 'white',
                              fontWeight: 700,
                              fontSize: '0.7rem',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              textShadow: '0 1px 2px rgba(0,0,0,0.3)',
                            }}
                          >
                            {cell.booking.guest_name}
                          </Typography>

                          {/* Status - shown on all cells */}
                          <Typography
                            variant="caption"
                            sx={{
                              color: 'rgba(255,255,255,0.95)',
                              fontSize: '0.65rem',
                              fontWeight: 600,
                              textShadow: '0 1px 2px rgba(0,0,0,0.3)',
                            }}
                          >
                            {statusLabel}
                          </Typography>

                          {/* Guest phone - shown on start cell for real bookings */}
                          {cell.isStart && !isSyntheticBooking && cell.booking.guest_phone && (
                            <Typography
                              variant="caption"
                              sx={{
                                color: 'rgba(255,255,255,0.9)',
                                fontSize: '0.6rem',
                                textShadow: '0 1px 2px rgba(0,0,0,0.3)',
                              }}
                            >
                              {cell.booking.guest_phone}
                            </Typography>
                          )}

                          {/* Check-in date - shown on start cell */}
                          {cell.isStart && !isSyntheticBooking && (
                            <Typography
                              variant="caption"
                              sx={{
                                color: 'rgba(255,255,255,0.9)',
                                fontSize: '0.6rem',
                                textShadow: '0 1px 2px rgba(0,0,0,0.3)',
                              }}
                            >
                              In: {new Date(cell.booking.check_in_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            </Typography>
                          )}

                          {/* Check-out date - shown on end cell */}
                          {cell.isEnd && !isSyntheticBooking && (
                            <Typography
                              variant="caption"
                              sx={{
                                color: 'rgba(255,255,255,0.9)',
                                fontSize: '0.6rem',
                                textShadow: '0 1px 2px rgba(0,0,0,0.3)',
                              }}
                            >
                              Out: {new Date(cell.booking.check_out_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            </Typography>
                          )}

                          {/* Manual occupancy indicator for synthetic bookings */}
                          {isSyntheticBooking && (
                            <Typography
                              variant="caption"
                              sx={{
                                color: 'rgba(255,255,255,0.85)',
                                fontSize: '0.6rem',
                                fontStyle: 'italic',
                                textShadow: '0 1px 2px rgba(0,0,0,0.3)',
                              }}
                            >
                              No booking record
                            </Typography>
                          )}
                        </Box>
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {rooms.length === 0 && !loading && (
        <Box sx={{ textAlign: 'center', py: 4 }}>
          <Typography variant="body1" color="text.secondary">
            No rooms found
          </Typography>
        </Box>
      )}
    </Box>
  );
};

export default RoomReservationTimeline;

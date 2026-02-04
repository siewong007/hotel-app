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
  Popover,
  Divider,
  alpha,
} from '@mui/material';
import {
  ChevronLeft,
  ChevronRight,
  CalendarMonth,
  Refresh,
  Person,
  Phone,
  Email,
  CalendarToday,
  Payment,
  Hotel,
  CardGiftcard,
  Notes,
  AttachMoney,
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
  booking_number?: string;
  room_id: number | string;
  room_number?: string;
  room_type?: string;
  guest_name: string;
  guest_email?: string;
  guest_phone?: string;
  check_in_date: string;
  check_out_date: string;
  status: string;
  payment_status?: string;
  payment_method?: string;
  total_amount?: number | string;
  price_per_night?: number | string;
  number_of_nights?: number;
  deposit_amount?: number | string;
  deposit_paid?: boolean;
  special_requests?: string;
  is_complimentary?: boolean;
  complimentary_nights?: number;
  complimentary_start_date?: string;
  complimentary_end_date?: string;
  complimentary_reason?: string;
  number_of_guests?: number;
  extra_bed_count?: number;
  extra_bed_charge?: number | string;
  company_name?: string;
  rate_code?: string;
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

  // Popover state for booking details
  const [popoverAnchor, setPopoverAnchor] = useState<HTMLElement | null>(null);
  const [hoveredBooking, setHoveredBooking] = useState<TimelineBooking | null>(null);
  const popoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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
          if (['cancelled', 'no_show', 'checked_out'].includes(b.status as string)) {
            console.log(`  Filtering out ${b.guest_name} in room ${b.room_number}: ${b.status}`);
            return false;
          }

          // Always include checked-in bookings - guest is still in the room
          const isCheckedIn = b.status === 'checked_in' || b.status === 'auto_checked_in';
          if (isCheckedIn) {
            console.log(`  Including checked-in ${b.guest_name} in room ${b.room_number}: ${b.check_in_date} to ${b.check_out_date}, status: ${b.status}`);
            return true;
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
          booking_number: b.booking_number,
          room_id: b.room_id,
          room_number: b.room_number,
          room_type: b.room_type,
          guest_name: b.guest_name || 'Unknown Guest',
          guest_email: b.guest_email,
          guest_phone: b.guest_phone,
          check_in_date: b.check_in_date,
          check_out_date: b.check_out_date,
          status: b.status as string,
          payment_status: b.payment_status as string,
          payment_method: b.payment_method,
          total_amount: b.total_amount,
          price_per_night: b.price_per_night,
          number_of_nights: b.number_of_nights,
          deposit_amount: b.deposit_amount,
          deposit_paid: b.deposit_paid,
          special_requests: b.special_requests,
          is_complimentary: b.is_complimentary,
          complimentary_nights: b.complimentary_nights,
          complimentary_start_date: b.complimentary_start_date,
          complimentary_end_date: b.complimentary_end_date,
          complimentary_reason: b.complimentary_reason,
          number_of_guests: b.number_of_guests,
          extra_bed_count: b.extra_bed_count,
          extra_bed_charge: b.extra_bed_charge,
          company_name: b.company_name,
          rate_code: b.rate_code,
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

          // Create a descriptive name for walk-in/online/complimentary guest
          const guestName = 'Walk-in Guest';

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
    const todayStr = new Date().toISOString().split('T')[0];

    const booking = bookings.find((b) => {
      const roomIdMatch = Number(b.room_id) === Number(room.id);
      if (!roomIdMatch) return false;

      const checkIn = b.check_in_date.split('T')[0];
      const checkOut = b.check_out_date.split('T')[0];

      // Include checkout day in display when booking is still checked_in
      // This ensures guests who haven't checked out yet still show on the timeline
      const isCheckedIn = b.status === 'checked_in' || b.status === 'auto_checked_in';

      if (isCheckedIn) {
        // For checked-in guests: show from check-in date up to today (even if past checkout date)
        // This handles late checkouts where guest is still in the room
        const effectiveCheckOut = checkOut >= todayStr ? checkOut : todayStr;
        return dateStr >= checkIn && dateStr <= effectiveCheckOut;
      }

      // Standard: exclude checkout day for completed/upcoming bookings
      return dateStr >= checkIn && dateStr < checkOut;
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

  // Popover handlers
  const handleCellMouseEnter = (event: React.MouseEvent<HTMLElement>, booking: TimelineBooking) => {
    // Clear any existing timeout
    if (popoverTimeoutRef.current) {
      clearTimeout(popoverTimeoutRef.current);
    }
    // Delay showing the popover to avoid flickering
    popoverTimeoutRef.current = setTimeout(() => {
      setPopoverAnchor(event.currentTarget);
      setHoveredBooking(booking);
    }, 300);
  };

  const handleCellMouseLeave = () => {
    if (popoverTimeoutRef.current) {
      clearTimeout(popoverTimeoutRef.current);
    }
    // Delay hiding to allow mouse to move to popover
    popoverTimeoutRef.current = setTimeout(() => {
      setPopoverAnchor(null);
      setHoveredBooking(null);
    }, 150);
  };

  const handlePopoverMouseEnter = () => {
    if (popoverTimeoutRef.current) {
      clearTimeout(popoverTimeoutRef.current);
    }
  };

  const handlePopoverMouseLeave = () => {
    setPopoverAnchor(null);
    setHoveredBooking(null);
  };

  const getPaymentStatusColor = (status?: string): string => {
    switch (status) {
      case 'paid': return '#4caf50';
      case 'partial': return '#ff9800';
      case 'unpaid': return '#f44336';
      case 'unpaid_deposit': return '#f44336';
      case 'paid_rate': return '#2196f3';
      case 'refunded': return '#9c27b0';
      default: return '#9e9e9e';
    }
  };

  const getPaymentStatusLabel = (status?: string): string => {
    switch (status) {
      case 'paid': return 'Paid';
      case 'partial': return 'Partial';
      case 'unpaid': return 'Unpaid';
      case 'unpaid_deposit': return 'Deposit Pending';
      case 'paid_rate': return 'Rate Paid';
      case 'refunded': return 'Refunded';
      default: return 'Unknown';
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Paper
        elevation={0}
        sx={{
          p: 2.5,
          mb: 3,
          bgcolor: 'white',
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 2,
        }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
          {/* Title Section */}
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.5 }}>
              <CalendarMonth sx={{ fontSize: 28, color: 'primary.main' }} />
              <Typography variant="h5" sx={{ fontWeight: 700, color: 'text.primary' }}>
                Reservation Timeline
              </Typography>
            </Box>
            <Typography variant="body2" color="text.secondary">
              {rooms.length} rooms • {bookings.length} active bookings • Hover for details
            </Typography>
          </Box>

          {/* Controls Section */}
          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Date Navigation */}
            <Paper
              elevation={0}
              sx={{
                display: 'flex',
                alignItems: 'center',
                bgcolor: 'grey.100',
                borderRadius: 1,
                p: 0.5,
              }}
            >
              <IconButton onClick={goToPreviousWeek} size="small">
                <ChevronLeft />
              </IconButton>
              <Box sx={{ px: 1.5, minWidth: 180, textAlign: 'center' }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - {dates[dates.length - 1]?.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </Typography>
              </Box>
              <IconButton onClick={goToNextWeek} size="small">
                <ChevronRight />
              </IconButton>
            </Paper>

            {/* Days Selector */}
            <FormControl size="small" sx={{ minWidth: 100 }}>
              <Select
                value={daysToShow}
                onChange={(e) => setDaysToShow(Number(e.target.value))}
                sx={{ bgcolor: 'grey.100' }}
              >
                <MenuItem value={7}>7 Days</MenuItem>
                <MenuItem value={14}>14 Days</MenuItem>
                <MenuItem value={30}>30 Days</MenuItem>
                <MenuItem value={60}>60 Days</MenuItem>
              </Select>
            </FormControl>

            {/* Action Buttons */}
            <Button
              variant="outlined"
              size="small"
              onClick={goToToday}
              sx={{ minWidth: 'auto', px: 2 }}
            >
              Today
            </Button>
            <IconButton onClick={loadData} size="small" sx={{ bgcolor: 'grey.100' }}>
              <Refresh />
            </IconButton>
          </Box>
        </Box>

        {/* Status Legend */}
        <Divider sx={{ my: 2 }} />
        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
          <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary' }}>
            Status:
          </Typography>
          {[
            { label: 'Reserved', color: '#42a5f5' },
            { label: 'Checked In', color: '#ffa726' },
            { label: 'Pending', color: '#ffeb3b', textColor: '#000' },
            { label: 'Complimentary', color: '#9c27b0' },
          ].map((item) => (
            <Chip
              key={item.label}
              label={item.label}
              size="small"
              sx={{
                bgcolor: item.color,
                color: item.textColor || 'white',
                fontWeight: 500,
                fontSize: '0.7rem',
                height: 22,
              }}
            />
          ))}
        </Box>
      </Paper>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
          <CircularProgress />
        </Box>
      ) : (
        <TableContainer
          component={Paper}
          elevation={0}
          sx={{
            maxHeight: 'calc(100vh - 300px)',
            overflow: 'auto',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 2,
          }}
        >
          <Table stickyHeader size="small">
            <TableHead>
              <TableRow>
                <TableCell
                  sx={{
                    fontWeight: 700,
                    minWidth: 120,
                    position: 'sticky',
                    left: 0,
                    bgcolor: '#fafafa',
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
                  const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                  return (
                    <TableCell
                      key={date.toISOString()}
                      align="center"
                      sx={{
                        minWidth: 85,
                        fontWeight: 600,
                        bgcolor: isToday ? alpha('#1976d2', 0.08) : isWeekend ? alpha('#f5f5f5', 0.5) : '#fafafa',
                        borderLeft: isToday ? '2px solid' : undefined,
                        borderRight: isToday ? '2px solid' : undefined,
                        borderColor: 'primary.main',
                        py: 1,
                      }}
                    >
                      <Box>
                        <Typography
                          variant="caption"
                          display="block"
                          sx={{
                            fontWeight: isWeekend ? 600 : 500,
                            color: isWeekend ? 'error.main' : 'text.secondary',
                            fontSize: '0.65rem',
                          }}
                        >
                          {date.toLocaleDateString('en-US', { weekday: 'short' })}
                        </Typography>
                        <Typography
                          variant="body2"
                          sx={{
                            fontWeight: 700,
                            fontSize: '1rem',
                            color: isToday ? 'primary.main' : 'text.primary',
                          }}
                        >
                          {date.getDate()}
                        </Typography>
                        <Typography
                          variant="caption"
                          sx={{
                            color: 'text.secondary',
                            fontSize: '0.6rem',
                          }}
                        >
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
                      py: 1.5,
                    }}
                  >
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Hotel sx={{ fontSize: 16, color: 'primary.main' }} />
                        <Typography variant="body2" sx={{ fontWeight: 700, fontSize: '0.95rem' }}>
                          {room.room_number}
                        </Typography>
                      </Box>
                      <Typography
                        variant="caption"
                        sx={{
                          color: 'text.secondary',
                          fontSize: '0.7rem',
                          bgcolor: alpha('#1976d2', 0.08),
                          px: 0.75,
                          py: 0.25,
                          borderRadius: 0.5,
                          display: 'inline-block',
                          width: 'fit-content',
                        }}
                      >
                        {room.room_type}
                      </Typography>
                      <Typography variant="caption" sx={{ color: 'success.main', fontWeight: 600, fontSize: '0.75rem' }}>
                        {formatCurrency(Number(room.price_per_night))}/night
                      </Typography>
                    </Box>
                  </TableCell>
                  {dates.map((date) => {
                    const cell = getTimelineCell(room, date);
                    const isToday =
                      date.toDateString() === new Date().toDateString();
                    const isWeekend = date.getDay() === 0 || date.getDay() === 6;

                    if (!cell.booking) {
                      return (
                        <TableCell
                          key={date.toISOString()}
                          sx={{
                            bgcolor: isToday ? alpha('#1976d2', 0.05) : isWeekend ? alpha('#f5f5f5', 0.3) : 'background.paper',
                            borderLeft: isToday ? '2px solid' : undefined,
                            borderRight: isToday ? '2px solid' : undefined,
                            borderColor: 'primary.main',
                            transition: 'background-color 0.2s',
                            '&:hover': {
                              bgcolor: alpha('#66bb6a', 0.1),
                            },
                          }}
                        />
                      );
                    }

                    const isComplimentary = cell.booking.is_complimentary;
                    // Use purple for complimentary bookings, otherwise use status color
                    const statusColor = isComplimentary ? '#9c27b0' : getStatusColor(cell.booking.status);
                    const statusLabel = isComplimentary
                      ? `Comp (${cell.booking.complimentary_nights || 0}N)`
                      : getStatusLabel(cell.booking.status);

                    const isSyntheticBooking = String(cell.booking.id).startsWith('synthetic-');

                    // Create gradient background for more visual appeal
                    const gradientBg = `linear-gradient(135deg, ${statusColor} 0%, ${alpha(statusColor, 0.85)} 100%)`;

                    return (
                      <TableCell
                        key={date.toISOString()}
                        onMouseEnter={(e) => handleCellMouseEnter(e, cell.booking!)}
                        onMouseLeave={handleCellMouseLeave}
                        sx={{
                          background: isSyntheticBooking || isComplimentary
                            ? `repeating-linear-gradient(
                                45deg,
                                ${statusColor},
                                ${statusColor} 8px,
                                ${alpha(statusColor, 0.7)} 8px,
                                ${alpha(statusColor, 0.7)} 16px
                              )`
                            : statusColor,
                          borderLeft: cell.isStart ? '3px solid rgba(0,0,0,0.3)' : '1px solid rgba(255,255,255,0.2)',
                          borderRight: cell.isEnd ? '3px solid rgba(0,0,0,0.3)' : '1px solid rgba(255,255,255,0.2)',
                          borderTop: '1px solid rgba(255,255,255,0.15)',
                          borderBottom: '1px solid rgba(255,255,255,0.15)',
                          cursor: 'pointer',
                          position: 'relative',
                          padding: '6px 8px',
                          minHeight: '60px',
                          verticalAlign: 'top',
                          '&:hover': {
                            filter: 'brightness(1.08)',
                          },
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

                          {/* Room rate - shown on start cell for real bookings */}
                          {cell.isStart && !isSyntheticBooking && cell.booking.price_per_night && (
                            <Typography
                              variant="caption"
                              sx={{
                                color: 'rgba(255,255,255,0.9)',
                                fontSize: '0.6rem',
                                fontWeight: 600,
                                textShadow: '0 1px 2px rgba(0,0,0,0.3)',
                              }}
                            >
                              {formatCurrency(Number(cell.booking.price_per_night))}/night
                            </Typography>
                          )}

                          {/* Complimentary date range - shown on start cell for complimentary bookings */}
                          {cell.isStart && isComplimentary && cell.booking.complimentary_start_date && cell.booking.complimentary_end_date && (
                            <Typography
                              variant="caption"
                              sx={{
                                color: 'rgba(255,255,255,0.95)',
                                fontSize: '0.55rem',
                                textShadow: '0 1px 2px rgba(0,0,0,0.3)',
                                fontWeight: 600,
                              }}
                            >
                              Free: {new Date(cell.booking.complimentary_start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - {new Date(cell.booking.complimentary_end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
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

                          {/* Walk-in/Online/Complimentary guest indicator */}
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
                              Direct check-in
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

      {/* Booking Details Popover */}
      <Popover
        open={Boolean(popoverAnchor) && Boolean(hoveredBooking)}
        anchorEl={popoverAnchor}
        onClose={handlePopoverMouseLeave}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'center',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'center',
        }}
        disableRestoreFocus
        sx={{
          pointerEvents: 'none',
          '& .MuiPopover-paper': {
            pointerEvents: 'auto',
            borderRadius: 2,
            boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
            border: '1px solid',
            borderColor: 'divider',
            maxWidth: 340,
          },
        }}
        slotProps={{
          paper: {
            onMouseEnter: handlePopoverMouseEnter,
            onMouseLeave: handlePopoverMouseLeave,
          },
        }}
      >
        {hoveredBooking && (
          <Box sx={{ p: 2 }}>
            {/* Header */}
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Person sx={{ fontSize: 20, color: 'primary.main' }} />
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                  {hoveredBooking.guest_name}
                </Typography>
              </Box>
              {hoveredBooking.booking_number && (
                <Chip
                  label={hoveredBooking.booking_number}
                  size="small"
                  sx={{
                    fontSize: '0.65rem',
                    height: 20,
                    bgcolor: alpha('#1976d2', 0.1),
                    color: 'primary.main',
                    fontWeight: 600,
                  }}
                />
              )}
            </Box>

            <Divider sx={{ my: 1.5 }} />

            {/* Contact Info */}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, mb: 1.5 }}>
              {hoveredBooking.guest_email && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Email sx={{ fontSize: 16, color: 'text.secondary' }} />
                  <Typography variant="body2" color="text.secondary">
                    {hoveredBooking.guest_email}
                  </Typography>
                </Box>
              )}
              {hoveredBooking.guest_phone && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Phone sx={{ fontSize: 16, color: 'text.secondary' }} />
                  <Typography variant="body2" color="text.secondary">
                    {hoveredBooking.guest_phone}
                  </Typography>
                </Box>
              )}
            </Box>

            {/* Booking Details */}
            <Paper
              elevation={0}
              sx={{
                p: 1.5,
                bgcolor: alpha('#f5f5f5', 0.5),
                borderRadius: 1.5,
                mb: 1.5,
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <CalendarToday sx={{ fontSize: 16, color: 'primary.main' }} />
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {new Date(hoveredBooking.check_in_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                  {' → '}
                  {new Date(hoveredBooking.check_out_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', gap: 2 }}>
                <Box>
                  <Typography variant="caption" color="text.secondary">Nights</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {hoveredBooking.number_of_nights || Math.ceil((new Date(hoveredBooking.check_out_date).getTime() - new Date(hoveredBooking.check_in_date).getTime()) / (1000 * 60 * 60 * 24))}
                  </Typography>
                </Box>
                {hoveredBooking.number_of_guests && (
                  <Box>
                    <Typography variant="caption" color="text.secondary">Guests</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {hoveredBooking.number_of_guests}
                    </Typography>
                  </Box>
                )}
                {hoveredBooking.extra_bed_count && hoveredBooking.extra_bed_count > 0 && (
                  <Box>
                    <Typography variant="caption" color="text.secondary">Extra Beds</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {hoveredBooking.extra_bed_count}
                    </Typography>
                  </Box>
                )}
              </Box>
            </Paper>

            {/* Payment Info */}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <AttachMoney sx={{ fontSize: 18, color: 'success.main' }} />
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 700, color: 'success.main' }}>
                    {formatCurrency(Number(hoveredBooking.total_amount || 0))}
                  </Typography>
                  {hoveredBooking.price_per_night && (
                    <Typography variant="caption" color="text.secondary">
                      {formatCurrency(Number(hoveredBooking.price_per_night))}/night
                    </Typography>
                  )}
                </Box>
              </Box>
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                <Chip
                  label={getStatusLabel(hoveredBooking.status)}
                  size="small"
                  sx={{
                    bgcolor: getStatusColor(hoveredBooking.status),
                    color: 'white',
                    fontWeight: 600,
                    fontSize: '0.65rem',
                    height: 22,
                  }}
                />
                {hoveredBooking.payment_status && (
                  <Chip
                    icon={<Payment sx={{ fontSize: 14, color: 'inherit !important' }} />}
                    label={getPaymentStatusLabel(hoveredBooking.payment_status)}
                    size="small"
                    sx={{
                      bgcolor: alpha(getPaymentStatusColor(hoveredBooking.payment_status), 0.15),
                      color: getPaymentStatusColor(hoveredBooking.payment_status),
                      fontWeight: 600,
                      fontSize: '0.65rem',
                      height: 22,
                      '& .MuiChip-icon': {
                        color: 'inherit',
                      },
                    }}
                  />
                )}
              </Box>
            </Box>

            {/* Deposit Info */}
            {(hoveredBooking.deposit_amount || hoveredBooking.deposit_paid) && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <Typography variant="caption" color="text.secondary">Deposit:</Typography>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  {formatCurrency(Number(hoveredBooking.deposit_amount || 0))}
                </Typography>
                {hoveredBooking.deposit_paid && (
                  <Chip label="Collected" size="small" color="success" sx={{ height: 18, fontSize: '0.6rem' }} />
                )}
              </Box>
            )}

            {/* Company */}
            {hoveredBooking.company_name && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <Typography variant="caption" color="text.secondary">Company:</Typography>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  {hoveredBooking.company_name}
                </Typography>
              </Box>
            )}

            {/* Complimentary Info */}
            {hoveredBooking.is_complimentary && (
              <Paper
                elevation={0}
                sx={{
                  p: 1,
                  bgcolor: alpha('#9c27b0', 0.1),
                  borderRadius: 1,
                  mb: 1,
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <CardGiftcard sx={{ fontSize: 16, color: '#9c27b0' }} />
                  <Typography variant="body2" sx={{ fontWeight: 600, color: '#9c27b0' }}>
                    Complimentary: {hoveredBooking.complimentary_nights} nights
                  </Typography>
                </Box>
                {hoveredBooking.complimentary_reason && (
                  <Typography variant="caption" color="text.secondary" sx={{ ml: 3 }}>
                    {hoveredBooking.complimentary_reason}
                  </Typography>
                )}
              </Paper>
            )}

            {/* Special Requests */}
            {hoveredBooking.special_requests && (
              <Box sx={{ mt: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                  <Notes sx={{ fontSize: 16, color: 'warning.main', mt: 0.25 }} />
                  <Box>
                    <Typography variant="caption" color="text.secondary">Special Requests</Typography>
                    <Typography variant="body2" sx={{ fontSize: '0.8rem' }}>
                      {hoveredBooking.special_requests}
                    </Typography>
                  </Box>
                </Box>
              </Box>
            )}
          </Box>
        )}
      </Popover>
    </Box>
  );
};

export default RoomReservationTimeline;

import React, { useEffect, useState, useRef } from 'react';
import {
  Grid,
  Card,
  CardContent,
  Typography,
  Box,
  Alert,
  Chip,
  Paper,
  CircularProgress,
  Tooltip,
  IconButton,
  Divider,
  Badge,
} from '@mui/material';
import {
  Hotel as HotelIcon,
  CheckCircle as CheckInIcon,
  ExitToApp as CheckOutIcon,
  CleaningServices as CleaningIcon,
  Build as MaintenanceIcon,
  Block as OccupiedIcon,
  EventAvailable as AvailableIcon,
  Warning as WarningIcon,
  Schedule as LateIcon,
  CalendarToday as CalendarIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import { HotelAPIService } from '../../../api';
import { useAuth } from '../../../auth/AuthContext';
import { BookingWithDetails, Guest, Booking } from '../../../types';
import RoomEventDialog from '../../rooms/components/RoomEventDialog';
import EnhancedCheckInModal from '../../bookings/components/EnhancedCheckInModal';

interface RoomStatus {
  id: number;
  room_number: string;
  room_type: string;
  status: 'available' | 'occupied' | 'cleaning' | 'maintenance' | 'reserved' | 'out_of_order' | 'dirty';
  available: boolean;
  current_guest?: string;
  check_in_date?: string;
  check_out_date?: string;
  next_check_in?: string;
  booking_id?: string;
  // Status metadata dates
  maintenance_start_date?: string;
  maintenance_end_date?: string;
  cleaning_start_date?: string;
  cleaning_end_date?: string;
  reserved_start_date?: string;
  reserved_end_date?: string;
  status_notes?: string;
}

interface LateCheckout {
  room_number: string;
  guest_name: string;
  scheduled_checkout: string;
  current_time: string;
  hours_late: number;
}

interface TodayActivity {
  check_ins: number;
  check_outs: number;
  late_checkouts: number;
  arrivals: Array<{
    room_number: string;
    guest_name: string;
    time: string;
  }>;
  departures: Array<{
    room_number: string;
    guest_name: string;
    time: string;
  }>;
}

const ReceptionistDashboard: React.FC = () => {
  const { hasRole } = useAuth();
  const isReceptionist = hasRole('receptionist') || hasRole('manager') || hasRole('admin');
  const hasLoadedRef = useRef(false);

  const [rooms, setRooms] = useState<RoomStatus[]>([]);
  const [lateCheckouts, setLateCheckouts] = useState<LateCheckout[]>([]);
  const [todayActivity, setTodayActivity] = useState<TodayActivity>({
    check_ins: 0,
    check_outs: 0,
    late_checkouts: 0,
    arrivals: [],
    departures: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [selectedRoom, setSelectedRoom] = useState<RoomStatus | null>(null);
  const [checkinModalOpen, setCheckinModalOpen] = useState(false);
  const [checkinBooking, setCheckinBooking] = useState<Booking | null>(null);
  const [checkinGuest, setCheckinGuest] = useState<Guest | null>(null);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch rooms and bookings data
      const [roomsData, bookingsData] = await Promise.all([
        HotelAPIService.getAllRooms(),
        HotelAPIService.getAllBookings(),
      ]) as [any[], BookingWithDetails[]];

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Process rooms with their current status
      const processedRooms: RoomStatus[] = roomsData.map((room: any) => {
        // Find active booking for this room
        // Find current occupancy (checked-in guest)
        const currentOccupancy = bookingsData.find((booking: BookingWithDetails) => {
          if (String(booking.room_id) !== String(room.id)) return false;

          const checkIn = new Date(booking.check_in_date);
          const checkOut = new Date(booking.check_out_date);
          checkIn.setHours(0, 0, 0, 0);
          checkOut.setHours(0, 0, 0, 0);

          // Occupied if status is checked_in AND dates overlap today
          return (
            booking.status === 'checked_in' &&
            checkIn <= today &&
            checkOut >= today
          );
        });

        // Find today's arrival (not yet checked in)
        const todayArrival = bookingsData.find((booking: BookingWithDetails) => {
          if (String(booking.room_id) !== String(room.id)) return false;

          const checkIn = new Date(booking.check_in_date);
          checkIn.setHours(0, 0, 0, 0);

          // Reserved if status is pending/confirmed AND check-in is today
          return (
            (booking.status === 'pending' || booking.status === 'confirmed') &&
            checkIn.getTime() === today.getTime()
          );
        });

        // Find future reservation
        const futureReservation = bookingsData.find((booking: BookingWithDetails) => {
          if (String(booking.room_id) !== String(room.id)) return false;

          const checkIn = new Date(booking.check_in_date);
          checkIn.setHours(0, 0, 0, 0);

          // Reserved if status is pending/confirmed AND check-in is in the future
          return (
            (booking.status === 'pending' || booking.status === 'confirmed') &&
            checkIn > today
          );
        });

        // Find next reservation
        const nextBooking = bookingsData
          .filter((booking: BookingWithDetails) => {
            const checkIn = new Date(booking.check_in_date);
            checkIn.setHours(0, 0, 0, 0);
            return (
              String(booking.room_id) === String(room.id) &&
              booking.status === 'confirmed' &&
              checkIn > today
            );
          })
          .sort((a: BookingWithDetails, b: BookingWithDetails) =>
            new Date(a.check_in_date).getTime() - new Date(b.check_in_date).getTime()
          )[0];

        let status: RoomStatus['status'] = 'available';
        let currentGuest: string | undefined;
        let checkInDate: string | undefined;
        let checkOutDate: string | undefined;
        let nextCheckIn: string | undefined;
        let bookingId: string | undefined;

        // First, check if room has an explicit status from the backend
        // The backend status is authoritative - trust it for all status types
        if (room.status && ['maintenance', 'cleaning', 'reserved', 'occupied'].includes(room.status)) {
          status = room.status as RoomStatus['status'];
          // If occupied, also get the guest details from current booking
          if (room.status === 'occupied' && currentOccupancy) {
            currentGuest = currentOccupancy.guest_name;
            checkInDate = currentOccupancy.check_in_date;
            checkOutDate = currentOccupancy.check_out_date;
            bookingId = String(currentOccupancy.id);
          }
        }
        // Check current occupancy (checked-in guest)
        else if (currentOccupancy) {
          status = 'occupied';
          currentGuest = currentOccupancy.guest_name;
          checkInDate = currentOccupancy.check_in_date;
          checkOutDate = currentOccupancy.check_out_date;
          bookingId = String(currentOccupancy.id);
        }
        // Check today's arrival (awaiting check-in)
        else if (todayArrival) {
          status = 'reserved';
          currentGuest = todayArrival.guest_name;
          checkInDate = todayArrival.check_in_date;
          checkOutDate = todayArrival.check_out_date;
          bookingId = String(todayArrival.id);
        }
        // Check future reservation
        else if (futureReservation) {
          status = 'reserved';
          currentGuest = futureReservation.guest_name;
          checkInDate = futureReservation.check_in_date;
          checkOutDate = futureReservation.check_out_date;
          bookingId = String(futureReservation.id);
        }
        // Fallback: if not available and no explicit status, assume maintenance
        else if (room.available === false) {
          status = 'maintenance';
        }

        if (nextBooking) {
          nextCheckIn = nextBooking.check_in_date;
        }

        return {
          id: room.id,
          room_number: room.room_number,
          room_type: room.room_type,
          status,
          available: room.available,
          current_guest: currentGuest,
          check_in_date: checkInDate,
          check_out_date: checkOutDate,
          next_check_in: nextCheckIn,
          booking_id: bookingId,
          // Status metadata dates
          maintenance_start_date: room.maintenance_start_date,
          maintenance_end_date: room.maintenance_end_date,
          cleaning_start_date: room.cleaning_start_date,
          cleaning_end_date: room.cleaning_end_date,
          reserved_start_date: room.reserved_start_date,
          reserved_end_date: room.reserved_end_date,
          status_notes: room.status_notes,
        };
      });

      // Calculate today's activity
      const todayCheckIns = bookingsData.filter((booking: BookingWithDetails) => {
        const checkIn = new Date(booking.check_in_date);
        checkIn.setHours(0, 0, 0, 0);
        return checkIn.getTime() === today.getTime() && booking.status !== 'cancelled';
      });

      const todayCheckOuts = bookingsData.filter((booking: BookingWithDetails) => {
        const checkOut = new Date(booking.check_out_date);
        checkOut.setHours(0, 0, 0, 0);
        return checkOut.getTime() === today.getTime() && booking.status !== 'cancelled';
      });

      // Detect late checkouts (checkout date was yesterday or earlier but still occupied)
      const late = processedRooms
        .filter(room => {
          if (room.status !== 'occupied' || !room.check_out_date) return false;
          const checkOut = new Date(room.check_out_date);
          checkOut.setHours(0, 0, 0, 0);
          return checkOut < today;
        })
        .map(room => {
          const checkOut = new Date(room.check_out_date!);
          const hoursLate = Math.floor((today.getTime() - checkOut.getTime()) / (1000 * 60 * 60));

          return {
            room_number: room.room_number,
            guest_name: room.current_guest || 'Unknown',
            scheduled_checkout: room.check_out_date!,
            current_time: new Date().toISOString(),
            hours_late: hoursLate,
          };
        });

      setRooms(processedRooms);
      setLateCheckouts(late);
      setTodayActivity({
        check_ins: todayCheckIns.length,
        check_outs: todayCheckOuts.length,
        late_checkouts: late.length,
        arrivals: todayCheckIns.slice(0, 5).map((b: BookingWithDetails) => ({
          room_number: processedRooms.find(r => String(r.id) === String(b.room_id))?.room_number || 'N/A',
          guest_name: b.guest_name,
          time: b.check_in_date,
        })),
        departures: todayCheckOuts.slice(0, 5).map((b: BookingWithDetails) => ({
          room_number: processedRooms.find(r => String(r.id) === String(b.room_id))?.room_number || 'N/A',
          guest_name: b.guest_name,
          time: b.check_out_date,
        })),
      });

      setLoading(false);
    } catch (err: any) {
      console.error('Failed to load dashboard data:', err);
      setError(err.message || 'Failed to load dashboard data');
      setLoading(false);
    }
  };

  const handleCheckInFromRoom = async (bookingId: string) => {
    try {
      setLoading(true);
      const booking = await HotelAPIService.getBookingById(bookingId);
      const guest = await HotelAPIService.getGuest(booking.guest_id);

      // Convert to proper format for modal
      const bookingData: any = {
        ...booking,
        room_type: booking.room_type || '',
      };

      setCheckinBooking(bookingData);
      setCheckinGuest(guest);
      setCheckinModalOpen(true);
      setLoading(false);
    } catch (err: any) {
      console.error('Failed to load check-in data:', err);
      setError(err.message || 'Failed to load check-in data');
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isReceptionist && !hasLoadedRef.current) {
      hasLoadedRef.current = true;
      loadDashboardData();
    }
  }, [isReceptionist]);

  const getRoomStatusColor = (room: RoomStatus) => {
    // Occupied (checked-in guest) → Red (ALWAYS)
    if (room.status === 'occupied') {
      return '#F44336'; // Red
    }

    // Reserved → Yellow
    if (room.status === 'reserved') {
      return '#FFC107'; // Yellow
    }

    // Cleaning → Blue
    if (room.status === 'cleaning') {
      return '#2196F3'; // Blue (system-only)
    }

    // Dirty → Orange
    if (room.status === 'dirty') {
      return '#FF9800'; // Orange
    }

    // Maintenance → Orange
    if (room.status === 'maintenance') {
      return '#FF9800'; // Orange
    }

    // Out of Order (Unavailable) → Grey
    if (room.status === 'out_of_order') {
      return '#9E9E9E'; // Gray
    }

    // Available → Green
    if (room.status === 'available') {
      return '#4CAF50'; // Green
    }

    return '#9E9E9E'; // Gray
  };

  const getRoomStatusIcon = (status: RoomStatus['status']) => {
    switch (status) {
      case 'available':
        return <AvailableIcon sx={{ fontSize: 32, color: 'white' }} />;
      case 'occupied':
        return <OccupiedIcon sx={{ fontSize: 32, color: 'white' }} />;
      case 'reserved':
        return <CalendarIcon sx={{ fontSize: 32, color: 'white' }} />;
      case 'cleaning':
        return <CleaningIcon sx={{ fontSize: 32, color: 'white' }} />;
      case 'maintenance':
        return <MaintenanceIcon sx={{ fontSize: 32, color: 'white' }} />;
      default:
        return <HotelIcon sx={{ fontSize: 32, color: 'white' }} />;
    }
  };

  const getStatusLabel = (status: RoomStatus['status']) => {
    return status.charAt(0).toUpperCase() + status.slice(1);
  };

  if (!isReceptionist) {
    return (
      <Alert severity="warning">
        This dashboard is only accessible to receptionists and managers.
      </Alert>
    );
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ mt: 2 }}>
        {error}
      </Alert>
    );
  }

  const availableRooms = rooms.filter(r => r.status === 'available').length;
  const occupiedRooms = rooms.filter(r => r.status === 'occupied').length;
  const reservedRooms = rooms.filter(r => r.status === 'reserved').length;
  const maintenanceRooms = rooms.filter(r => r.status === 'maintenance').length;
  const occupancyRate = rooms.length > 0 ? ((occupiedRooms / rooms.length) * 100).toFixed(1) : '0';

  return (
    <Box>
      {/* Header */}
      <Box sx={{ mb: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box>
          <Typography variant="h4" component="h1" gutterBottom sx={{ fontWeight: 700, color: 'text.primary' }}>
            Admin Dashboard
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Real-time overview of hotel operations and room status
          </Typography>
        </Box>
        <IconButton onClick={loadDashboardData} color="primary" size="large">
          <RefreshIcon />
        </IconButton>
      </Box>

      {/* Late Checkout Alerts */}
      {lateCheckouts.length > 0 && (
        <Alert severity="error" sx={{ mb: 3 }} icon={<LateIcon />}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
            ⚠️ Late Checkout Alert - {lateCheckouts.length} Room(s)
          </Typography>
          {lateCheckouts.map((late, index) => (
            <Typography key={index} variant="body2">
              • Room {late.room_number} - {late.guest_name} - {late.hours_late} hours overdue
            </Typography>
          ))}
        </Alert>
      )}

      {/* Summary Stats */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card sx={{ background: 'linear-gradient(135deg, #4caf50 0%, #66bb6a 100%)', color: 'white', boxShadow: 1 }}>
            <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
              <Box display="flex" justifyContent="space-between" alignItems="center">
                <Box>
                  <Typography variant="h4" sx={{ fontWeight: 600 }}>
                    {availableRooms}
                  </Typography>
                  <Typography variant="caption" sx={{ fontSize: '0.75rem', opacity: 0.9 }}>Available Rooms</Typography>
                </Box>
                <AvailableIcon sx={{ fontSize: 32, opacity: 0.5 }} />
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card sx={{ background: 'linear-gradient(135deg, #f44336 0%, #e57373 100%)', color: 'white', boxShadow: 1 }}>
            <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
              <Box display="flex" justifyContent="space-between" alignItems="center">
                <Box>
                  <Typography variant="h4" sx={{ fontWeight: 600 }}>
                    {occupiedRooms}
                  </Typography>
                  <Typography variant="caption" sx={{ fontSize: '0.75rem', opacity: 0.9 }}>Occupied Rooms</Typography>
                </Box>
                <OccupiedIcon sx={{ fontSize: 32, opacity: 0.5 }} />
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card sx={{ background: 'linear-gradient(135deg, #ff9800 0%, #ffb74d 100%)', color: 'white', boxShadow: 1 }}>
            <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
              <Box display="flex" justifyContent="space-between" alignItems="center">
                <Box>
                  <Typography variant="h4" sx={{ fontWeight: 600 }}>
                    {reservedRooms}
                  </Typography>
                  <Typography variant="caption" sx={{ fontSize: '0.75rem', opacity: 0.9 }}>Reserved Rooms</Typography>
                </Box>
                <CalendarIcon sx={{ fontSize: 32, opacity: 0.5 }} />
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card sx={{ background: 'linear-gradient(135deg, #1a73e8 0%, #4285f4 100%)', color: 'white', boxShadow: 1 }}>
            <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
              <Box display="flex" justifyContent="space-between" alignItems="center">
                <Box>
                  <Typography variant="h4" sx={{ fontWeight: 600 }}>
                    {occupancyRate}%
                  </Typography>
                  <Typography variant="caption" sx={{ fontSize: '0.75rem', opacity: 0.9 }}>Occupancy Rate</Typography>
                </Box>
                <HotelIcon sx={{ fontSize: 32, opacity: 0.5 }} />
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Today's Activity */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} md={4}>
          <Card sx={{ boxShadow: 1 }}>
            <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
              <Box display="flex" alignItems="center" mb={1}>
                <CheckInIcon sx={{ mr: 1, color: 'success.main', fontSize: 20 }} />
                <Typography variant="subtitle2" sx={{ fontWeight: 600, fontSize: '0.875rem' }}>
                  Today's Check-ins
                </Typography>
              </Box>
              <Typography variant="h5" sx={{ fontWeight: 600, color: 'success.main', mb: 1 }}>
                {todayActivity.check_ins}
              </Typography>
              {todayActivity.arrivals.length > 0 ? (
                <Box>
                  {todayActivity.arrivals.map((arrival, index) => (
                    <Box key={index} sx={{ py: 1, borderBottom: index < todayActivity.arrivals.length - 1 ? '1px solid #eee' : 'none' }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        Room {arrival.room_number}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {arrival.guest_name}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  No check-ins scheduled
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={4}>
          <Card sx={{ boxShadow: 1 }}>
            <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
              <Box display="flex" alignItems="center" mb={1}>
                <CheckOutIcon sx={{ mr: 1, color: 'info.main', fontSize: 20 }} />
                <Typography variant="subtitle2" sx={{ fontWeight: 600, fontSize: '0.875rem' }}>
                  Today's Check-outs
                </Typography>
              </Box>
              <Typography variant="h5" sx={{ fontWeight: 600, color: 'info.main', mb: 1 }}>
                {todayActivity.check_outs}
              </Typography>
              {todayActivity.departures.length > 0 ? (
                <Box>
                  {todayActivity.departures.map((departure, index) => (
                    <Box key={index} sx={{ py: 1, borderBottom: index < todayActivity.departures.length - 1 ? '1px solid #eee' : 'none' }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        Room {departure.room_number}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {departure.guest_name}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  No check-outs scheduled
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={4}>
          <Card sx={{ boxShadow: 1 }}>
            <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
              <Box display="flex" alignItems="center" mb={1}>
                <WarningIcon sx={{ mr: 1, color: 'error.main', fontSize: 20 }} />
                <Typography variant="subtitle2" sx={{ fontWeight: 600, fontSize: '0.875rem' }}>
                  Attention Required
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
                    Late Checkouts
                  </Typography>
                  <Typography variant="h6" sx={{ fontWeight: 600, color: 'error.main' }}>
                    {todayActivity.late_checkouts}
                  </Typography>
                </Box>
                <Divider />
                <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
                    Maintenance Rooms
                  </Typography>
                  <Typography variant="h6" sx={{ fontWeight: 600, color: 'warning.main' }}>
                    {maintenanceRooms}
                  </Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Room Status Grid */}
      <Card>
        <CardContent>
          <Box display="flex" alignItems="center" mb={3}>
            <HotelIcon sx={{ mr: 1, color: 'primary.main', fontSize: 28 }} />
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              Room Status Overview
            </Typography>
          </Box>

          {/* Legend */}
          <Box sx={{ mb: 3, display: 'flex', flexWrap: 'wrap', gap: 2 }}>
            <Chip icon={<AvailableIcon />} label="Available" size="small" sx={{ bgcolor: '#4CAF50', color: 'white' }} />
            <Chip icon={<OccupiedIcon />} label="Occupied" size="small" sx={{ bgcolor: '#F44336', color: 'white' }} />
            <Chip icon={<CalendarIcon />} label="Reserved" size="small" sx={{ bgcolor: '#FFC107', color: 'white' }} />
            <Chip icon={<CleaningIcon />} label="Cleaning (Auto)" size="small" sx={{ bgcolor: '#2196F3', color: 'white' }} />
            <Chip icon={<MaintenanceIcon />} label="Maintenance" size="small" sx={{ bgcolor: '#FF9800', color: 'white' }} />
          </Box>

          {/* Room Grid */}
          <Grid container spacing={2}>
            {rooms.map((room) => (
              <Grid item xs={6} sm={4} md={3} lg={2} key={room.id}>
                <Tooltip
                  title={
                    <Box>
                      <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                        Room {room.room_number}
                      </Typography>
                      <Typography variant="caption">Type: {room.room_type}</Typography>
                      {room.current_guest && (
                        <>
                          <Divider sx={{ my: 0.5, bgcolor: 'rgba(255,255,255,0.2)' }} />
                          <Typography variant="caption">Guest: {room.current_guest}</Typography>
                        </>
                      )}
                      {/* Show status notes if available */}
                      {room.status_notes && (
                        <>
                          <Divider sx={{ my: 0.5, bgcolor: 'rgba(255,255,255,0.2)' }} />
                          <Typography variant="caption" sx={{ fontWeight: 600, display: 'block', mt: 0.5 }}>
                            Notes:
                          </Typography>
                          <Typography variant="caption" display="block" sx={{ fontStyle: 'italic', whiteSpace: 'pre-wrap' }}>
                            {room.status_notes}
                          </Typography>
                        </>
                      )}
                      {/* Show "Click for details" if no notes */}
                      {!room.status_notes && (
                        <>
                          <Divider sx={{ my: 0.5, bgcolor: 'rgba(255,255,255,0.2)' }} />
                          <Typography variant="caption" sx={{ fontStyle: 'italic', opacity: 0.8 }}>
                            Click for room details
                          </Typography>
                        </>
                      )}
                    </Box>
                  }
                  arrow
                  placement="top"
                >
                  <Paper
                    elevation={3}
                    onClick={() => {
                      // If room has a reservation ready for check-in, open check-in modal
                      if (room.status === 'reserved' && room.booking_id && room.check_in_date) {
                        const today = new Date();
                        today.setHours(0, 0, 0, 0);
                        const checkInDate = new Date(room.check_in_date);
                        checkInDate.setHours(0, 0, 0, 0);

                        // If check-in date is today or past, open check-in modal
                        if (checkInDate <= today) {
                          handleCheckInFromRoom(room.booking_id);
                          return;
                        }
                      }

                      // Otherwise, open status dialog
                      setSelectedRoom(room);
                      setStatusDialogOpen(true);
                    }}
                    sx={{
                      p: 2,
                      textAlign: 'center',
                      bgcolor: getRoomStatusColor(room),
                      color: 'white',
                      cursor: 'pointer',
                      transition: 'all 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
                      animation: 'fadeIn 0.4s ease-in-out',
                      minHeight: 180,
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      '@keyframes fadeIn': {
                        from: {
                          opacity: 0,
                          transform: 'scale(0.95)',
                        },
                        to: {
                          opacity: 1,
                          transform: 'scale(1)',
                        },
                      },
                      '&:hover': {
                        transform: 'translateY(-4px) scale(1.02)',
                        boxShadow: 6,
                      },
                      '&:active': {
                        transform: 'translateY(-2px) scale(1.01)',
                      },
                      position: 'relative',
                    }}
                  >
                    {/* Late checkout badge */}
                    {room.status === 'occupied' && room.check_out_date &&
                     new Date(room.check_out_date) < new Date(new Date().setHours(0, 0, 0, 0)) && (
                      <Badge
                        badgeContent={<LateIcon sx={{ fontSize: 12 }} />}
                        color="error"
                        sx={{ position: 'absolute', top: 8, right: 8 }}
                      />
                    )}

                    <Box
                      sx={{
                        mb: 1,
                        transition: 'transform 0.3s ease',
                        '&:hover': {
                          transform: 'scale(1.1) rotate(5deg)',
                        },
                      }}
                    >
                      {getRoomStatusIcon(room.status)}
                    </Box>
                    <Typography
                      variant="h6"
                      sx={{
                        fontWeight: 700,
                        mb: 0.5,
                        transition: 'all 0.3s ease',
                      }}
                    >
                      {room.room_number}
                    </Typography>
                    <Typography
                      variant="caption"
                      sx={{
                        display: 'block',
                        opacity: 0.9,
                        fontSize: '0.7rem',
                        transition: 'opacity 0.3s ease',
                      }}
                    >
                      {room.room_type}
                    </Typography>
                    <Typography
                      variant="caption"
                      sx={{
                        display: 'block',
                        fontWeight: 600,
                        mt: 0.5,
                        fontSize: '0.65rem',
                        transition: 'all 0.3s ease',
                        textShadow: '0 1px 2px rgba(0,0,0,0.2)',
                      }}
                    >
                      {getStatusLabel(room.status)}
                    </Typography>

                    {/* Check-out date indicator */}
                    {room.check_out_date && room.status === 'occupied' && (
                      <Box sx={{ mt: 1, pt: 1, borderTop: '1px solid rgba(255,255,255,0.3)' }}>
                        <Typography variant="caption" sx={{ fontSize: '0.6rem', display: 'block' }}>
                          Out: {new Date(room.check_out_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </Typography>
                      </Box>
                    )}

                    {/* Next check-in indicator */}
                    {!room.current_guest && room.next_check_in && (
                      <Box sx={{ mt: 1, pt: 1, borderTop: '1px solid rgba(255,255,255,0.3)' }}>
                        <Typography variant="caption" sx={{ fontSize: '0.6rem', display: 'block' }}>
                          Next: {new Date(room.next_check_in).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </Typography>
                      </Box>
                    )}

                    {/* Maintenance schedule indicator */}
                    {room.status === 'maintenance' && (room.maintenance_start_date || room.maintenance_end_date) && (
                      <Box sx={{ mt: 1, pt: 1, borderTop: '1px solid rgba(255,255,255,0.3)' }}>
                        {room.maintenance_start_date && (
                          <Typography variant="caption" sx={{ fontSize: '0.6rem', display: 'block' }}>
                            Start: {new Date(room.maintenance_start_date).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </Typography>
                        )}
                        {room.maintenance_end_date && (
                          <Typography variant="caption" sx={{ fontSize: '0.6rem', display: 'block' }}>
                            End: {new Date(room.maintenance_end_date).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </Typography>
                        )}
                      </Box>
                    )}

                    {/* Cleaning schedule indicator */}
                    {room.status === 'cleaning' && (room.cleaning_start_date || room.cleaning_end_date) && (
                      <Box sx={{ mt: 1, pt: 1, borderTop: '1px solid rgba(255,255,255,0.3)' }}>
                        {room.cleaning_start_date && (
                          <Typography variant="caption" sx={{ fontSize: '0.6rem', display: 'block' }}>
                            Start: {new Date(room.cleaning_start_date).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </Typography>
                        )}
                        {room.cleaning_end_date && (
                          <Typography variant="caption" sx={{ fontSize: '0.6rem', display: 'block' }}>
                            End: {new Date(room.cleaning_end_date).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </Typography>
                        )}
                      </Box>
                    )}

                    {/* Reserved period indicator */}
                    {room.status === 'reserved' && (room.reserved_start_date || room.reserved_end_date) && (
                      <Box sx={{ mt: 1, pt: 1, borderTop: '1px solid rgba(255,255,255,0.3)' }}>
                        {room.reserved_start_date && (
                          <Typography variant="caption" sx={{ fontSize: '0.6rem', display: 'block' }}>
                            Start: {new Date(room.reserved_start_date).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </Typography>
                        )}
                        {room.reserved_end_date && (
                          <Typography variant="caption" sx={{ fontSize: '0.6rem', display: 'block' }}>
                            End: {new Date(room.reserved_end_date).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </Typography>
                        )}
                      </Box>
                    )}
                  </Paper>
                </Tooltip>
              </Grid>
            ))}
          </Grid>
        </CardContent>
      </Card>

      {/* Room Status Change Dialog */}
      {statusDialogOpen && (
        <RoomEventDialog
          open={statusDialogOpen}
          onClose={() => setStatusDialogOpen(false)}
          roomId={selectedRoom ? String(selectedRoom.id) : null}
          roomNumber={selectedRoom?.room_number}
          currentStatus={selectedRoom?.status}
          onSuccess={() => {
            setStatusDialogOpen(false);
            // Reload dashboard data after successful status change
            loadDashboardData();
          }}
        />
      )}

      {/* Enhanced Check-In Modal */}
      <EnhancedCheckInModal
        open={checkinModalOpen}
        onClose={() => {
          setCheckinModalOpen(false);
          setCheckinBooking(null);
          setCheckinGuest(null);
        }}
        booking={checkinBooking}
        guest={checkinGuest}
        onCheckInSuccess={() => {
          setCheckinModalOpen(false);
          setCheckinBooking(null);
          setCheckinGuest(null);
          // Reload dashboard data to reflect the check-in
          loadDashboardData();
        }}
      />
    </Box>
  );
};

export default ReceptionistDashboard;

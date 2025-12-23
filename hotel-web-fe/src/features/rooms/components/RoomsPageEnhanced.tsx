import React, { useEffect, useState, useMemo } from 'react';
import {
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  Button,
  TextField,
  Alert,
  CircularProgress,
  Snackbar,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Tooltip,
  Paper,
  Fade,
  Slide,
  Chip,
  alpha,
} from '@mui/material';
import {
  Search as SearchIcon,
  EventAvailable as BookIcon,
  AccessTime as TimeIcon,
  CleaningServices as CleaningIcon,
  Info as InfoIcon,
  Person as PersonIcon,
  Refresh as RefreshIcon,
  FilterList as FilterIcon,
} from '@mui/icons-material';
import { HotelAPIService } from '../../../api';
import { Room, BookingWithDetails } from '../../../types';
import { useAuth } from '../../../auth/AuthContext';
import { useCurrency } from '../../../hooks/useCurrency';
import { useRoomStatus } from '../../../hooks/useRoomStatus';
import { RoomStatusChip, RoomStatusSummaryCard } from './RoomStatus';
import {
  RoomStatusType,
  getAllStatuses,
  getStatusConfig,
  ROOM_STATUS_CONFIG,
} from '../../../config/roomStatusConfig';
import QuickBookingModal from '../../bookings/components/QuickBookingModal';

/**
 * Enhanced Rooms Page Component
 * Features:
 * - Dynamic status configuration
 * - Orange dirty status
 * - Reusable components
 * - Better architecture
 * - Real-time updates
 */
const RoomsPageEnhanced: React.FC = () => {
  const { user, hasPermission } = useAuth();
  const { format: formatCurrency } = useCurrency();

  // State
  const [rooms, setRooms] = useState<Room[]>([]);
  const [bookings, setBookings] = useState<BookingWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');
  const [selectedStatuses, setSelectedStatuses] = useState<RoomStatusType[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [bookingModalOpen, setBookingModalOpen] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Check if user is admin
  const isAdmin = hasPermission('rooms:write') || user?.username === 'admin';

  // Use the custom hook for room status management
  const {
    enhancedRooms,
    availableRooms,
    roomsRequiringAction,
    statistics,
    getRoomsByStatus,
    floors,
  } = useRoomStatus(rooms, bookings);

  /**
   * Load Data
   */
  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [roomsData, bookingsData] = await Promise.all([
        HotelAPIService.searchRooms(),
        HotelAPIService.getBookingsWithDetails(),
      ]);

      setRooms(roomsData);
      setBookings(bookingsData);
    } catch (err: any) {
      setError(err.message || 'Failed to load room data');
      console.error('Error loading data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      loadData();
    }, 30000);

    return () => clearInterval(interval);
  }, [autoRefresh]);

  /**
   * Filter and Search
   */
  const filteredRooms = useMemo(() => {
    let filtered = enhancedRooms;

    // Filter by selected statuses
    if (selectedStatuses.length > 0) {
      filtered = filtered.filter(room =>
        selectedStatuses.includes(room.computedStatus)
      );
    }

    // Filter by search term
    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      filtered = filtered.filter(
        room =>
          room.room_number.toLowerCase().includes(search) ||
          room.room_type.toLowerCase().includes(search) ||
          room.currentGuest?.toLowerCase().includes(search)
      );
    }

    // For regular users, only show available rooms
    if (!isAdmin) {
      filtered = filtered.filter(room => room.computedStatus === 'available');
    }

    return filtered;
  }, [enhancedRooms, selectedStatuses, searchTerm, isAdmin]);

  /**
   * Event Handlers
   */
  const handleStatusFilterToggle = (status: RoomStatusType) => {
    setSelectedStatuses(prev =>
      prev.includes(status)
        ? prev.filter(s => s !== status)
        : [...prev, status]
    );
  };

  const handleBookRoom = (room: Room) => {
    setSelectedRoom(room);
    setBookingModalOpen(true);
  };

  const handleBookingSuccess = () => {
    setSnackbarMessage('Booking created successfully!');
    setSnackbarOpen(true);
    setBookingModalOpen(false);
    loadData();
  };

  const showSnackbar = (message: string) => {
    setSnackbarMessage(message);
    setSnackbarOpen(true);
  };

  /**
   * Format Helper
   */
  const formatDateShort = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  /**
   * Loading State
   */
  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        <CircularProgress size={60} />
      </Box>
    );
  }

  /**
   * Admin View
   */
  if (isAdmin) {
    return (
      <Box sx={{ p: 3 }}>
        <Snackbar
          open={snackbarOpen}
          autoHideDuration={6000}
          onClose={() => setSnackbarOpen(false)}
          message={snackbarMessage}
        />

        {/* Header */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
          <Box>
            <Typography variant="h4" sx={{ fontWeight: 700, mb: 0.5 }}>
              Room Management Dashboard
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Real-time room status monitoring • Total: {statistics.total} rooms •
              Occupancy: {statistics.occupancyRate}%
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 2 }}>
            <Tooltip title={autoRefresh ? 'Auto-refresh ON' : 'Auto-refresh OFF'}>
              <IconButton
                color={autoRefresh ? 'primary' : 'default'}
                onClick={() => setAutoRefresh(!autoRefresh)}
              >
                <RefreshIcon />
              </IconButton>
            </Tooltip>
            <Button
              variant="outlined"
              startIcon={<RefreshIcon />}
              onClick={loadData}
              disabled={loading}
            >
              Refresh
            </Button>
            <Button
              variant="outlined"
              startIcon={<TimeIcon />}
              sx={{ borderRadius: 2 }}
            >
              Settings
            </Button>
          </Box>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {/* Status Summary Cards - WITH ORANGE DIRTY STATUS! */}
        <Fade in timeout={800}>
          <Grid container spacing={2} sx={{ mb: 3 }}>
            {getAllStatuses().map((status, index) => (
              <Grid item xs={12} sm={6} md={3} lg={12 / 7} key={status}>
                <Slide
                  direction="up"
                  in
                  timeout={300 + index * 100}
                  style={{ transitionDelay: `${index * 50}ms` }}
                >
                  <div>
                    <RoomStatusSummaryCard
                      status={status}
                      count={statistics[status as keyof typeof statistics] as number || 0}
                      total={statistics.total}
                      showPercentage
                      compact
                      animated
                      onClick={() => handleStatusFilterToggle(status)}
                    />
                  </div>
                </Slide>
              </Grid>
            ))}
          </Grid>
        </Fade>

        {/* Action Required Alert */}
        {roomsRequiringAction.length > 0 && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {roomsRequiringAction.length} room(s) require attention
            </Typography>
            <Typography variant="caption">
              {statistics.dirty > 0 && `${statistics.dirty} dirty, `}
              {statistics.cleaning > 0 && `${statistics.cleaning} cleaning, `}
              {statistics.maintenance > 0 && `${statistics.maintenance} maintenance`}
            </Typography>
          </Alert>
        )}

        {/* Filters */}
        <Card sx={{ mb: 2 }}>
          <CardContent>
            <Grid container spacing={2} alignItems="center">
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  size="small"
                  placeholder="Search by room number, type, or guest..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  InputProps={{
                    startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} />,
                  }}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  <Typography variant="caption" sx={{ alignSelf: 'center', mr: 1 }}>
                    Filter:
                  </Typography>
                  {getAllStatuses().map(status => (
                    <Chip
                      key={status}
                      label={getStatusConfig(status).shortLabel}
                      size="small"
                      color={selectedStatuses.includes(status) ? getStatusConfig(status).color : 'default'}
                      onClick={() => handleStatusFilterToggle(status)}
                      variant={selectedStatuses.includes(status) ? 'filled' : 'outlined'}
                    />
                  ))}
                  {selectedStatuses.length > 0 && (
                    <Chip
                      label="Clear"
                      size="small"
                      variant="outlined"
                      onClick={() => setSelectedStatuses([])}
                    />
                  )}
                </Box>
              </Grid>
            </Grid>
          </CardContent>
        </Card>

        {/* Rooms Table */}
        <Card>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow sx={{ bgcolor: alpha('#000', 0.03) }}>
                  <TableCell sx={{ fontWeight: 700 }}>Room</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Type</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Details</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Price</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredRooms.map((room) => {
                  const config = getStatusConfig(room.computedStatus);

                  return (
                    <TableRow
                      key={room.id}
                      hover
                      sx={{
                        '&:hover': { bgcolor: alpha(config.bgColor, 0.05) },
                        transition: 'all 0.2s ease-in-out',
                      }}
                    >
                      <TableCell>
                        <Typography variant="body1" sx={{ fontWeight: 600 }}>
                          {room.room_number}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Floor {room.floor || 1}
                        </Typography>
                      </TableCell>

                      <TableCell>
                        <Chip label={room.room_type} size="small" color="primary" variant="outlined" />
                      </TableCell>

                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <RoomStatusChip
                            status={room.computedStatus}
                            showIcon
                            showTooltip
                            animated
                          />
                          {room.computedStatus !== room.status && room.status && (
                            <Tooltip title={`DB status: ${room.status} (overridden by booking)`}>
                              <InfoIcon sx={{ fontSize: 16, color: 'warning.main', cursor: 'help' }} />
                            </Tooltip>
                          )}
                        </Box>
                      </TableCell>

                      <TableCell>
                        {room.computedStatus === 'occupied' && room.currentGuest && (
                          <Tooltip title={`Check-in: ${formatDateShort(room.checkInDate!)}, Check-out: ${formatDateShort(room.checkOutDate!)}`}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <PersonIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                {room.currentGuest}
                              </Typography>
                            </Box>
                          </Tooltip>
                        )}
                        {room.computedStatus === 'reserved' && room.currentGuest && (
                          <Tooltip title={`Check-in: ${formatDateShort(room.checkInDate!)}, Check-out: ${formatDateShort(room.checkOutDate!)}`}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <PersonIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                {room.currentGuest}
                              </Typography>
                            </Box>
                          </Tooltip>
                        )}
                        {room.computedStatus === 'dirty' && (
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <CleaningIcon sx={{ fontSize: 14, color: config.bgColor }} />
                            <Typography variant="caption" sx={{ color: config.bgColor, fontWeight: 600 }}>
                              {config.detailMessage}
                            </Typography>
                          </Box>
                        )}
                        {room.computedStatus === 'cleaning' && (
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <CleaningIcon sx={{ fontSize: 14, color: 'info.main' }} />
                            <Typography variant="caption" sx={{ color: 'info.main' }}>
                              {config.detailMessage}
                            </Typography>
                          </Box>
                        )}
                        {room.computedStatus === 'available' && (
                          <Typography variant="caption" sx={{ color: 'success.main', fontWeight: 600 }}>
                            {config.detailMessage}
                          </Typography>
                        )}
                      </TableCell>

                      <TableCell>
                        {formatCurrency(
                          typeof room.price_per_night === 'string'
                            ? parseFloat(room.price_per_night)
                            : room.price_per_night
                        )}
                      </TableCell>

                      <TableCell>
                        {room.computedStatus === 'available' && (
                          <Button
                            variant="contained"
                            size="small"
                            startIcon={<BookIcon />}
                            onClick={() => handleBookRoom(room)}
                          >
                            Book
                          </Button>
                        )}
                        {config.requiresAction && (
                          <Button
                            variant="outlined"
                            size="small"
                            color={config.color === 'default' ? 'inherit' : config.color}
                          >
                            {config.actionLabel}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}

                {filteredRooms.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} align="center" sx={{ py: 4 }}>
                      <Typography variant="body2" color="text.secondary">
                        No rooms found matching your filters
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Card>

        {/* Booking Modal */}
        {selectedRoom && (
          <QuickBookingModal
            open={bookingModalOpen}
            onClose={() => setBookingModalOpen(false)}
            room={selectedRoom}
            onBookingSuccess={handleBookingSuccess}
          />
        )}
      </Box>
    );
  }

  /**
   * Guest View (Non-Admin)
   */
  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" sx={{ fontWeight: 700, mb: 3 }}>
        Available Rooms
      </Typography>

      {/* Available rooms grid for guests */}
      <Grid container spacing={3}>
        {availableRooms.map((room) => (
          <Grid item xs={12} md={6} lg={4} key={room.id}>
            <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
              <CardContent sx={{ flexGrow: 1 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
                  <Typography variant="h6" sx={{ fontWeight: 700 }}>
                    Room {room.room_number}
                  </Typography>
                  <RoomStatusChip status={room.computedStatus} />
                </Box>

                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  {room.room_type}
                </Typography>

                <Typography variant="h5" sx={{ fontWeight: 700, color: 'primary.main', mb: 2 }}>
                  {formatCurrency(
                    typeof room.price_per_night === 'string'
                      ? parseFloat(room.price_per_night)
                      : room.price_per_night
                  )}
                  <Typography variant="caption" sx={{ ml: 0.5 }}>/ night</Typography>
                </Typography>

                <Button
                  variant="contained"
                  fullWidth
                  startIcon={<BookIcon />}
                  onClick={() => handleBookRoom(room)}
                >
                  Book Now
                </Button>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* Booking Modal */}
      {selectedRoom && (
        <QuickBookingModal
          open={bookingModalOpen}
          onClose={() => setBookingModalOpen(false)}
          room={selectedRoom}
          onBookingSuccess={handleBookingSuccess}
        />
      )}
    </Box>
  );
};

export default RoomsPageEnhanced;

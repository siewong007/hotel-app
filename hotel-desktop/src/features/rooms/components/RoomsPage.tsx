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
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Switch,
  FormControlLabel,
  Tooltip,
  Paper,
  Checkbox,
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
  Person as PersonIcon,
  Edit as EditIcon,
  Save as SaveIcon,
  Cancel as CancelIcon,
  CheckCircle as AvailableIcon,
  Block as OccupiedIcon,
  CalendarToday as ReservedIcon,
  CleaningServices as CleaningIcon,
  Build as MaintenanceIcon,
  Info as InfoIcon,
  AccessTime as TimeIcon,
  StopCircle as StopIcon,
  Report as DirtyIcon,
} from '@mui/icons-material';
import { HotelAPIService } from '../../../api';
import { Room, BookingWithDetails } from '../../../types';
import { useAuth } from '../../../auth/AuthContext';
import QuickBookingModal from '../../bookings/components/QuickBookingModal';
import { getHotelSettings } from '../../../utils/hotelSettings';
import { useCurrency } from '../../../hooks/useCurrency';

// Room status type
type RoomStatusType = 'available' | 'occupied' | 'reserved' | 'cleaning' | 'maintenance' | 'dirty';

interface EnhancedRoom extends Room {
  computedStatus: RoomStatusType;
  currentGuest?: string;
  checkInDate?: string;
  checkOutDate?: string;
  bookingId?: string;
}

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
  const { hasRole, hasPermission, user } = useAuth();
  const isAdmin = hasRole('admin') || hasPermission('rooms:write');
  const canBookRooms = hasRole('admin') || hasRole('receptionist') || hasPermission('bookings:create');
  const isGuestUser = hasRole('guest') && !hasRole('admin');
  const { symbol: currencySymbol, format: formatCurrency } = useCurrency();

  const [rooms, setRooms] = useState<Room[]>([]);
  const [enhancedRooms, setEnhancedRooms] = useState<EnhancedRoom[]>([]);
  const [bookings, setBookings] = useState<BookingWithDetails[]>([]);
  const [filteredRooms, setFilteredRooms] = useState<Room[]>([]);
  const [aggregatedRoomTypes, setAggregatedRoomTypes] = useState<AggregatedRoomType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Admin edit state
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editFormData, setEditFormData] = useState<Partial<Room>>({});

  // Quick booking state
  const [quickBookingOpen, setQuickBookingOpen] = useState(false);
  const [roomToBook, setRoomToBook] = useState<Room | null>(null);

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
  const [paymentMethod, setPaymentMethod] = useState('Cash');
  const [isTourist, setIsTourist] = useState(false);
  const [tourismTax, setTourismTax] = useState(0);
  const [extraBedCount, setExtraBedCount] = useState(0);
  const [extraBedCharge, setExtraBedCharge] = useState(0);
  const [bookingLoading, setBookingLoading] = useState(false);

  // Payment method options
  const paymentMethods = [
    'Cash',
    'Agoda',
    'Booking.com',
    'Expedia',
    'Traveloka',
    'Visa Card',
    'Debit Card',
    'Master Card',
    'Extra Bed',
    'Tourism Tax',
    'City Ledger (Company Master)',
    'Qrpay',
    'Bank Transfer',
    'Sarawak Pay',
    'Boost',
  ];

  // Room details dialog
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [selectedRoomTypeForDetails, setSelectedRoomTypeForDetails] = useState<AggregatedRoomType | null>(null);
  const [roomReviews, setRoomReviews] = useState<GuestReview[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);

  // Notifications
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');

  // Time settings state
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [defaultCheckInTime, setDefaultCheckInTime] = useState('15:00'); // 3:00 PM
  const [defaultCheckOutTime, setDefaultCheckOutTime] = useState('11:00'); // 11:00 AM

  // Cleaning settings state
  const [cleaningDialogOpen, setCleaningDialogOpen] = useState(false);
  const [cleaningSettings, setCleaningSettings] = useState({
    cleaning_hours_start: '08:00:00',
    cleaning_hours_end: '16:00:00',
    auto_cleaning_enabled: 'true',
    cleaning_duration_minutes: '30',
    cleaning_grace_period_hours: '2'
  });
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  const roomTypes = ['Deluxe', 'Standard', 'Suite'];

  // Load time settings from localStorage on mount
  useEffect(() => {
    const savedCheckInTime = localStorage.getItem('defaultCheckInTime');
    const savedCheckOutTime = localStorage.getItem('defaultCheckOutTime');

    if (savedCheckInTime) setDefaultCheckInTime(savedCheckInTime);
    if (savedCheckOutTime) setDefaultCheckOutTime(savedCheckOutTime);
  }, []);

  useEffect(() => {
    loadRoomsAndBookings();
  }, []);

  useEffect(() => {
    filterRooms();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rooms, roomTypeFilter, maxPriceFilter]);

  // Auto-calculate tourism tax when tourist status or dates change
  useEffect(() => {
    if (isTourist && checkInDate && checkOutDate) {
      const settings = getHotelSettings();
      const checkIn = new Date(checkInDate);
      const checkOut = new Date(checkOutDate);
      const nights = Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24));
      setTourismTax(nights * settings.tourism_tax_rate);
    } else {
      setTourismTax(0);
    }
  }, [isTourist, checkInDate, checkOutDate]);

  const loadRoomsAndBookings = async () => {
    try {
      setLoading(true);
      const [roomsData, bookingsData] = await Promise.all([
        HotelAPIService.getAllRooms(),
        HotelAPIService.getBookingsWithDetails(),
      ]);
      setRooms(roomsData);
      setBookings(bookingsData);

      // Enhance rooms with computed status
      const enhanced = enhanceRoomsWithStatus(roomsData, bookingsData);
      setEnhancedRooms(enhanced);

      setError(null);
    } catch (err) {
      setError('Failed to load rooms');
    } finally {
      setLoading(false);
    }
  };

  const handleEndAllCleaning = async () => {
    const confirmed = window.confirm('Are you sure you want to end all cleaning sessions? All rooms currently being cleaned will be set to available.');
    if (!confirmed) return;

    setSavingSettings(true);
    try {
      // Get all rooms
      const allRooms = await HotelAPIService.getAllRooms();

      // Filter rooms that are in cleaning status
      const cleaningRooms = allRooms.filter(room => room.status === 'cleaning');

      if (cleaningRooms.length === 0) {
        setSnackbarMessage('No rooms are currently being cleaned.');
        setSnackbarOpen(true);
        setSavingSettings(false);
        return;
      }

      // Update all cleaning rooms to available status
      await Promise.all(
        cleaningRooms.map(room =>
          HotelAPIService.updateRoomStatus(room.id, {
            status: 'available',
            notes: 'Cleaning ended manually by administrator'
          })
        )
      );

      // Refresh rooms list
      await loadRoomsAndBookings();

      setSnackbarMessage(`Successfully ended cleaning for ${cleaningRooms.length} room(s).`);
      setSnackbarOpen(true);
    } catch (err: any) {
      console.error('Failed to end all cleaning:', err);
      setError(err.message || 'Failed to end all cleaning sessions');
    } finally {
      setSavingSettings(false);
    }
  };

  // Determine room status based on bookings (similar to AdminDashboard)
  const enhanceRoomsWithStatus = (roomsData: Room[], bookingsData: BookingWithDetails[]): EnhancedRoom[] => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return roomsData.map((room) => {
      let computedStatus: RoomStatusType = 'available';
      let currentGuest: string | undefined;
      let checkInDate: string | undefined;
      let checkOutDate: string | undefined;
      let bookingId: string | undefined;

      // Find current occupancy (checked-in guest)
      const currentOccupancy = bookingsData.find((booking) => {
        if (String(booking.room_id) !== String(room.id)) return false;

        const checkIn = new Date(booking.check_in_date);
        const checkOut = new Date(booking.check_out_date);
        checkIn.setHours(0, 0, 0, 0);
        checkOut.setHours(0, 0, 0, 0);

        // Occupied if status is checked_in or auto_checked_in AND dates overlap today
        return (
          (booking.status === 'checked_in' || booking.status === 'auto_checked_in') &&
          checkIn <= today &&
          checkOut >= today
        );
      });

      // Find today's arrival (not yet checked in)
      const todayArrival = bookingsData.find((booking) => {
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
      const futureReservation = bookingsData.find((booking) => {
        if (String(booking.room_id) !== String(room.id)) return false;

        const checkIn = new Date(booking.check_in_date);
        checkIn.setHours(0, 0, 0, 0);

        // Reserved if status is pending/confirmed AND check-in is in the future
        return (
          (booking.status === 'pending' || booking.status === 'confirmed') &&
          checkIn > today
        );
      });

      // Priority 1: Check current occupancy (checked-in guest) - this is MOST important
      if (currentOccupancy) {
        computedStatus = 'occupied';
        currentGuest = currentOccupancy.guest_name;
        checkInDate = currentOccupancy.check_in_date;
        checkOutDate = currentOccupancy.check_out_date;
        bookingId = String(currentOccupancy.id);
      }
      // Priority 2: Check today's arrival (awaiting check-in)
      else if (todayArrival) {
        computedStatus = 'reserved';
        currentGuest = todayArrival.guest_name;
        checkInDate = todayArrival.check_in_date;
        checkOutDate = todayArrival.check_out_date;
        bookingId = String(todayArrival.id);
      }
      // Priority 3: Check future reservation
      else if (futureReservation) {
        computedStatus = 'reserved';
        currentGuest = futureReservation.guest_name;
        checkInDate = futureReservation.check_in_date;
        checkOutDate = futureReservation.check_out_date;
        bookingId = String(futureReservation.id);
      }
      // Priority 4: Check explicit maintenance, cleaning, or dirty status from backend
      // Only trust backend status if there's no active booking
      else if (room.status && ['maintenance', 'cleaning', 'dirty'].includes(room.status)) {
        computedStatus = room.status as RoomStatusType;
      }
      // Priority 5: Default to available
      else {
        computedStatus = 'available';
      }

      return {
        ...room,
        computedStatus,
        currentGuest,
        checkInDate,
        checkOutDate,
        bookingId,
      };
    });
  };

  // Get status color
  const getStatusColor = (status: RoomStatusType): 'success' | 'error' | 'warning' | 'info' | 'default' => {
    switch (status) {
      case 'available': return 'success';
      case 'occupied': return 'error';
      case 'reserved': return 'warning';
      case 'cleaning': return 'info';
      case 'dirty': return 'error'; // Red color for dirty rooms
      case 'maintenance': return 'default';
      default: return 'default';
    }
  };

  // Get status label
  const getStatusLabel = (status: RoomStatusType): string => {
    switch (status) {
      case 'available': return 'Available';
      case 'occupied': return 'Occupied';
      case 'reserved': return 'Reserved';
      case 'cleaning': return 'Cleaning';
      case 'dirty': return 'Dirty';
      case 'maintenance': return 'Maintenance';
      default: return status;
    }
  };

  // Get status icon
  const getStatusIcon = (status: RoomStatusType) => {
    const iconProps = { sx: { fontSize: 16, mr: 0.5 } };
    switch (status) {
      case 'available': return <AvailableIcon {...iconProps} />;
      case 'occupied': return <OccupiedIcon {...iconProps} />;
      case 'reserved': return <ReservedIcon {...iconProps} />;
      case 'cleaning': return <CleaningIcon {...iconProps} />;
      case 'dirty': return <DirtyIcon {...iconProps} />;
      case 'maintenance': return <MaintenanceIcon {...iconProps} />;
      default: return null;
    }
  };

  // Format date for display
  const formatDateShort = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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

      // Check if room is truly available by looking at enhanced status
      const enhancedRoom = enhancedRooms.find(er => er.id === room.id);
      const isTrulyAvailable = enhancedRoom?.computedStatus === 'available';

      if (isTrulyAvailable) {
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

    // For regular users: only show truly available rooms (not occupied, reserved, cleaning, or maintenance)
    // We use the enhancedRooms to get accurate status
    if (!isAdmin) {
      const availableRoomIds = new Set(
        enhancedRooms
          .filter(room => room.computedStatus === 'available')
          .map(room => room.id)
      );
      filtered = filtered.filter(room => availableRoomIds.has(room.id));
    }

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

  // Admin room management handlers
  const handleEditClick = (room: Room) => {
    setEditingRoom(room);
    setEditFormData({
      room_number: room.room_number,
      room_type: room.room_type,
      price_per_night: typeof room.price_per_night === 'string' ? parseFloat(room.price_per_night) : room.price_per_night,
      available: room.available,
      description: room.description,
      max_occupancy: room.max_occupancy,
    });
    setEditDialogOpen(true);
  };

  const handleSaveRoom = async () => {
    if (!editingRoom) return;

    try {
      setLoading(true);
      setError(null);
      await HotelAPIService.updateRoom(editingRoom.id, editFormData);
      setSnackbarMessage('Room updated successfully');
      setSnackbarOpen(true);
      setEditDialogOpen(false);
      await loadRoomsAndBookings();
    } catch (err: any) {
      console.error('Failed to update room:', err);
      if (err.statusCode === 401) {
        setError('Unauthorized: You do not have permission to update rooms. Please contact an administrator.');
      } else if (err.statusCode === 403) {
        setError('Forbidden: You do not have the required "rooms:write" permission.');
      } else {
        setError(err.message || 'Failed to update room');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleQuickBook = (room: Room) => {
    setRoomToBook(room);
    setQuickBookingOpen(true);
  };

  const handleBookingSuccess = () => {
    setSnackbarMessage('Booking created successfully!');
    setSnackbarOpen(true);
    loadRoomsAndBookings(); // Reload rooms to update availability
  };

  const handleSaveTimeSettings = () => {
    localStorage.setItem('defaultCheckInTime', defaultCheckInTime);
    localStorage.setItem('defaultCheckOutTime', defaultCheckOutTime);
    setSettingsDialogOpen(false);
    setSnackbarMessage('Check-in/Check-out times updated successfully!');
    setSnackbarOpen(true);
  };

  const loadCleaningSettings = async () => {
    setLoadingSettings(true);
    try {
      const settings = await HotelAPIService.getSystemSettings();
      const settingsMap: any = {};
      settings.forEach((setting: any) => {
        if (setting.key.startsWith('cleaning_') || setting.key.startsWith('auto_cleaning')) {
          settingsMap[setting.key] = setting.value;
        }
      });
      setCleaningSettings({
        cleaning_hours_start: settingsMap.cleaning_hours_start || '08:00:00',
        cleaning_hours_end: settingsMap.cleaning_hours_end || '16:00:00',
        auto_cleaning_enabled: settingsMap.auto_cleaning_enabled || 'true',
        cleaning_duration_minutes: settingsMap.cleaning_duration_minutes || '30',
        cleaning_grace_period_hours: settingsMap.cleaning_grace_period_hours || '2'
      });
    } catch (err) {
      console.error('Failed to load cleaning settings:', err);
      setError('Failed to load cleaning settings');
    } finally {
      setLoadingSettings(false);
    }
  };

  const handleSaveCleaningSettings = async () => {
    setSavingSettings(true);
    try {
      await Promise.all([
        HotelAPIService.updateSystemSetting('cleaning_hours_start', cleaningSettings.cleaning_hours_start),
        HotelAPIService.updateSystemSetting('cleaning_hours_end', cleaningSettings.cleaning_hours_end),
        HotelAPIService.updateSystemSetting('auto_cleaning_enabled', cleaningSettings.auto_cleaning_enabled),
        HotelAPIService.updateSystemSetting('cleaning_duration_minutes', cleaningSettings.cleaning_duration_minutes),
        HotelAPIService.updateSystemSetting('cleaning_grace_period_hours', cleaningSettings.cleaning_grace_period_hours)
      ]);
      setCleaningDialogOpen(false);
      setSnackbarMessage('Cleaning settings updated successfully!');
      setSnackbarOpen(true);
    } catch (err: any) {
      console.error('Failed to save cleaning settings:', err);
      setError(err.message || 'Failed to save cleaning settings');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleOpenCleaningDialog = async () => {
    setCleaningDialogOpen(true);
    await loadCleaningSettings();
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
      await loadRoomsAndBookings();

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

  // Calculate status summary
  const getStatusSummary = () => {
    const summary = {
      available: 0,
      occupied: 0,
      reserved: 0,
      cleaning: 0,
      dirty: 0,
      maintenance: 0,
      total: enhancedRooms.length
    };

    enhancedRooms.forEach(room => {
      summary[room.computedStatus]++;
    });

    return summary;
  };

  // Admin View
  if (isAdmin) {
    const statusSummary = getStatusSummary();

    return (
      <Box sx={{ p: 3 }}>
        <Snackbar
          open={snackbarOpen}
          autoHideDuration={6000}
          onClose={() => setSnackbarOpen(false)}
          message={snackbarMessage}
        />

        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
          <Typography variant="h4" sx={{ fontWeight: 700 }}>
            Room Management
          </Typography>
          <Box sx={{ display: 'flex', gap: 2 }}>
            <Button
              variant="outlined"
              startIcon={<TimeIcon />}
              onClick={() => setSettingsDialogOpen(true)}
              sx={{ borderRadius: 2 }}
            >
              Check-in/Out Times
            </Button>
            <Button
              variant="outlined"
              startIcon={<CleaningIcon />}
              onClick={handleOpenCleaningDialog}
              sx={{ borderRadius: 2 }}
            >
              Auto-Cleaning Settings
            </Button>
          </Box>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {/* Status Summary Cards */}
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid item xs={12} sm={6} md={2}>
            <Card sx={{ bgcolor: 'success.light', color: 'success.contrastText' }}>
              <CardContent sx={{ py: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Box>
                    <Typography variant="caption" sx={{ opacity: 0.9 }}>Available</Typography>
                    <Typography variant="h4" sx={{ fontWeight: 700 }}>{statusSummary.available}</Typography>
                  </Box>
                  <AvailableIcon sx={{ fontSize: 40, opacity: 0.7 }} />
                </Box>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6} md={2}>
            <Card sx={{ bgcolor: 'error.light', color: 'error.contrastText' }}>
              <CardContent sx={{ py: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Box>
                    <Typography variant="caption" sx={{ opacity: 0.9 }}>Occupied</Typography>
                    <Typography variant="h4" sx={{ fontWeight: 700 }}>{statusSummary.occupied}</Typography>
                  </Box>
                  <OccupiedIcon sx={{ fontSize: 40, opacity: 0.7 }} />
                </Box>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6} md={2}>
            <Card sx={{ bgcolor: 'warning.light', color: 'warning.contrastText' }}>
              <CardContent sx={{ py: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Box>
                    <Typography variant="caption" sx={{ opacity: 0.9 }}>Reserved</Typography>
                    <Typography variant="h4" sx={{ fontWeight: 700 }}>{statusSummary.reserved}</Typography>
                  </Box>
                  <ReservedIcon sx={{ fontSize: 40, opacity: 0.7 }} />
                </Box>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6} md={2}>
            <Card sx={{ bgcolor: 'info.light', color: 'info.contrastText' }}>
              <CardContent sx={{ py: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Box>
                    <Typography variant="caption" sx={{ opacity: 0.9 }}>Cleaning</Typography>
                    <Typography variant="h4" sx={{ fontWeight: 700 }}>{statusSummary.cleaning}</Typography>
                  </Box>
                  <CleaningIcon sx={{ fontSize: 40, opacity: 0.7 }} />
                </Box>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6} md={2}>
            <Card sx={{ bgcolor: 'error.main', color: 'error.contrastText' }}>
              <CardContent sx={{ py: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Box>
                    <Typography variant="caption" sx={{ opacity: 0.9 }}>Dirty</Typography>
                    <Typography variant="h4" sx={{ fontWeight: 700 }}>{statusSummary.dirty}</Typography>
                  </Box>
                  <DirtyIcon sx={{ fontSize: 40, opacity: 0.7 }} />
                </Box>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6} md={2}>
            <Card sx={{ bgcolor: 'grey.400', color: 'grey.900' }}>
              <CardContent sx={{ py: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Box>
                    <Typography variant="caption" sx={{ opacity: 0.9 }}>Maintenance</Typography>
                    <Typography variant="h4" sx={{ fontWeight: 700 }}>{statusSummary.maintenance}</Typography>
                  </Box>
                  <MaintenanceIcon sx={{ fontSize: 40, opacity: 0.7 }} />
                </Box>
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        <Card>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Room Number</TableCell>
                  <TableCell>Room Type</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Details</TableCell>
                  <TableCell>Price/Night</TableCell>
                  <TableCell>Max Occupancy</TableCell>
                  <TableCell>Description</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {enhancedRooms.map((room) => (
                  <TableRow key={room.id}>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {room.room_number}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip label={room.room_type} size="small" color="primary" variant="outlined" />
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Chip
                          icon={getStatusIcon(room.computedStatus)}
                          label={getStatusLabel(room.computedStatus)}
                          size="small"
                          color={getStatusColor(room.computedStatus)}
                          sx={{
                            fontWeight: 600,
                            minWidth: 100,
                            '& .MuiChip-icon': {
                              color: 'inherit'
                            }
                          }}
                        />
                        {room.computedStatus !== room.status && room.status && (
                          <Tooltip title={`Backend status: ${room.status} (overridden by booking data)`}>
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
                      {room.computedStatus === 'maintenance' && room.maintenance_start_date && (
                        <Tooltip title={`Maintenance: ${formatDateShort(room.maintenance_start_date)} - ${room.maintenance_end_date ? formatDateShort(room.maintenance_end_date) : 'TBD'}`}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <InfoIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                              {formatDateShort(room.maintenance_start_date)}
                            </Typography>
                          </Box>
                        </Tooltip>
                      )}
                      {room.computedStatus === 'cleaning' && room.cleaning_start_date && (
                        <Tooltip title={`Cleaning: ${formatDateShort(room.cleaning_start_date)} - ${room.cleaning_end_date ? formatDateShort(room.cleaning_end_date) : 'TBD'}`}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <InfoIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                              {formatDateShort(room.cleaning_start_date)}
                            </Typography>
                          </Box>
                        </Tooltip>
                      )}
                      {room.computedStatus === 'dirty' && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <DirtyIcon sx={{ fontSize: 14, color: 'error.main' }} />
                          <Typography variant="caption" sx={{ color: 'error.main', fontWeight: 600 }}>
                            Needs cleaning
                          </Typography>
                        </Box>
                      )}
                      {room.computedStatus === 'available' && (
                        <Typography variant="caption" sx={{ color: 'text.secondary', fontStyle: 'italic' }}>
                          Ready to book
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      {formatCurrency(typeof room.price_per_night === 'string' ? parseFloat(room.price_per_night) : room.price_per_night)}
                    </TableCell>
                    <TableCell>{room.max_occupancy} guests</TableCell>
                    <TableCell sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {room.description}
                    </TableCell>
                    <TableCell align="right">
                      <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                        {canBookRooms && room.computedStatus === 'available' && (
                          <Button
                            size="small"
                            variant="contained"
                            color="success"
                            onClick={() => handleQuickBook(room)}
                            startIcon={<BookIcon />}
                          >
                            Quick Book
                          </Button>
                        )}
                        <Tooltip
                          title={room.computedStatus === 'occupied' ? 'Cannot edit occupied room. Please check out the guest first.' : 'Edit room details'}
                        >
                          <span>
                            <IconButton
                              size="small"
                              onClick={() => handleEditClick(room)}
                              color="primary"
                              disabled={room.computedStatus === 'occupied'}
                            >
                              <EditIcon />
                            </IconButton>
                          </span>
                        </Tooltip>
                      </Box>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Card>

        {/* Quick Booking Modal */}
        <QuickBookingModal
          open={quickBookingOpen}
          onClose={() => setQuickBookingOpen(false)}
          room={roomToBook}
          onBookingSuccess={handleBookingSuccess}
          defaultCheckInTime={defaultCheckInTime}
          defaultCheckOutTime={defaultCheckOutTime}
          guestMode={isGuestUser}
        />

        {/* Time Settings Dialog */}
        <Dialog open={settingsDialogOpen} onClose={() => setSettingsDialogOpen(false)} maxWidth="sm" fullWidth>
          <DialogTitle>
            <Box display="flex" alignItems="center">
              <TimeIcon sx={{ mr: 1, color: 'primary.main' }} />
              <Typography variant="h6">Default Check-in/Check-out Times</Typography>
            </Box>
          </DialogTitle>
          <DialogContent>
            <Alert severity="info" sx={{ mb: 3 }}>
              Set the default times for check-in and check-out. These will be used when creating new bookings.
            </Alert>
            <Grid container spacing={3} sx={{ mt: 1 }}>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Check-in Time"
                  type="time"
                  value={defaultCheckInTime}
                  onChange={(e) => setDefaultCheckInTime(e.target.value)}
                  InputLabelProps={{ shrink: true }}
                  helperText="Default: 3:00 PM (15:00)"
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Check-out Time"
                  type="time"
                  value={defaultCheckOutTime}
                  onChange={(e) => setDefaultCheckOutTime(e.target.value)}
                  InputLabelProps={{ shrink: true }}
                  helperText="Default: 11:00 AM (11:00)"
                />
              </Grid>
              <Grid item xs={12}>
                <Paper elevation={0} sx={{ p: 2, bgcolor: 'grey.50', borderRadius: 2 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                    Current Settings Preview
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Check-in: {new Date(`2000-01-01T${defaultCheckInTime}`).toLocaleTimeString('en-US', {
                      hour: 'numeric',
                      minute: '2-digit',
                      hour12: true
                    })}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Check-out: {new Date(`2000-01-01T${defaultCheckOutTime}`).toLocaleTimeString('en-US', {
                      hour: 'numeric',
                      minute: '2-digit',
                      hour12: true
                    })}
                  </Typography>
                </Paper>
              </Grid>
            </Grid>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => {
              setSettingsDialogOpen(false);
              // Reset to saved values
              const savedCheckInTime = localStorage.getItem('defaultCheckInTime') || '15:00';
              const savedCheckOutTime = localStorage.getItem('defaultCheckOutTime') || '11:00';
              setDefaultCheckInTime(savedCheckInTime);
              setDefaultCheckOutTime(savedCheckOutTime);
            }} startIcon={<CancelIcon />}>
              Cancel
            </Button>
            <Button onClick={handleSaveTimeSettings} variant="contained" startIcon={<SaveIcon />}>
              Save Settings
            </Button>
          </DialogActions>
        </Dialog>

        {/* Auto-Cleaning Settings Dialog */}
        <Dialog open={cleaningDialogOpen} onClose={() => setCleaningDialogOpen(false)} maxWidth="md" fullWidth>
          <DialogTitle>
            <Box display="flex" alignItems="center">
              <CleaningIcon sx={{ mr: 1, color: 'primary.main' }} />
              <Typography variant="h6">Auto-Cleaning Configuration</Typography>
            </Box>
          </DialogTitle>
          <DialogContent>
            {loadingSettings ? (
              <Box display="flex" justifyContent="center" py={4}>
                <CircularProgress />
              </Box>
            ) : (
              <>
                <Alert severity="info" sx={{ mb: 3 }}>
                  Configure automatic cleaning scheduling for rooms. When enabled, the system will automatically
                  set rooms to cleaning status when they become available during cleaning hours.
                </Alert>
                <Grid container spacing={3} sx={{ mt: 1 }}>
                  <Grid item xs={12}>
                    <FormControlLabel
                      control={
                        <Switch
                          checked={cleaningSettings.auto_cleaning_enabled === 'true'}
                          onChange={(e) => setCleaningSettings({
                            ...cleaningSettings,
                            auto_cleaning_enabled: e.target.checked ? 'true' : 'false'
                          })}
                          color="primary"
                        />
                      }
                      label={
                        <Box>
                          <Typography variant="body1" sx={{ fontWeight: 600 }}>
                            Enable Auto-Cleaning
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            Automatically set rooms to cleaning status when they become available
                          </Typography>
                        </Box>
                      }
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      label="Cleaning Hours Start"
                      type="time"
                      value={cleaningSettings.cleaning_hours_start.substring(0, 5)}
                      onChange={(e) => setCleaningSettings({
                        ...cleaningSettings,
                        cleaning_hours_start: e.target.value + ':00'
                      })}
                      InputLabelProps={{ shrink: true }}
                      helperText="When cleaning service starts"
                      disabled={cleaningSettings.auto_cleaning_enabled !== 'true'}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      label="Cleaning Hours End"
                      type="time"
                      value={cleaningSettings.cleaning_hours_end.substring(0, 5)}
                      onChange={(e) => setCleaningSettings({
                        ...cleaningSettings,
                        cleaning_hours_end: e.target.value + ':00'
                      })}
                      InputLabelProps={{ shrink: true }}
                      helperText="When cleaning service ends"
                      disabled={cleaningSettings.auto_cleaning_enabled !== 'true'}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      label="Cleaning Duration (minutes)"
                      type="number"
                      value={cleaningSettings.cleaning_duration_minutes}
                      onChange={(e) => setCleaningSettings({
                        ...cleaningSettings,
                        cleaning_duration_minutes: e.target.value
                      })}
                      InputLabelProps={{ shrink: true }}
                      helperText="Expected time to clean a room"
                      inputProps={{ min: 10, max: 180 }}
                      disabled={cleaningSettings.auto_cleaning_enabled !== 'true'}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      label="Grace Period (hours)"
                      type="number"
                      value={cleaningSettings.cleaning_grace_period_hours}
                      onChange={(e) => setCleaningSettings({
                        ...cleaningSettings,
                        cleaning_grace_period_hours: e.target.value
                      })}
                      InputLabelProps={{ shrink: true }}
                      helperText="Skip cleaning if next booking is within this time"
                      inputProps={{ min: 0, max: 24 }}
                      disabled={cleaningSettings.auto_cleaning_enabled !== 'true'}
                    />
                  </Grid>
                  <Grid item xs={12}>
                    <Paper elevation={0} sx={{ p: 2, bgcolor: 'grey.50', borderRadius: 2 }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                        Current Configuration
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Auto-Cleaning: {cleaningSettings.auto_cleaning_enabled === 'true' ? 'Enabled' : 'Disabled'}
                      </Typography>
                      {cleaningSettings.auto_cleaning_enabled === 'true' && (
                        <>
                          <Typography variant="body2" color="text.secondary">
                            Cleaning Hours: {cleaningSettings.cleaning_hours_start.substring(0, 5)} - {cleaningSettings.cleaning_hours_end.substring(0, 5)}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            Duration: {cleaningSettings.cleaning_duration_minutes} minutes
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            Grace Period: {cleaningSettings.cleaning_grace_period_hours} hours
                          </Typography>
                        </>
                      )}
                    </Paper>
                  </Grid>
                </Grid>
              </>
            )}
          </DialogContent>
          <DialogActions sx={{ justifyContent: 'space-between', px: 3, py: 2 }}>
            <Button
              onClick={handleEndAllCleaning}
              variant="outlined"
              color="error"
              startIcon={<StopIcon />}
              disabled={savingSettings || loadingSettings}
            >
              End All Cleaning
            </Button>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button onClick={() => setCleaningDialogOpen(false)} startIcon={<CancelIcon />}>
                Cancel
              </Button>
              <Button
                onClick={handleSaveCleaningSettings}
                variant="contained"
                startIcon={<SaveIcon />}
                disabled={savingSettings || loadingSettings}
              >
                {savingSettings ? 'Saving...' : 'Save Settings'}
              </Button>
            </Box>
          </DialogActions>
        </Dialog>

        {/* Edit Dialog */}
        <Dialog open={editDialogOpen} onClose={() => setEditDialogOpen(false)} maxWidth="sm" fullWidth>
          <DialogTitle>Edit Room {editingRoom?.room_number}</DialogTitle>
          <DialogContent>
            <Grid container spacing={2} sx={{ mt: 1 }}>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Room Number"
                  value={editFormData.room_number || ''}
                  onChange={(e) => setEditFormData({ ...editFormData, room_number: e.target.value })}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Room Type"
                  value={editFormData.room_type || ''}
                  onChange={(e) => setEditFormData({ ...editFormData, room_type: e.target.value })}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Price Per Night"
                  type="number"
                  value={editFormData.price_per_night || ''}
                  onChange={(e) => setEditFormData({ ...editFormData, price_per_night: parseFloat(e.target.value) })}
                  inputProps={{ step: '0.01', min: '0' }}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Max Occupancy"
                  type="number"
                  value={editFormData.max_occupancy || ''}
                  onChange={(e) => setEditFormData({ ...editFormData, max_occupancy: parseInt(e.target.value) })}
                  inputProps={{ min: '1' }}
                />
              </Grid>
              <Grid item xs={12}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={editFormData.available || false}
                      onChange={(e) => setEditFormData({ ...editFormData, available: e.target.checked })}
                    />
                  }
                  label="Available for Booking"
                  sx={{
                    width: '100%',
                    '& .MuiFormControlLabel-label': {
                      width: '100%',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'normal',
                      wordWrap: 'break-word'
                    }
                  }}
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Description"
                  multiline
                  rows={3}
                  value={editFormData.description || ''}
                  onChange={(e) => setEditFormData({ ...editFormData, description: e.target.value })}
                />
              </Grid>
            </Grid>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setEditDialogOpen(false)} startIcon={<CancelIcon />}>
              Cancel
            </Button>
            <Button onClick={() => handleSaveRoom()} variant="contained" startIcon={<SaveIcon />} disabled={loading}>
              Save Changes
            </Button>
          </DialogActions>
        </Dialog>
      </Box>
    );
  }

  // Regular User View
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
              label={`Max Price (${currencySymbol})`}
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
              label={`Max Price: ${currencySymbol}${maxPriceFilter}`}
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
                      {formatCurrency(roomType.price_per_night)}
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
            <TextField
              select
              fullWidth
              label="Payment Method"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              sx={{ mb: 2 }}
              helperText="Select how the guest will pay for this booking"
            >
              {paymentMethods.map((method) => (
                <MenuItem key={method} value={method}>
                  {method}
                </MenuItem>
              ))}
            </TextField>

            {/* Tourist Status */}
            <FormControlLabel
              control={
                <Checkbox
                  checked={isTourist}
                  onChange={(e) => setIsTourist(e.target.checked)}
                  color="primary"
                />
              }
              label={
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    Guest is a Tourist
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Tourism tax will be applied automatically
                  </Typography>
                </Box>
              }
              sx={{ mb: 2 }}
            />

            {/* Tourism Tax (read-only, auto-calculated) */}
            {isTourist && (
              <TextField
                fullWidth
                label="Tourism Tax (Auto-calculated)"
                value={formatCurrency(tourismTax)}
                InputProps={{ readOnly: true }}
                disabled
                helperText={checkInDate && checkOutDate ? `${Math.ceil((new Date(checkOutDate).getTime() - new Date(checkInDate).getTime()) / (1000 * 60 * 60 * 24))} night(s) × ${formatCurrency(getHotelSettings().tourism_tax_rate)}/night` : 'Select dates to calculate'}
                sx={{ mb: 2 }}
              />
            )}

            {/* Extra Beds */}
            <Grid container spacing={2} sx={{ mb: 2 }}>
              <Grid item xs={6}>
                <TextField
                  fullWidth
                  label="Number of Extra Beds"
                  type="number"
                  value={extraBedCount}
                  onChange={(e) => {
                    const count = parseInt(e.target.value) || 0;
                    setExtraBedCount(count);
                    setExtraBedCharge(count * 50); // Default 50 per extra bed
                  }}
                  inputProps={{ min: 0, max: 5 }}
                  helperText={`${formatCurrency(50)} per extra bed`}
                />
              </Grid>
              <Grid item xs={6}>
                <TextField
                  fullWidth
                  label="Extra Bed Charge"
                  type="number"
                  value={extraBedCharge}
                  onChange={(e) => setExtraBedCharge(parseFloat(e.target.value) || 0)}
                  InputProps={{
                    startAdornment: <Typography sx={{ mr: 0.5 }}>{currencySymbol}</Typography>
                  }}
                  helperText="Auto-calculated or adjust manually"
                />
              </Grid>
            </Grid>

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
                  Price: {formatCurrency(typeof selectedRoom.price_per_night === 'string'
                    ? parseFloat(selectedRoom.price_per_night)
                    : selectedRoom.price_per_night)}/night
                </Typography>
                <Typography variant="body2">
                  Post Type: {postType === 'normal_stay' ? 'Normal Stay' : 'Same Day'}
                </Typography>
                <Typography variant="body2">
                  Rate Code: {rateCode}
                </Typography>
                <Typography variant="body2">
                  Payment Method: {paymentMethod}
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
                  {formatCurrency(selectedRoomTypeForDetails?.price_per_night || 0)}
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

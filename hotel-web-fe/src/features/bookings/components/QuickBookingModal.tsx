import React, { useState, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Typography,
  CircularProgress,
  Alert,
  Autocomplete,
  Grid,
  Divider,
  Paper,
  FormControlLabel,
  Checkbox,
} from '@mui/material';
import {
  PersonAdd as PersonAddIcon,
  EventAvailable as BookIcon,
} from '@mui/icons-material';
import { HotelAPIService } from '../../../api';
import { Room, Guest, RoomType } from '../../../types';
import { validateEmail, validatePhone } from '../../../utils/validation';
import ModernDatePicker from '../../../components/common/ModernDatePicker';
import { useAuth } from '../../../auth/AuthContext';
import { useCurrency } from '../../../hooks/useCurrency';
import { useRoomAvailabilityCheck } from '../../../hooks/useRoomAvailabilityCheck';
import { getHotelSettings } from '../../../utils/hotelSettings';

interface QuickBookingModalProps {
  open: boolean;
  onClose: () => void;
  room: Room | null;
  onBookingSuccess: () => void;
  defaultCheckInTime?: string;
  defaultCheckOutTime?: string;
  guestMode?: boolean; // If true, book for the current logged-in guest
}

const QuickBookingModal: React.FC<QuickBookingModalProps> = ({
  open,
  onClose,
  room,
  onBookingSuccess,
  defaultCheckInTime = '15:00',
  defaultCheckOutTime = '11:00',
  guestMode = false,
}) => {
  const { user } = useAuth();
  const { symbol: currencySymbol, format: formatCurrency } = useCurrency();

  // Room type config for extra bed
  const [roomTypeConfig, setRoomTypeConfig] = useState<RoomType | null>(null);

  // Guest selection state
  const [guests, setGuests] = useState<Guest[]>([]);
  const [selectedGuest, setSelectedGuest] = useState<Guest | null>(null);
  const [guestsLoading, setGuestsLoading] = useState(false);
  const [showNewGuestForm, setShowNewGuestForm] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);

  // New guest form state
  const [newGuestFirstName, setNewGuestFirstName] = useState('');
  const [newGuestLastName, setNewGuestLastName] = useState('');
  const [newGuestEmail, setNewGuestEmail] = useState('');
  const [newGuestPhone, setNewGuestPhone] = useState('');
  const [emailError, setEmailError] = useState('');
  const [phoneError, setPhoneError] = useState('');

  // Booking form state
  const [checkInDate, setCheckInDate] = useState('');
  const [checkInTime, setCheckInTime] = useState(defaultCheckInTime);
  const [checkOutDate, setCheckOutDate] = useState('');
  const [checkOutTime, setCheckOutTime] = useState(defaultCheckOutTime);
  const [remarks, setRemarks] = useState('');
  const [postType, setPostType] = useState<'normal_stay' | 'same_day'>('normal_stay');
  const [rateCode, setRateCode] = useState('RACK');

  // Payment and charges state
  const [isTourist, setIsTourist] = useState(false);
  const [tourismTax, setTourismTax] = useState(0);
  const [extraBedCount, setExtraBedCount] = useState(0);
  const [extraBedCharge, setExtraBedCharge] = useState(0);

  // Custom rate override state
  const [useCustomRate, setUseCustomRate] = useState(false);
  const [customRate, setCustomRate] = useState<number>(0);
  const [dailyRates, setDailyRates] = useState<Record<string, number>>({});

  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check availability when dates change for pre-selected room
  const { isAvailable: roomIsAvailable, isChecking: checkingAvailability } = useRoomAvailabilityCheck(
    room?.id ?? null,
    checkInDate,
    checkOutDate,
    !!room
  );

  // Track previous open state to detect true open/close transitions
  const wasOpenRef = useRef(false);

  // Load guests when modal opens - use proper transition detection
  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = open;

    // Only run initialization when transitioning from closed to open
    if (open && !wasOpen) {
      if (guestMode) {
        // In guest mode, use the current user's ID directly
        if (user && user.id) {
          setCurrentUserId(typeof user.id === 'string' ? parseInt(user.id, 10) : user.id);
        }
      } else {
        // In admin mode, load all guests
        loadGuests();
      }
      // Set default dates
      const today = new Date().toISOString().split('T')[0];
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      setCheckInDate(today);
      setCheckOutDate(tomorrow);
      // Set default times from props
      setCheckInTime(defaultCheckInTime);
      setCheckOutTime(defaultCheckOutTime);

      // Load room type config to get extra bed settings
      if (room) {
        loadRoomTypeConfig(room.room_type);
      }
    }

    // Only reset when transitioning from open to closed
    if (!open && wasOpen) {
      resetForm();
    }
  }, [open, defaultCheckInTime, defaultCheckOutTime, guestMode, user]);

  // Reinitialize daily rates when dates change while custom rate is active
  useEffect(() => {
    if (useCustomRate && checkInDate && checkOutDate && room) {
      const price = typeof room.price_per_night === 'string'
        ? parseFloat(room.price_per_night)
        : room.price_per_night;
      initializeDailyRates(customRate || price);
    }
  }, [checkInDate, checkOutDate]);

  // Auto-calculate tourism tax when tourist status or dates change
  useEffect(() => {
    if (isTourist && checkInDate && checkOutDate) {
      const settings = getHotelSettings();
      const nights = calculateNights();
      setTourismTax(nights * settings.tourism_tax_rate);
    } else {
      setTourismTax(0);
    }
  }, [isTourist, checkInDate, checkOutDate]);

  const loadGuests = async () => {
    try {
      setGuestsLoading(true);
      const data = await HotelAPIService.getAllGuests();
      setGuests(data);
    } catch (err) {
      console.error('Failed to load guests:', err);
    } finally {
      setGuestsLoading(false);
    }
  };

  const loadRoomTypeConfig = async (roomTypeName: string) => {
    try {
      const roomTypes = await HotelAPIService.getAllRoomTypes();
      const matched = roomTypes.find(rt => rt.name === roomTypeName);
      setRoomTypeConfig(matched || null);
    } catch (err) {
      console.error('Failed to load room type config:', err);
      setRoomTypeConfig(null);
    }
  };

  // Derived extra bed config from room type
  const allowsExtraBed = roomTypeConfig?.allows_extra_bed ?? false;
  const maxExtraBeds = roomTypeConfig?.max_extra_beds ?? 0;
  const extraBedChargePerBed = roomTypeConfig
    ? (typeof roomTypeConfig.extra_bed_charge === 'string'
        ? parseFloat(roomTypeConfig.extra_bed_charge)
        : roomTypeConfig.extra_bed_charge) || 0
    : 0;

  const resetForm = () => {
    setSelectedGuest(null);
    setShowNewGuestForm(false);
    setNewGuestFirstName('');
    setNewGuestLastName('');
    setNewGuestEmail('');
    setNewGuestPhone('');
    setCheckInDate('');
    setCheckInTime(defaultCheckInTime);
    setCheckOutDate('');
    setCheckOutTime(defaultCheckOutTime);
    setRemarks('');
    setPostType('normal_stay');
    setRateCode('RACK');
    setIsTourist(false);
    setTourismTax(0);
    setExtraBedCount(0);
    setExtraBedCharge(0);

    setUseCustomRate(false);
    setCustomRate(0);
    setDailyRates({});
    setRoomTypeConfig(null);
    setError(null);
  };

  const handleGuestInputChange = (value: string) => {
    // Show new guest form if no match found and user has typed something
    if (value && !guests.find(g => g.full_name.toLowerCase().includes(value.toLowerCase()))) {
      // Parse the input to suggest first/last name
      const nameParts = value.trim().split(' ');
      if (nameParts.length > 0) {
        setNewGuestFirstName(nameParts[0]);
        setNewGuestLastName(nameParts.slice(1).join(' '));
      }
    }
  };

  const handleCreateNewGuest = async () => {
    if (!newGuestFirstName) {
      setError('First name is required for new guest');
      return null;
    }

    // Validate email format only if provided
    if (newGuestEmail && newGuestEmail.trim()) {
      const emailValidation = validateEmail(newGuestEmail);
      if (emailValidation) {
        setEmailError(emailValidation);
        setError(emailValidation);
        return null;
      }
    }

    try {
      const newGuest = await HotelAPIService.createGuest({
        first_name: newGuestFirstName,
        last_name: newGuestLastName,
        email: newGuestEmail || undefined,
        phone: newGuestPhone || undefined,
      });

      // Add to guests list and select it
      setGuests([...guests, newGuest]);
      setSelectedGuest(newGuest);
      setShowNewGuestForm(false);
      return newGuest;
    } catch (err: any) {
      setError(err.message || 'Failed to create guest');
      return null;
    }
  };

  const handleConfirmBooking = async () => {
    if (!room) return;

    // Determine which guest ID to use
    let guestIdToUse: number | null = null;

    if (guestMode) {
      // In guest mode, use the current user's ID
      if (!currentUserId) {
        setError('User ID not found. Please log in again.');
        return;
      }
      guestIdToUse = currentUserId;
    } else {
      // In admin mode, validate guest selection or creation
      let guestToBook = selectedGuest;
      if (showNewGuestForm) {
        guestToBook = await handleCreateNewGuest();
        if (!guestToBook) return;
      }

      if (!guestToBook) {
        setError('Please select or create a guest');
        return;
      }
      guestIdToUse = guestToBook.id;
    }

    if (!checkInDate || !checkOutDate) {
      setError('Please select check-in and check-out dates');
      return;
    }

    // Validate dates
    const checkIn = new Date(checkInDate);
    const checkOut = new Date(checkOutDate);
    checkIn.setHours(0, 0, 0, 0);
    checkOut.setHours(0, 0, 0, 0);
    if (checkOut <= checkIn) {
      setError('Check-out date must be after check-in date. Please select a check-out date that is at least 1 day after check-in.');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Combine date and time for full timestamps
      const checkInDateTime = `${checkInDate}T${checkInTime}:00`;
      const checkOutDateTime = `${checkOutDate}T${checkOutTime}:00`;

      // Create the booking - it will be created as 'confirmed' (reserved)
      // Check-in should be done explicitly through the check-in button
      await HotelAPIService.createBooking({
        guest_id: guestIdToUse,
        room_id: String(room.id),
        check_in_date: checkInDateTime,
        check_out_date: checkOutDateTime,
        post_type: postType,
        rate_code: rateCode,
        booking_remarks: remarks || undefined,
        is_tourist: isTourist,
        tourism_tax_amount: tourismTax,
        extra_bed_count: extraBedCount,
        extra_bed_charge: extraBedCharge,

        payment_status: 'unpaid',
        amount_paid: 0,
        deposit_paid: false,
        deposit_amount: 0,
        room_rate_override: useCustomRate && customRate > 0 ? customRate : undefined,
        daily_rates: useCustomRate && Object.keys(dailyRates).length > 0 ? dailyRates : undefined,
      });

      // Note: Booking is created with status 'confirmed' which shows room as 'reserved'
      // Guest must explicitly check-in to change status to 'checked_in' (occupied)

      onBookingSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to create booking');
    } finally {
      setLoading(false);
    }
  };

  const calculateNights = () => {
    if (!checkInDate || !checkOutDate) return 0;
    const checkIn = new Date(checkInDate);
    const checkOut = new Date(checkOutDate);
    return Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24));
  };

  // Generate array of date strings between check-in and check-out
  const getStayDates = (): string[] => {
    if (!checkInDate || !checkOutDate) return [];
    const dates: string[] = [];
    const start = new Date(checkInDate);
    const end = new Date(checkOutDate);
    const current = new Date(start);
    while (current < end) {
      dates.push(current.toISOString().split('T')[0]);
      current.setDate(current.getDate() + 1);
    }
    return dates;
  };

  // Initialize daily rates when custom rate is toggled on or dates change
  const initializeDailyRates = (baseRate: number) => {
    const dates = getStayDates();
    const newRates: Record<string, number> = {};
    dates.forEach(date => {
      newRates[date] = dailyRates[date] ?? baseRate;
    });
    setDailyRates(newRates);
  };

  const calculateRoomTotal = () => {
    if (!room) return 0;
    const nights = calculateNights();
    if (useCustomRate && Object.keys(dailyRates).length > 0) {
      return Object.values(dailyRates).reduce((sum, rate) => sum + rate, 0);
    }
    if (useCustomRate && customRate > 0) {
      return customRate * nights;
    }
    const price = typeof room.price_per_night === 'string'
      ? parseFloat(room.price_per_night)
      : room.price_per_night;
    return price * nights;
  };

  const calculateTotal = () => {
    const roomTotal = calculateRoomTotal();
    return roomTotal + tourismTax + extraBedCharge;
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box display="flex" alignItems="center">
          <BookIcon sx={{ mr: 1, color: 'primary.main' }} />
          <Typography variant="h6">
            Quick Booking - Room {room?.room_number}
          </Typography>
        </Box>
        <Typography variant="caption" color="text.secondary">
          {room?.room_type} • {formatCurrency(typeof room?.price_per_night === 'string'
            ? parseFloat(room.price_per_night)
            : room?.price_per_night || 0)}/night
        </Typography>
      </DialogTitle>

      <DialogContent dividers>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {error && (
            <Alert severity="error" onClose={() => setError(null)}>
              {error}
            </Alert>
          )}
          {roomIsAvailable === false && (
            <Alert severity="warning">
              Room {room?.room_number} is not available for these dates. It has an overlapping booking. Please choose different dates.
            </Alert>
          )}
          {checkingAvailability && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <CircularProgress size={16} />
              <Typography variant="body2" color="text.secondary">Checking room availability...</Typography>
            </Box>
          )}

          {/* Guest Selection - Only show in admin mode */}
          {!guestMode && (
            <Box>
              <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 600 }}>
                Guest Selection
              </Typography>
              <Autocomplete
              options={guests}
              getOptionLabel={(option) => `${option.full_name} (${option.email})`}
              loading={guestsLoading}
              value={selectedGuest}
              onChange={(_, newValue) => {
                setSelectedGuest(newValue);
                setShowNewGuestForm(false);
              }}
              onInputChange={(_, value) => handleGuestInputChange(value)}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Search Guest"
                  placeholder="Type guest name or email..."
                  InputProps={{
                    ...params.InputProps,
                    endAdornment: (
                      <>
                        {guestsLoading ? <CircularProgress color="inherit" size={20} /> : null}
                        {params.InputProps.endAdornment}
                      </>
                    ),
                  }}
                />
              )}
              renderOption={(props, option) => {
                const { key, ...otherProps } = props;
                return (
                  <li key={key} {...otherProps}>
                    <Box>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {option.full_name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {option.email} {option.phone && `• ${option.phone}`}
                      </Typography>
                    </Box>
                  </li>
                );
              }}
              disabled={showNewGuestForm}
            />

            {!selectedGuest && !showNewGuestForm && (
              <Button
                startIcon={<PersonAddIcon />}
                onClick={() => setShowNewGuestForm(true)}
                sx={{ mt: 1 }}
                variant="outlined"
                size="small"
              >
                Register New Guest
              </Button>
            )}
          </Box>
          )}

          {/* Guest Mode Info */}
          {guestMode && (
            <Alert severity="info">
              Booking for: <strong>{user?.full_name || user?.username}</strong>
            </Alert>
          )}

          {/* New Guest Form */}
          {!guestMode && showNewGuestForm && (
            <Paper elevation={0} sx={{ p: 2, bgcolor: 'grey.50', borderRadius: 2 }}>
              <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                  New Guest Registration
                </Typography>
                <Button size="small" onClick={() => {
                  setShowNewGuestForm(false);
                  setNewGuestFirstName('');
                  setNewGuestLastName('');
                  setNewGuestEmail('');
                  setNewGuestPhone('');
                }}>
                  Cancel
                </Button>
              </Box>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    label="First Name"
                    value={newGuestFirstName}
                    onChange={(e) => setNewGuestFirstName(e.target.value)}
                    required
                    size="small"
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    label="Last Name"
                    value={newGuestLastName}
                    onChange={(e) => setNewGuestLastName(e.target.value)}
                    size="small"
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    label="Email (Optional)"
                    type="email"
                    value={newGuestEmail}
                    onChange={(e) => {
                      setNewGuestEmail(e.target.value);
                      setEmailError('');
                    }}
                    onBlur={() => {
                      if (newGuestEmail && newGuestEmail.trim()) {
                        setEmailError(validateEmail(newGuestEmail));
                      } else {
                        setEmailError('');
                      }
                    }}
                    error={!!emailError}
                    helperText={emailError}
                    size="small"
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    label="Phone (Optional)"
                    value={newGuestPhone}
                    onChange={(e) => {
                      setNewGuestPhone(e.target.value);
                      setPhoneError('');
                    }}
                    onBlur={() => setPhoneError('')}
                    error={!!phoneError}
                    helperText={phoneError}
                    size="small"
                  />
                </Grid>
              </Grid>
            </Paper>
          )}

          <Divider />

          {/* Booking Details */}
          <Box>
            <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 600 }}>
              Booking Details
            </Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <ModernDatePicker
                  label="Check-in Date"
                  value={checkInDate}
                  onChange={setCheckInDate}
                  required
                  margin="none"
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Check-in Time"
                  type="time"
                  value={checkInTime}
                  onChange={(e) => setCheckInTime(e.target.value)}
                  InputLabelProps={{ shrink: true }}
                  required
                  helperText={`Default: ${new Date(`2000-01-01T${defaultCheckInTime}`).toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true
                  })}`}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <ModernDatePicker
                  label="Check-out Date"
                  value={checkOutDate}
                  onChange={setCheckOutDate}
                  required
                  margin="none"
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Check-out Time"
                  type="time"
                  value={checkOutTime}
                  onChange={(e) => setCheckOutTime(e.target.value)}
                  InputLabelProps={{ shrink: true }}
                  required
                  helperText={`Default: ${new Date(`2000-01-01T${defaultCheckOutTime}`).toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true
                  })}`}
                />
              </Grid>
              <Grid item xs={12}>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={useCustomRate}
                      onChange={(e) => {
                        setUseCustomRate(e.target.checked);
                        if (e.target.checked && room) {
                          const price = typeof room.price_per_night === 'string'
                            ? parseFloat(room.price_per_night)
                            : room.price_per_night;
                          setCustomRate(price);
                          initializeDailyRates(price);
                        } else {
                          setDailyRates({});
                        }
                      }}
                      color="primary"
                    />
                  }
                  label={
                    <Box>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        Custom Daily Rates
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Override the rate for each day of the stay
                      </Typography>
                    </Box>
                  }
                />
              </Grid>
              {useCustomRate && getStayDates().length > 0 && (
                <Grid item xs={12}>
                  <Paper elevation={0} sx={{ p: 2, bgcolor: 'grey.50', borderRadius: 2 }}>
                    <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                        Rate per Day
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Default: {formatCurrency(typeof room?.price_per_night === 'string' ? parseFloat(room.price_per_night) : room?.price_per_night || 0)}/night
                      </Typography>
                    </Box>
                    <Grid container spacing={1}>
                      {getStayDates().map((date) => {
                        const dayName = new Date(date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' });
                        const displayDate = new Date(date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                        return (
                          <Grid item xs={6} sm={4} md={3} key={date}>
                            <TextField
                              fullWidth
                              size="small"
                              label={`${dayName}, ${displayDate}`}
                              type="number"
                              value={dailyRates[date] ?? customRate}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value) || 0;
                                setDailyRates(prev => ({ ...prev, [date]: val }));
                              }}
                              InputProps={{
                                startAdornment: <Typography sx={{ mr: 0.5, fontSize: '0.8rem' }}>{currencySymbol}</Typography>,
                              }}
                              inputProps={{ min: 0, step: 0.01 }}
                            />
                          </Grid>
                        );
                      })}
                    </Grid>
                  </Paper>
                </Grid>
              )}
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Booking Remarks (Visible on Dashboard)"
                  multiline
                  rows={3}
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Add any special notes or requests for this booking..."
                  helperText="These remarks will be visible on the booking dashboard"
                />
              </Grid>
            </Grid>
          </Box>

          {/* Additional Charges */}
          <Box>
            <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 600 }}>
              Additional Charges
            </Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
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
                  sx={{ mt: 1 }}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Tourism Tax (Auto-calculated)"
                  type="number"
                  value={tourismTax}
                  InputProps={{
                    startAdornment: <Typography sx={{ mr: 0.5 }}>{currencySymbol}</Typography>,
                    readOnly: true
                  }}
                  disabled={!isTourist}
                  helperText={isTourist ? `${calculateNights()} night(s) × ${formatCurrency(getHotelSettings().tourism_tax_rate)}/night` : 'Check "Guest is a Tourist" to apply'}
                />
              </Grid>
              {allowsExtraBed && maxExtraBeds > 0 && (
                <>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      label="Number of Extra Beds"
                      type="number"
                      value={extraBedCount}
                      onChange={(e) => {
                        const count = Math.min(Math.max(parseInt(e.target.value) || 0, 0), maxExtraBeds);
                        setExtraBedCount(count);
                        setExtraBedCharge(count * extraBedChargePerBed);
                      }}
                      inputProps={{ min: 0, max: maxExtraBeds }}
                      helperText={`${formatCurrency(extraBedChargePerBed)} per extra bed (max ${maxExtraBeds})`}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      label="Extra Bed Charge"
                      type="number"
                      value={extraBedCharge}
                      onChange={(e) => setExtraBedCharge(parseFloat(e.target.value) || 0)}
                      InputProps={{ startAdornment: <Typography sx={{ mr: 0.5 }}>{currencySymbol}</Typography> }}
                      helperText="Auto-calculated or manually adjust"
                    />
                  </Grid>
                </>
              )}
            </Grid>
          </Box>

          {/* Booking Summary */}
          {checkInDate && checkOutDate && (
            <Paper elevation={0} sx={{ p: 2, bgcolor: 'primary.50', borderRadius: 2 }}>
              <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 600 }}>
                Booking Summary
              </Typography>
              <Grid container spacing={1}>
                <Grid item xs={6}>
                  <Typography variant="body2" color="text.secondary">
                    Room:
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {room?.room_number} - {room?.room_type}
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="text.secondary">
                    Duration:
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {calculateNights()} night(s)
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="text.secondary">
                    Room Rate{useCustomRate ? ' (Custom)' : ''}:
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {formatCurrency(calculateRoomTotal())}
                    {useCustomRate && Object.keys(dailyRates).length > 0 && (
                      <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                        (per-day rates)
                      </Typography>
                    )}
                  </Typography>
                </Grid>
                {tourismTax > 0 && (
                  <>
                    <Grid item xs={6}>
                      <Typography variant="body2" color="text.secondary">
                        Tourism Tax:
                      </Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="body2">
                        {formatCurrency(tourismTax)}
                      </Typography>
                    </Grid>
                  </>
                )}
                {extraBedCharge > 0 && (
                  <>
                    <Grid item xs={6}>
                      <Typography variant="body2" color="text.secondary">
                        Extra Bed:
                      </Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="body2">
                        {formatCurrency(extraBedCharge)}
                      </Typography>
                    </Grid>
                  </>
                )}
                <Grid item xs={12}>
                  <Divider sx={{ my: 1 }} />
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body1" sx={{ fontWeight: 700 }}>
                    Grand Total:
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="h6" color="primary" sx={{ fontWeight: 700 }}>
                    {formatCurrency(calculateTotal())}
                  </Typography>
                </Grid>
              </Grid>
            </Paper>
          )}
        </Box>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button
          onClick={handleConfirmBooking}
          variant="contained"
          disabled={
            loading ||
            (!guestMode && !selectedGuest && !showNewGuestForm) ||
            (guestMode && !currentUserId) ||
            !checkInDate ||
            !checkOutDate ||
            !checkInTime ||
            !checkOutTime ||
            roomIsAvailable === false ||
            checkingAvailability
          }
          startIcon={loading ? <CircularProgress size={20} /> : <BookIcon />}
        >
          {loading ? 'Creating Booking...' : 'Confirm Booking'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default QuickBookingModal;

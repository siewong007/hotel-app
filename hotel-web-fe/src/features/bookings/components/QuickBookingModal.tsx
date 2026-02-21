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
  const [paymentMethod, setPaymentMethod] = useState('Cash');
  const [paymentStatus, setPaymentStatus] = useState<'unpaid' | 'unpaid_deposit' | 'paid'>('unpaid');
  const [amountPaid, setAmountPaid] = useState(0);
  const [roomCardDeposit, setRoomCardDeposit] = useState(50);
  const [isTourist, setIsTourist] = useState(false);
  const [tourismTax, setTourismTax] = useState(0);
  const [extraBedCount, setExtraBedCount] = useState(0);
  const [extraBedCharge, setExtraBedCharge] = useState(0);
  const [lateCheckoutPenalty, setLateCheckoutPenalty] = useState(0);

  // Custom rate override state
  const [useCustomRate, setUseCustomRate] = useState(false);
  const [customRate, setCustomRate] = useState<number>(0);

  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track previous open state to detect true open/close transitions
  const wasOpenRef = useRef(false);

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

      // Load hotel settings for default values
      const settings = getHotelSettings();
      setRoomCardDeposit(settings.room_card_deposit);

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
    setPaymentMethod('Cash');
    setPaymentStatus('unpaid');
    setAmountPaid(0);
    setIsTourist(false);
    setTourismTax(0);
    setExtraBedCount(0);
    setExtraBedCharge(0);
    setLateCheckoutPenalty(0);
    setUseCustomRate(false);
    setCustomRate(0);
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
    if (!newGuestFirstName || !newGuestEmail) {
      setError('First name and email are required for new guest');
      return null;
    }

    // Validate email
    const emailValidation = validateEmail(newGuestEmail);
    if (emailValidation) {
      setEmailError(emailValidation);
      setError(emailValidation);
      return null;
    }

    try {
      const newGuest = await HotelAPIService.createGuest({
        first_name: newGuestFirstName,
        last_name: newGuestLastName,
        email: newGuestEmail,
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
        room_card_deposit: roomCardDeposit,
        late_checkout_penalty: lateCheckoutPenalty,
        payment_method: paymentMethod,
        payment_status: paymentStatus,
        amount_paid: amountPaid,
        deposit_paid: paymentStatus !== 'unpaid',
        deposit_amount: paymentStatus === 'unpaid' ? 0 : amountPaid,
        room_rate_override: useCustomRate && customRate > 0 ? customRate : undefined,
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

  const calculateRoomTotal = () => {
    if (!room) return 0;
    const nights = calculateNights();
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
    return roomTotal + roomCardDeposit + tourismTax + extraBedCharge + lateCheckoutPenalty;
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
                    label="Email"
                    type="email"
                    value={newGuestEmail}
                    onChange={(e) => {
                      setNewGuestEmail(e.target.value);
                      setEmailError('');
                    }}
                    onBlur={() => setEmailError(validateEmail(newGuestEmail))}
                    error={!!emailError}
                    helperText={emailError}
                    required
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
                  minDate={new Date().toISOString().split('T')[0]}
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
                  minDate={checkInDate || new Date().toISOString().split('T')[0]}
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
              <Grid item xs={12} sm={6}>
                <TextField
                  select
                  fullWidth
                  label="Post Type"
                  value={postType}
                  onChange={(e) => setPostType(e.target.value as 'normal_stay' | 'same_day')}
                  SelectProps={{ native: true }}
                >
                  <option value="normal_stay">Normal Stay</option>
                  <option value="same_day">Same Day</option>
                </TextField>
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  select
                  fullWidth
                  label="Rate Code"
                  value={rateCode}
                  onChange={(e) => setRateCode(e.target.value)}
                  SelectProps={{ native: true }}
                >
                  <option value="RACK">RACK (Standard Rate)</option>
                  <option value="OVR">OVR (Override Rate)</option>
                </TextField>
              </Grid>
              <Grid item xs={12} sm={6}>
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
                        }
                      }}
                      color="primary"
                    />
                  }
                  label={
                    <Box>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        Use Custom Rate
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Override the default room rate
                      </Typography>
                    </Box>
                  }
                />
              </Grid>
              {useCustomRate && (
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    label="Custom Rate per Night"
                    type="number"
                    value={customRate}
                    onChange={(e) => setCustomRate(parseFloat(e.target.value) || 0)}
                    InputProps={{ startAdornment: <Typography sx={{ mr: 0.5 }}>{currencySymbol}</Typography> }}
                    helperText={`Original rate: ${formatCurrency(typeof room?.price_per_night === 'string' ? parseFloat(room.price_per_night) : room?.price_per_night || 0)}/night`}
                  />
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

          {/* Payment Method & Additional Charges */}
          <Box>
            <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 600 }}>
              Payment & Additional Charges
            </Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <TextField
                  select
                  fullWidth
                  label="Payment Method"
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  SelectProps={{ native: true }}
                  required
                >
                  {paymentMethods.map((method) => (
                    <option key={method} value={method}>
                      {method}
                    </option>
                  ))}
                </TextField>
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Room Card Deposit"
                  type="number"
                  value={roomCardDeposit}
                  onChange={(e) => setRoomCardDeposit(parseFloat(e.target.value) || 0)}
                  InputProps={{ startAdornment: <Typography sx={{ mr: 0.5 }}>{currencySymbol}</Typography> }}
                  helperText="Refundable deposit for room card"
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  select
                  fullWidth
                  label="Payment Status"
                  value={paymentStatus}
                  onChange={(e) => setPaymentStatus(e.target.value as 'unpaid' | 'unpaid_deposit' | 'paid')}
                  SelectProps={{ native: true }}
                  required
                >
                  <option value="unpaid">Unpaid</option>
                  <option value="unpaid_deposit">Deposit Paid</option>
                  <option value="paid">Fully Paid</option>
                </TextField>
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Amount Paid"
                  type="number"
                  value={amountPaid}
                  onChange={(e) => setAmountPaid(parseFloat(e.target.value) || 0)}
                  InputProps={{ startAdornment: <Typography sx={{ mr: 0.5 }}>{currencySymbol}</Typography> }}
                  disabled={paymentStatus === 'unpaid'}
                  helperText={paymentStatus === 'unpaid' ? 'Set payment status to enter amount' : 'Enter amount received from guest'}
                />
              </Grid>
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
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Late Checkout Penalty (If applicable)"
                  type="number"
                  value={lateCheckoutPenalty}
                  onChange={(e) => setLateCheckoutPenalty(parseFloat(e.target.value) || 0)}
                  InputProps={{ startAdornment: <Typography sx={{ mr: 0.5 }}>{currencySymbol}</Typography> }}
                  helperText="Applied if guest checks out after the designated time"
                />
              </Grid>
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
                    {useCustomRate && (
                      <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                        ({formatCurrency(useCustomRate ? customRate : 0)}/night)
                      </Typography>
                    )}
                  </Typography>
                </Grid>
                {roomCardDeposit > 0 && (
                  <>
                    <Grid item xs={6}>
                      <Typography variant="body2" color="text.secondary">
                        Room Card Deposit:
                      </Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="body2">
                        {formatCurrency(roomCardDeposit)}
                      </Typography>
                    </Grid>
                  </>
                )}
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
                {lateCheckoutPenalty > 0 && (
                  <>
                    <Grid item xs={6}>
                      <Typography variant="body2" color="text.secondary">
                        Late Checkout Penalty:
                      </Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="body2">
                        {formatCurrency(lateCheckoutPenalty)}
                      </Typography>
                    </Grid>
                  </>
                )}
                <Grid item xs={12}>
                  <Divider sx={{ my: 1 }} />
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="text.secondary">
                    Payment Method:
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {paymentMethod}
                  </Typography>
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
            !checkOutTime
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

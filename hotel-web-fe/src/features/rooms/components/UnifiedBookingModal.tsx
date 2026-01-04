import React, { useState, useEffect } from 'react';
import {
  Box,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Stepper,
  Step,
  StepLabel,
  Grid,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Paper,
  Card,
  CardContent,
  CardActionArea,
  CircularProgress,
  Divider,
  Alert,
  Chip,
} from '@mui/material';
import {
  PersonAdd as PersonAddIcon,
  EventAvailable as BookingIcon,
  CardGiftcard as GiftIcon,
  Hotel as HotelIcon,
  ArrowBack as ArrowBackIcon,
  ArrowForward as ArrowForwardIcon,
  Check as CheckIcon,
} from '@mui/icons-material';
import { Room, Guest, Booking } from '../../../types';
import { HotelAPIService } from '../../../api';
import { useCurrency } from '../../../hooks/useCurrency';
import { getHotelSettings } from '../../../utils/hotelSettings';
import { isValidEmail } from '../../../utils/validation';
import GuestSelector, { NewGuestForm, GuestWithCredits, emptyNewGuestForm } from './GuestSelector';

export type BookingType = 'direct' | 'walk_in' | 'online' | 'complimentary';
export type BookingMode = 'direct' | 'reservation';

interface UnifiedBookingModalProps {
  open: boolean;
  onClose: () => void;
  room: Room | null;
  guests: Guest[];
  initialBookingType?: BookingType;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
  onBookingCreated?: (booking: Booking, guest: Guest) => void; // For direct booking to open enhanced check-in
  onRefreshData: () => Promise<void>;
}

// Main booking mode options (Step 1)
const BOOKING_MODE_CONFIG = {
  direct: {
    label: 'Direct Booking',
    description: 'Check in guest immediately',
    icon: PersonAddIcon,
    color: '#2196f3',
  },
  reservation: {
    label: 'Booking Reservation',
    description: 'Create reservation for future check-in',
    icon: BookingIcon,
    color: '#4caf50',
  },
};

// Reservation type options (Step 2 when reservation is selected)
const RESERVATION_TYPE_CONFIG = {
  walk_in: {
    label: 'Walk-in',
    description: 'Guest booking in person or by phone',
    icon: PersonAddIcon,
    color: '#2196f3',
  },
  online: {
    label: 'Online',
    description: 'OTA or website booking',
    icon: BookingIcon,
    color: '#4caf50',
  },
  complimentary: {
    label: 'Complimentary',
    description: 'Use guest free room credits',
    icon: GiftIcon,
    color: '#9c27b0',
  },
};

const UnifiedBookingModal: React.FC<UnifiedBookingModalProps> = ({
  open,
  onClose,
  room,
  guests,
  initialBookingType,
  onSuccess,
  onError,
  onBookingCreated,
  onRefreshData,
}) => {
  const { format: formatCurrency, symbol: currencySymbol } = useCurrency();
  const BOOKING_CHANNELS = getHotelSettings().booking_channels;
  const roomCardDepositDefault = getHotelSettings().room_card_deposit;

  // Stepper state
  const [activeStep, setActiveStep] = useState(0);
  const [bookingMode, setBookingMode] = useState<BookingMode | null>(null);
  const [reservationType, setReservationType] = useState<'walk_in' | 'online' | 'complimentary' | null>(null);

  // Guest state
  const [selectedGuest, setSelectedGuest] = useState<Guest | null>(null);
  const [newGuestForm, setNewGuestForm] = useState<NewGuestForm>(emptyNewGuestForm);
  const [isCreatingNewGuest, setIsCreatingNewGuest] = useState(false);
  const [guestsWithCredits, setGuestsWithCredits] = useState<GuestWithCredits[]>([]);
  const [selectedGuestWithCredits, setSelectedGuestWithCredits] = useState<GuestWithCredits | null>(null);
  const [loadingGuestsWithCredits, setLoadingGuestsWithCredits] = useState(false);

  // Booking details state
  const [checkInDate, setCheckInDate] = useState('');
  const [checkOutDate, setCheckOutDate] = useState('');
  const [numberOfNights, setNumberOfNights] = useState(1);
  const [bookingChannel, setBookingChannel] = useState('');
  const [bookingReference, setBookingReference] = useState('');

  // Payment state (for walk-in)
  const [deposit, setDeposit] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [roomCardDeposit, setRoomCardDeposit] = useState(roomCardDepositDefault);

  // Processing state
  const [processing, setProcessing] = useState(false);

  // Reset form when modal opens/closes
  useEffect(() => {
    if (open) {
      // Set defaults
      const today = new Date().toISOString().split('T')[0];
      const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
      setCheckInDate(today);
      setCheckOutDate(tomorrow);
      setNumberOfNights(1);
      setActiveStep(0);
      setBookingMode(null);
      setReservationType(null);
    } else {
      // Reset all state when closing
      setActiveStep(0);
      setBookingMode(null);
      setReservationType(null);
      setSelectedGuest(null);
      setNewGuestForm(emptyNewGuestForm);
      setIsCreatingNewGuest(false);
      setSelectedGuestWithCredits(null);
      setCheckInDate('');
      setCheckOutDate('');
      setNumberOfNights(1);
      setBookingChannel('');
      setBookingReference('');
      setDeposit(0);
      setPaymentMethod('cash');
      setRoomCardDeposit(roomCardDepositDefault);
    }
  }, [open, roomCardDepositDefault]);

  // Load guests with credits when complimentary reservation is selected
  useEffect(() => {
    if (reservationType === 'complimentary' && open) {
      loadGuestsWithCredits();
    }
  }, [reservationType, open]);

  const loadGuestsWithCredits = async () => {
    setLoadingGuestsWithCredits(true);
    try {
      const response = await HotelAPIService.getMyGuestsWithCredits();
      // Filter to only show guests who have any credits
      const filteredGuests = response.filter(
        g => g.legacy_complimentary_nights_credit > 0 || g.total_complimentary_credits > 0
      );
      setGuestsWithCredits(filteredGuests);
    } catch (error) {
      console.error('Failed to load guests with credits:', error);
    } finally {
      setLoadingGuestsWithCredits(false);
    }
  };

  // Calculate nights when dates change
  const handleDateChange = (field: 'checkIn' | 'checkOut', value: string) => {
    if (field === 'checkIn') {
      setCheckInDate(value);
      if (checkOutDate) {
        const nights = Math.max(1, Math.ceil((new Date(checkOutDate).getTime() - new Date(value).getTime()) / (1000 * 60 * 60 * 24)));
        setNumberOfNights(nights);
      }
    } else {
      setCheckOutDate(value);
      if (checkInDate) {
        const nights = Math.max(1, Math.ceil((new Date(value).getTime() - new Date(checkInDate).getTime()) / (1000 * 60 * 60 * 24)));
        setNumberOfNights(nights);
      }
    }
  };

  // Handle member selection - reset room card deposit
  const handleMemberSelected = (isMember: boolean) => {
    if (isMember) {
      setRoomCardDeposit(0);
    } else {
      setRoomCardDeposit(roomCardDepositDefault);
    }
  };

  // Get steps based on booking mode
  const getSteps = (): string[] => {
    if (bookingMode === 'direct') {
      return ['Mode', 'Guest', 'Dates & Payment', 'Confirm'];
    } else if (bookingMode === 'reservation') {
      return ['Mode', 'Type', 'Guest', 'Details', 'Confirm'];
    }
    return ['Mode', 'Guest', 'Details', 'Confirm'];
  };

  // Validation for each step
  const isStepValid = (): boolean => {
    switch (activeStep) {
      case 0: // Mode selection
        return !!bookingMode;

      case 1: // Type selection (reservation) or Guest (direct)
        if (bookingMode === 'reservation') {
          return !!reservationType;
        }
        // Direct booking - this is guest step
        if (isCreatingNewGuest) {
          return !!(newGuestForm.first_name && newGuestForm.last_name);
        }
        return !!selectedGuest;

      case 2: // Guest (reservation) or Details (direct)
        if (bookingMode === 'reservation') {
          if (reservationType === 'complimentary') {
            return !!selectedGuestWithCredits;
          }
          if (isCreatingNewGuest) {
            return !!(newGuestForm.first_name && newGuestForm.last_name);
          }
          return !!selectedGuest;
        }
        // Direct booking - this is details step
        if (!checkInDate || !checkOutDate) return false;
        if (new Date(checkOutDate) <= new Date(checkInDate)) return false;
        return true;

      case 3: // Details (reservation) or Confirm (direct)
        if (bookingMode === 'reservation') {
          if (!checkInDate || !checkOutDate) return false;
          if (new Date(checkOutDate) <= new Date(checkInDate)) return false;
          if (reservationType === 'online' && !bookingChannel) return false;
          return true;
        }
        // Direct booking - this is confirm step
        return true;

      case 4: // Confirm (reservation only)
        return true;

      default:
        return false;
    }
  };

  // Handle next step
  const handleNext = () => {
    setActiveStep((prev) => prev + 1);
  };

  // Handle back step
  const handleBack = () => {
    setActiveStep((prev) => prev - 1);
  };

  // Handle mode selection (Step 0)
  const handleModeSelect = (mode: BookingMode) => {
    setBookingMode(mode);
    // Reset dependent state
    setReservationType(null);
    setSelectedGuest(null);
    setSelectedGuestWithCredits(null);
    setIsCreatingNewGuest(false);
    setNewGuestForm(emptyNewGuestForm);
  };

  // Handle reservation type selection (Step 1 for reservation mode)
  const handleReservationTypeSelect = (type: 'walk_in' | 'online' | 'complimentary') => {
    setReservationType(type);
    // Reset guest state when changing type
    setSelectedGuest(null);
    setSelectedGuestWithCredits(null);
    setIsCreatingNewGuest(false);
    setNewGuestForm(emptyNewGuestForm);
  };

  // Get effective booking type for submission (combines mode + reservation type)
  const getEffectiveBookingType = (): 'walk_in' | 'online' | 'complimentary' | null => {
    if (bookingMode === 'direct') {
      return 'walk_in'; // Direct booking uses walk_in flow but checks in immediately
    }
    return reservationType;
  };

  // Submit booking
  const handleSubmit = async () => {
    if (!room) {
      onError('No room selected');
      return;
    }

    const effectiveType = getEffectiveBookingType();
    if (!effectiveType) {
      onError('Please select a booking type');
      return;
    }

    setProcessing(true);

    try {
      let guestToUse: Guest | null = null;

      // Create new guest if needed (for walk-in and online)
      if (effectiveType !== 'complimentary') {
        if (isCreatingNewGuest) {
          if (!newGuestForm.first_name || !newGuestForm.last_name) {
            onError('Please fill in required guest fields');
            setProcessing(false);
            return;
          }

          if (newGuestForm.email && newGuestForm.email.trim() && !isValidEmail(newGuestForm.email)) {
            onError('Please enter a valid email address');
            setProcessing(false);
            return;
          }

          // Check for duplicate email
          if (newGuestForm.email && newGuestForm.email.trim()) {
            const existingGuest = guests.find(g => g.email && g.email.toLowerCase() === newGuestForm.email.toLowerCase());
            if (existingGuest) {
              onError(`A guest with email ${newGuestForm.email} already exists`);
              setProcessing(false);
              return;
            }
          }

          const newGuest = await HotelAPIService.createGuest({
            first_name: newGuestForm.first_name,
            last_name: newGuestForm.last_name,
            email: newGuestForm.email || undefined,
            phone: newGuestForm.phone,
            ic_number: newGuestForm.ic_number,
            nationality: newGuestForm.nationality,
          });

          guestToUse = newGuest;
        } else {
          guestToUse = selectedGuest;
        }

        if (!guestToUse) {
          onError('Please select a guest');
          setProcessing(false);
          return;
        }
      }

      // Create booking based on type
      switch (effectiveType) {
        case 'walk_in': {
          const isMember = guestToUse!.guest_type === 'member';
          const effectiveRoomCardDeposit = isMember ? 0 : roomCardDeposit;
          const isDirectBooking = bookingMode === 'direct';

          const bookingData = {
            guest_id: guestToUse!.id,
            room_id: String(room.id),
            check_in_date: checkInDate,
            check_out_date: checkOutDate,
            number_of_guests: 1,
            post_type: 'normal_stay' as const,
            booking_remarks: isMember ? 'Walk-In Guest (Member - Card Deposit Waived)' : 'Walk-In Guest',
            source: 'walk_in' as const,
            room_card_deposit: effectiveRoomCardDeposit,
            payment_method: paymentMethod,
            amount_paid: deposit,
          };

          const createdBooking = await HotelAPIService.createBooking(bookingData);

          if (isDirectBooking) {
            // Direct booking: open enhanced check-in modal
            const bookingForModal: Booking = {
              id: createdBooking.id,
              guest_id: guestToUse!.id.toString(),
              room_id: room.id,
              room_type: room.room_type,
              check_in_date: createdBooking.check_in_date,
              check_out_date: createdBooking.check_out_date,
              total_amount: createdBooking.total_amount,
              status: createdBooking.status,
              folio_number: createdBooking.folio_number || `WALKIN-${createdBooking.id}`,
              market_code: 'Walk-In',
              rate_code: 'RACK',
              payment_method: paymentMethod === 'cash' ? 'Cash' : paymentMethod === 'card' ? 'Card' : paymentMethod === 'bank_transfer' ? 'Bank Transfer' : 'E-Wallet',
              post_type: createdBooking.post_type,
              created_at: createdBooking.created_at,
              updated_at: createdBooking.updated_at,
            };

            onClose();
            if (onBookingCreated) {
              onBookingCreated(bookingForModal, guestToUse!);
            }
          } else {
            // Reservation mode: just create reservation
            await HotelAPIService.updateRoomStatus(room.id, {
              status: 'reserved',
              notes: `Walk-in reservation for ${guestToUse!.full_name}`,
            });
            onSuccess(`Reservation created for ${guestToUse!.full_name} in Room ${room.room_number}`);
            onClose();
            await onRefreshData();
          }
          break;
        }

        case 'online': {
          const bookingData = {
            guest_id: guestToUse!.id,
            room_id: String(room.id),
            check_in_date: checkInDate,
            check_out_date: checkOutDate,
            number_of_guests: 1,
            post_type: 'normal_stay' as const,
            source: 'online' as const,
            booking_remarks: bookingReference
              ? `${bookingChannel} - Ref: ${bookingReference}`
              : `${bookingChannel} Booking`,
          };

          await HotelAPIService.createBooking(bookingData);

          await HotelAPIService.updateRoomStatus(room.id, {
            status: 'reserved',
            notes: `Reserved via ${bookingChannel}${bookingReference ? ` - Ref: ${bookingReference}` : ''}`,
          });

          onSuccess(`Reservation created for ${guestToUse!.full_name} in Room ${room.room_number}`);
          onClose();
          await onRefreshData();
          break;
        }

        case 'complimentary': {
          if (!selectedGuestWithCredits) {
            onError('Please select a guest with free room credits');
            setProcessing(false);
            return;
          }

          // Generate complimentary dates
          const complimentaryDates: string[] = [];
          const start = new Date(checkInDate);
          const end = new Date(checkOutDate);
          for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
            complimentaryDates.push(d.toISOString().split('T')[0]);
          }

          const bookingResult = await HotelAPIService.bookWithCredits({
            guest_id: selectedGuestWithCredits.id,
            room_id: typeof room.id === 'string' ? parseInt(room.id) : room.id,
            check_in_date: checkInDate,
            check_out_date: checkOutDate,
            complimentary_dates: complimentaryDates,
          });

          await HotelAPIService.updateRoomStatus(room.id, {
            status: 'reserved',
            notes: `Complimentary reservation - ${bookingResult.complimentary_nights} nights used`,
          });

          onSuccess(`Complimentary reservation created for ${selectedGuestWithCredits.full_name} in Room ${room.room_number} (${bookingResult.complimentary_nights} nights used)`);
          onClose();
          await onRefreshData();
          break;
        }
      }
    } catch (error: any) {
      onError(error.message || 'Failed to create booking');
    } finally {
      setProcessing(false);
    }
  };

  // Calculate total amount
  const calculateTotal = () => {
    const price = room?.price_per_night || 0;
    const numPrice = typeof price === 'string' ? parseFloat(price) : price;
    return numPrice * numberOfNights;
  };

  // Get current step index based on booking mode
  const getGuestStepIndex = () => {
    if (bookingMode === 'direct') return 1;
    if (bookingMode === 'reservation') return 2;
    return 1;
  };

  const getDetailsStepIndex = () => {
    if (bookingMode === 'direct') return 2;
    if (bookingMode === 'reservation') return 3;
    return 2;
  };

  const getConfirmStepIndex = () => {
    if (bookingMode === 'direct') return 3;
    if (bookingMode === 'reservation') return 4;
    return 3;
  };

  // Render step content
  const renderStepContent = () => {
    const effectiveType = getEffectiveBookingType();

    // Step 0: Mode selection (Direct Booking / Booking Reservation)
    if (activeStep === 0) {
      return (
        <Box>
          <Typography variant="subtitle1" gutterBottom sx={{ mb: 2, fontWeight: 600 }}>
            How would you like to proceed?
          </Typography>
          <Grid container spacing={2}>
            {(Object.keys(BOOKING_MODE_CONFIG) as BookingMode[]).map((mode) => {
              const config = BOOKING_MODE_CONFIG[mode];
              const Icon = config.icon;
              return (
                <Grid item xs={12} sm={6} key={mode}>
                  <Card
                    sx={{
                      border: bookingMode === mode ? 2 : 1,
                      borderColor: bookingMode === mode ? config.color : 'divider',
                      transition: 'all 0.2s',
                      '&:hover': {
                        borderColor: config.color,
                        transform: 'translateY(-2px)',
                      },
                    }}
                  >
                    <CardActionArea onClick={() => handleModeSelect(mode)}>
                      <CardContent sx={{ textAlign: 'center', py: 3 }}>
                        <Box
                          sx={{
                            width: 56,
                            height: 56,
                            borderRadius: '50%',
                            bgcolor: bookingMode === mode ? config.color : 'grey.100',
                            color: bookingMode === mode ? 'white' : config.color,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            mx: 'auto',
                            mb: 1.5,
                            transition: 'all 0.2s',
                          }}
                        >
                          <Icon sx={{ fontSize: 28 }} />
                        </Box>
                        <Typography variant="subtitle1" fontWeight={600}>
                          {config.label}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {config.description}
                        </Typography>
                      </CardContent>
                    </CardActionArea>
                  </Card>
                </Grid>
              );
            })}
          </Grid>
        </Box>
      );
    }

    // Step 1 (for reservation mode): Type selection
    if (activeStep === 1 && bookingMode === 'reservation') {
      return (
        <Box>
          <Typography variant="subtitle1" gutterBottom sx={{ mb: 2, fontWeight: 600 }}>
            Select Reservation Type
          </Typography>
          <Grid container spacing={2}>
            {(Object.keys(RESERVATION_TYPE_CONFIG) as ('walk_in' | 'online' | 'complimentary')[]).map((type) => {
              const config = RESERVATION_TYPE_CONFIG[type];
              const Icon = config.icon;
              return (
                <Grid item xs={12} sm={4} key={type}>
                  <Card
                    sx={{
                      border: reservationType === type ? 2 : 1,
                      borderColor: reservationType === type ? config.color : 'divider',
                      transition: 'all 0.2s',
                      '&:hover': {
                        borderColor: config.color,
                        transform: 'translateY(-2px)',
                      },
                    }}
                  >
                    <CardActionArea onClick={() => handleReservationTypeSelect(type)}>
                      <CardContent sx={{ textAlign: 'center', py: 3 }}>
                        <Box
                          sx={{
                            width: 56,
                            height: 56,
                            borderRadius: '50%',
                            bgcolor: reservationType === type ? config.color : 'grey.100',
                            color: reservationType === type ? 'white' : config.color,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            mx: 'auto',
                            mb: 1.5,
                            transition: 'all 0.2s',
                          }}
                        >
                          <Icon sx={{ fontSize: 28 }} />
                        </Box>
                        <Typography variant="subtitle1" fontWeight={600}>
                          {config.label}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {config.description}
                        </Typography>
                      </CardContent>
                    </CardActionArea>
                  </Card>
                </Grid>
              );
            })}
          </Grid>
        </Box>
      );
    }

    // Guest step
    if (activeStep === getGuestStepIndex()) {
      return (
        <Box>
          <Typography variant="subtitle1" gutterBottom sx={{ mb: 2, fontWeight: 600 }}>
            {effectiveType === 'complimentary' ? 'Select Guest with Credits' : 'Guest Information'}
          </Typography>
          <GuestSelector
            selectedGuest={selectedGuest}
            onGuestSelect={setSelectedGuest}
            guests={guests}
            newGuestForm={newGuestForm}
            onNewGuestFormChange={setNewGuestForm}
            isCreatingNew={isCreatingNewGuest}
            onToggleMode={setIsCreatingNewGuest}
            filterByCredits={effectiveType === 'complimentary'}
            guestsWithCredits={guestsWithCredits}
            selectedGuestWithCredits={selectedGuestWithCredits}
            onGuestWithCreditsSelect={setSelectedGuestWithCredits}
            loadingGuestsWithCredits={loadingGuestsWithCredits}
            onMemberSelected={handleMemberSelected}
          />
        </Box>
      );
    }

    // Details step
    if (activeStep === getDetailsStepIndex()) {
      const isWalkIn = effectiveType === 'walk_in';
      const isOnline = effectiveType === 'online';
      const showPayment = isWalkIn && bookingMode === 'direct';

      return (
        <Box>
          <Typography variant="subtitle1" gutterBottom sx={{ mb: 2, fontWeight: 600 }}>
            {showPayment ? 'Dates & Payment' : isOnline ? 'Booking Details' : 'Select Dates'}
          </Typography>

          <Grid container spacing={2}>
            {/* Dates */}
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                required
                type="date"
                label="Check-in Date"
                value={checkInDate}
                onChange={(e) => handleDateChange('checkIn', e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                required
                type="date"
                label="Check-out Date"
                value={checkOutDate}
                onChange={(e) => handleDateChange('checkOut', e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>

            {/* Online booking specific fields */}
            {isOnline && (
              <>
                <Grid item xs={12} md={6}>
                  <FormControl fullWidth required>
                    <InputLabel>Booking Channel</InputLabel>
                    <Select
                      value={bookingChannel}
                      onChange={(e) => setBookingChannel(e.target.value)}
                      label="Booking Channel"
                    >
                      {BOOKING_CHANNELS.map((channel) => (
                        <MenuItem key={channel} value={channel}>
                          {channel}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    label="Booking Reference"
                    value={bookingReference}
                    onChange={(e) => setBookingReference(e.target.value)}
                    placeholder="e.g., OL-123456"
                  />
                </Grid>
              </>
            )}

            {/* Walk-in payment fields (only for direct booking) */}
            {showPayment && (
              <>
                <Grid item xs={12}>
                  <Divider sx={{ my: 1 }} />
                  <Typography variant="subtitle2" gutterBottom sx={{ mt: 1 }}>
                    Payment Details
                  </Typography>
                </Grid>
                <Grid item xs={12} md={6}>
                  <FormControl fullWidth>
                    <InputLabel>Payment Method</InputLabel>
                    <Select
                      value={paymentMethod}
                      onChange={(e) => setPaymentMethod(e.target.value)}
                      label="Payment Method"
                    >
                      <MenuItem value="cash">Cash</MenuItem>
                      <MenuItem value="card">Credit/Debit Card</MenuItem>
                      <MenuItem value="bank_transfer">Bank Transfer</MenuItem>
                      <MenuItem value="e_wallet">E-Wallet</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    type="number"
                    label="Deposit Amount"
                    value={deposit}
                    onChange={(e) => setDeposit(parseFloat(e.target.value) || 0)}
                    InputProps={{
                      startAdornment: <Typography sx={{ mr: 0.5 }}>{currencySymbol}</Typography>,
                    }}
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    type="number"
                    label="Room Card Deposit"
                    value={roomCardDeposit}
                    onChange={(e) => setRoomCardDeposit(parseFloat(e.target.value) || 0)}
                    disabled={selectedGuest?.guest_type === 'member'}
                    InputProps={{
                      startAdornment: <Typography sx={{ mr: 0.5 }}>{currencySymbol}</Typography>,
                    }}
                    helperText={selectedGuest?.guest_type === 'member' ? 'Waived for members' : ''}
                  />
                </Grid>
              </>
            )}
          </Grid>
        </Box>
      );
    }

    // Confirm step
    const getModeLabel = () => {
      if (bookingMode === 'direct') return 'Direct Booking';
      if (reservationType === 'walk_in') return 'Walk-in Reservation';
      if (reservationType === 'online') return 'Online Reservation';
      if (reservationType === 'complimentary') return 'Complimentary Reservation';
      return 'Reservation';
    };

    const getModeColor = () => {
      if (bookingMode === 'direct') return BOOKING_MODE_CONFIG.direct.color;
      if (reservationType) return RESERVATION_TYPE_CONFIG[reservationType].color;
      return '#1976d2';
    };

    return (
      <Box>
        <Typography variant="subtitle1" gutterBottom sx={{ mb: 2, fontWeight: 600 }}>
          Review & Confirm
        </Typography>

        <Paper sx={{ p: 2, bgcolor: 'grey.50' }}>
          <Grid container spacing={2}>
            {/* Booking Type */}
            <Grid item xs={12}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <Chip
                  label={getModeLabel()}
                  sx={{
                    bgcolor: getModeColor(),
                    color: 'white',
                    fontWeight: 600,
                  }}
                />
              </Box>
            </Grid>

            <Grid item xs={12}>
              <Divider />
            </Grid>

            {/* Room Info */}
            <Grid item xs={6}>
              <Typography variant="body2" color="text.secondary">Room</Typography>
            </Grid>
            <Grid item xs={6}>
              <Typography variant="body2" fontWeight={600}>
                {room?.room_number} ({room?.room_type})
              </Typography>
            </Grid>

            {/* Guest Info */}
            <Grid item xs={6}>
              <Typography variant="body2" color="text.secondary">Guest</Typography>
            </Grid>
            <Grid item xs={6}>
              <Typography variant="body2" fontWeight={600}>
                {effectiveType === 'complimentary'
                  ? selectedGuestWithCredits?.full_name
                  : isCreatingNewGuest
                    ? `${newGuestForm.first_name} ${newGuestForm.last_name} (New)`
                    : selectedGuest?.full_name}
              </Typography>
            </Grid>

            {/* Dates */}
            <Grid item xs={6}>
              <Typography variant="body2" color="text.secondary">Check-in</Typography>
            </Grid>
            <Grid item xs={6}>
              <Typography variant="body2">{checkInDate}</Typography>
            </Grid>
            <Grid item xs={6}>
              <Typography variant="body2" color="text.secondary">Check-out</Typography>
            </Grid>
            <Grid item xs={6}>
              <Typography variant="body2">{checkOutDate}</Typography>
            </Grid>
            <Grid item xs={6}>
              <Typography variant="body2" color="text.secondary">Nights</Typography>
            </Grid>
            <Grid item xs={6}>
              <Typography variant="body2">{numberOfNights}</Typography>
            </Grid>

            {/* Online booking info */}
            {effectiveType === 'online' && bookingChannel && (
              <>
                <Grid item xs={6}>
                  <Typography variant="body2" color="text.secondary">Channel</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2">{bookingChannel}</Typography>
                </Grid>
                {bookingReference && (
                  <>
                    <Grid item xs={6}>
                      <Typography variant="body2" color="text.secondary">Reference</Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="body2">{bookingReference}</Typography>
                    </Grid>
                  </>
                )}
              </>
            )}

            <Grid item xs={12}>
              <Divider />
            </Grid>

            {/* Pricing */}
            <Grid item xs={6}>
              <Typography variant="body2" color="text.secondary">Rate</Typography>
            </Grid>
            <Grid item xs={6}>
              <Typography variant="body2">
                {effectiveType === 'complimentary' ? (
                  <Box component="span" sx={{ textDecoration: 'line-through', color: 'text.disabled' }}>
                    {currencySymbol}{room?.price_per_night}/night
                  </Box>
                ) : (
                  `${currencySymbol}${room?.price_per_night}/night`
                )}
              </Typography>
            </Grid>
            <Grid item xs={6}>
              <Typography variant="body2" fontWeight={600}>Total</Typography>
            </Grid>
            <Grid item xs={6}>
              <Typography variant="body2" fontWeight={600} color={effectiveType === 'complimentary' ? 'success.main' : 'text.primary'}>
                {effectiveType === 'complimentary' ? 'FREE (Complimentary)' : `${currencySymbol}${calculateTotal().toFixed(2)}`}
              </Typography>
            </Grid>

            {/* Walk-in payment summary (only for direct booking) */}
            {effectiveType === 'walk_in' && bookingMode === 'direct' && (
              <>
                <Grid item xs={6}>
                  <Typography variant="body2" color="text.secondary">Deposit</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="success.main">
                    {currencySymbol}{deposit.toFixed(2)}
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="text.secondary">Room Card Deposit</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2">
                    {roomCardDeposit > 0 ? `${currencySymbol}${roomCardDeposit.toFixed(2)}` : 'Waived'}
                  </Typography>
                </Grid>
              </>
            )}

            {/* Credits info for complimentary */}
            {effectiveType === 'complimentary' && selectedGuestWithCredits && (
              <>
                <Grid item xs={12}>
                  <Divider />
                </Grid>
                <Grid item xs={12}>
                  <Alert severity="info" sx={{ mt: 1 }}>
                    <Typography variant="body2">
                      Using {numberOfNights} night(s) from guest's free room credits
                    </Typography>
                  </Alert>
                </Grid>
              </>
            )}
          </Grid>
        </Paper>
      </Box>
    );
  };

  const steps = getSteps();
  // Last step is always steps.length - 1 (0-indexed)
  const isLastStep = activeStep === steps.length - 1;
  const canProceed = isStepValid();
  const effectiveType = getEffectiveBookingType();

  // Get header color based on booking mode
  const getHeaderColor = () => {
    if (bookingMode === 'direct') return BOOKING_MODE_CONFIG.direct.color;
    if (reservationType) return RESERVATION_TYPE_CONFIG[reservationType].color;
    return '#1976d2';
  };

  // Get submit button text
  const getSubmitButtonText = () => {
    if (processing) return 'Processing...';
    if (bookingMode === 'direct') return 'Check In Now';
    return 'Create Reservation';
  };

  return (
    <Dialog
      open={open}
      onClose={() => !processing && onClose()}
      maxWidth="md"
      fullWidth
    >
      <DialogTitle
        sx={{
          bgcolor: getHeaderColor(),
          color: 'white',
          py: 2,
          px: 3,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <HotelIcon sx={{ fontSize: 28 }} />
          <Typography variant="h6" component="span" sx={{ fontWeight: 600 }}>
            New Booking - Room {room?.room_number || 'N/A'}
          </Typography>
        </Box>
      </DialogTitle>

      <Box sx={{ px: 3, pt: 2 }}>
        <Stepper activeStep={activeStep} alternativeLabel>
          {steps.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>
      </Box>

      <DialogContent sx={{ pt: 3, minHeight: 300 }}>
        {renderStepContent()}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2, bgcolor: 'grey.50', borderTop: 1, borderColor: 'divider' }}>
        <Button onClick={onClose} disabled={processing}>
          Cancel
        </Button>
        <Box sx={{ flex: 1 }} />
        {activeStep > 0 && (
          <Button
            onClick={handleBack}
            disabled={processing}
            startIcon={<ArrowBackIcon />}
          >
            Back
          </Button>
        )}
        {!isLastStep ? (
          <Button
            variant="contained"
            onClick={handleNext}
            disabled={!canProceed}
            endIcon={<ArrowForwardIcon />}
          >
            Next
          </Button>
        ) : (
          <Button
            variant="contained"
            onClick={handleSubmit}
            disabled={processing || !canProceed}
            startIcon={processing ? <CircularProgress size={20} /> : <CheckIcon />}
            color={effectiveType === 'complimentary' ? 'secondary' : 'primary'}
          >
            {getSubmitButtonText()}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default UnifiedBookingModal;

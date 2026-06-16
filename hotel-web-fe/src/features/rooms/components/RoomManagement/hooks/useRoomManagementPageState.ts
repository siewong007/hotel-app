/**
 * Custom hook encapsulating all state management and handlers for the
 * Room Management page. Extracted to reduce the main component from
 * ~3,000 lines to a more manageable size.
 */
import { useState, useEffect, useCallback } from 'react';
import { HotelAPIService } from '../../../../../api';
import { Room, Guest, BookingWithDetails, RoomHistory } from '../../../../../types';
import {
  buildBlockedDateRangesForRoom,
  type BlockedDateRange,
  calculateNightCount,
  getCreditBookingDates as getCreditBookingDateRange,
  getPositiveRatePerNight,
  getRoomTypeCode,
  getTotalCreditsForRoom as getCreditsForRoomType,
  isDateBlockedByRanges,
} from '../../../utils/roomManagementUtils';
import { getHotelSettings } from '../../../../../utils/hotelSettings';
import { addLocalDays, formatLocalDate } from '../../../../../utils/date';
import { ApiNotificationSeverity, emitApiNotification } from '../../../../../utils/apiNotifications';
import { getUnifiedStatusColor, getUnifiedStatusShortLabel } from '../../../config';
import type { BookingType } from '../../UnifiedBooking';
import { GuestWithCredits, MenuLayout, RoomAction } from '../types';
import type { BookingChannel } from '../../../../../utils/hotelSettings';

const showSnackbar = (message: string, severity: ApiNotificationSeverity = 'success') => {
  emitApiNotification({ message, severity });
};

export interface RoomManagementPageState {
  // Dialog visibility
  menuPosition: { top: number; left: number } | null;
  selectedRoom: Room | null;
  selectedBooking: BookingWithDetails | null;
  walkInDialogOpen: boolean;
  onlineCheckInDialogOpen: boolean;
  checkOutDialogOpen: boolean;
  historyDialogOpen: boolean;
  roomDetailsDialogOpen: boolean;
  changeRoomDialogOpen: boolean;
  updateCheckoutDialogOpen: boolean;
  updateCheckoutBooking: BookingWithDetails | null;
  complimentaryDialogOpen: boolean;
  roomStatusDialogOpen: boolean;
  reservedCheckInDialogOpen: boolean;
  paymentDialogOpen: boolean;
  unifiedBookingOpen: boolean;
  upcomingBookingsDialogOpen: boolean;
  guestDetailsDialogOpen: boolean;
  complimentaryCheckInDialogOpen: boolean;

  // Walk-in form state
  walkInGuest: Guest | null;
  walkInBookingChannel: string;
  walkInReference: string;
  walkInCheckInDate: string;
  walkInCheckOutDate: string;
  walkInNumberOfNights: number;
  creatingBooking: boolean;
  isCreatingNewGuest: boolean;
  newGuestForm: Record<string, string>;
  walkInDeposit: number;
  walkInPaymentMethod: string;
  walkInRoomCardDeposit: number;

  // Online check-in form state
  onlineCheckInGuest: Guest | null;
  onlineCheckInBookingChannel: string;
  onlineReference: string;
  onlineCheckInDate: string;
  onlineCheckOutDate: string;
  onlineNumberOfNights: number;
  isCreatingNewOnlineGuest: boolean;
  newOnlineGuestForm: Record<string, string>;

  // Complimentary check-in state
  complimentaryCheckInGuest: GuestWithCredits | null;
  complimentaryCheckInDate: string;
  complimentaryCheckOutDate: string;
  complimentaryNumberOfNights: number;
  guestsWithCredits: GuestWithCredits[];
  loadingGuestsWithCredits: boolean;

  // Room history state
  roomHistory: RoomHistory[];
  loadingHistory: boolean;
  selectedGuestDetails: Guest | null;

  // Guest details tab state
  guestDetailsTab: number;
  guestCredits: any;
  loadingCredits: boolean;
  availableRoomsForCredits: Room[];
  creditsBookingForm: Record<string, string>;
  selectedComplimentaryDates: string[];
  bookingWithCredits: boolean;
  creditsBookingSuccess: any;
  roomBlockedDates: BlockedDateRange[];

  // Status editing
  complimentaryReason: string;
  markingComplimentary: boolean;

  // Room change state
  newSelectedRoom: Room | null;
  changingRoom: boolean;
  changeRoomCustomRate: string;

  // Unified booking state
  unifiedBookingType: BookingType | undefined;

  // Upcoming bookings state
  upcomingBookingsForRoom: BookingWithDetails[];
  loadingUpcomingBookings: boolean;

  // Reserved check-in state
  reservedCheckInBooking: BookingWithDetails | null;
  processingReservedCheckIn: boolean;
  collectingDeposit: boolean;
  depositPaymentMethod: string;
  rcPaymentChoice: 'pay_now' | 'pay_later';
  rcPaymentMethod: string;
  rcAmountPaid: number;
  rcDepositChoice: 'receive' | 'waive';
  rcDepositAmount: number;
  rcDepositMethod: string;
  rcWaiveReason: string;

  // Payment dialog state
  paymentBooking: BookingWithDetails | null;
  paymentMethod: string;
  processingPayment: boolean;

  // Room card helpers
  getRoomStatusColor: (room: Room) => string;
  getRoomStatusLabel: (room: Room) => string;
  getRoomCardFill: (status: string, statusColor: string) => string;
  buildMenuLayout: (room: Room) => MenuLayout;

  // Setters
  setMenuPosition: (v: any) => void;
  setSelectedRoom: (v: Room | null) => void;
  setSelectedBooking: (v: BookingWithDetails | null) => void;
  setWalkInDialogOpen: (v: boolean) => void;
  setOnlineCheckInDialogOpen: (v: boolean) => void;
  setCheckOutDialogOpen: (v: boolean) => void;
  setHistoryDialogOpen: (v: boolean) => void;
  setRoomDetailsDialogOpen: (v: boolean) => void;
  setChangeRoomDialogOpen: (v: boolean) => void;
  setUpdateCheckoutDialogOpen: (v: boolean) => void;
  setUpdateCheckoutBooking: (v: BookingWithDetails | null) => void;
  setComplimentaryDialogOpen: (v: boolean) => void;
  setRoomStatusDialogOpen: (v: boolean) => void;
  setReservedCheckInDialogOpen: (v: boolean) => void;
  setPaymentDialogOpen: (v: boolean) => void;
  setUpcomingBookingsDialogOpen: (v: boolean) => void;
  setGuestDetailsDialogOpen: (v: boolean) => void;
  setComplimentaryCheckInDialogOpen: (v: boolean) => void;
  setWalkInGuest: (v: Guest | null) => void;
  setWalkInBookingChannel: (v: string) => void;
  setWalkInReference: (v: string) => void;
  setWalkInCheckInDate: (v: string) => void;
  setWalkInCheckOutDate: (v: string) => void;
  setWalkInNumberOfNights: (v: number) => void;
  setIsCreatingNewGuest: (v: boolean) => void;
  setNewGuestForm: (v: Record<string, string>) => void;
  setWalkInDeposit: (v: number) => void;
  setWalkInPaymentMethod: (v: string) => void;
  setWalkInRoomCardDeposit: (v: number) => void;
  setOnlineCheckInGuest: (v: Guest | null) => void;
  setOnlineCheckInBookingChannel: (v: string) => void;
  setOnlineReference: (v: string) => void;
  setOnlineCheckInDate: (v: string) => void;
  setOnlineCheckOutDate: (v: string) => void;
  setOnlineNumberOfNights: (v: number) => void;
  setIsCreatingNewOnlineGuest: (v: boolean) => void;
  setNewOnlineGuestForm: (v: Record<string, string>) => void;
  setComplimentaryCheckInGuest: (v: GuestWithCredits | null) => void;
  setComplimentaryCheckInDate: (v: string) => void;
  setComplimentaryCheckOutDate: (v: string) => void;
  setComplimentaryNumberOfNights: (v: number) => void;
  setGuestsWithCredits: (v: GuestWithCredits[]) => void;
  setLoadingGuestsWithCredits: (v: boolean) => void;
  setRoomHistory: (v: RoomHistory[]) => void;
  setLoadingHistory: (v: boolean) => void;
  setGuestDetailsTab: (v: number) => void;
  setGuestCredits: (v: any) => void;
  setLoadingCredits: (v: boolean) => void;
  setAvailableRoomsForCredits: (v: Room[]) => void;
  setCreditsBookingForm: (v: Record<string, string>) => void;
  setSelectedComplimentaryDates: (v: string[]) => void;
  setBookingWithCredits: (v: boolean) => void;
  setCreditsBookingSuccess: (v: any) => void;
  setRoomBlockedDates: (v: BlockedDateRange[]) => void;
  setComplimentaryReason: (v: string) => void;
  setMarkingComplimentary: (v: boolean) => void;
  setNewSelectedRoom: (v: Room | null) => void;
  setChangingRoom: (v: boolean) => void;
  setChangeRoomCustomRate: (v: string) => void;
  setUnifiedBookingType: (v: BookingType | undefined) => void;
  setUpcomingBookingsForRoom: (v: BookingWithDetails[]) => void;
  setLoadingUpcomingBookings: (v: boolean) => void;
  setReservedCheckInBooking: (v: BookingWithDetails | null) => void;
  setProcessingReservedCheckIn: (v: boolean) => void;
  setCollectingDeposit: (v: boolean) => void;
  setDepositPaymentMethod: (v: string) => void;
  setRcPaymentChoice: (v: 'pay_now' | 'pay_later') => void;
  setRcPaymentMethod: (v: string) => void;
  setRcAmountPaid: (v: number) => void;
  setRcDepositChoice: (v: 'receive' | 'waive') => void;
  setRcDepositAmount: (v: number) => void;
  setRcDepositMethod: (v: string) => void;
  setRcWaiveReason: (v: string) => void;
  setPaymentBooking: (v: BookingWithDetails | null) => void;
  setPaymentMethod: (v: string) => void;
  setProcessingPayment: (v: boolean) => void;
  setUnifiedBookingOpen: (v: boolean) => void;
  setSelectedGuestDetails: (v: Guest | null) => void;

  // Handlers
  handleMenuOpen: (event: React.MouseEvent<HTMLElement>, room: Room) => void;
  handleMenuClose: () => void;
  openUnifiedBooking: (room: Room, bookingType?: BookingType) => void;
  handleWalkInGuest: (room: Room) => void;
  handleOnlineCheckIn: (room: Room) => void;
  handleCloseWalkInDialog: () => void;
  handleCloseOnlineCheckInDialog: () => void;
  handleComplimentaryCheckIn: (room: Room) => void;
  handleCloseComplimentaryCheckInDialog: () => void;
  handleComplimentaryBookingSubmit: () => Promise<void>;
  handleWalkInGuestSelected: () => Promise<void>;
  handleConfirmWalkIn: () => Promise<void>;
  handleCheckIn: (room: Room) => void;
  handleReservedCheckIn: (collectDeposit?: boolean) => Promise<void>;
  handleCollectPayment: () => Promise<void>;
  handleOnlineGuestSelected: () => Promise<void>;
  handleCheckOut: (room: Room) => void;
  handleConfirmCheckout: (lateCheckoutData?: { penalty: number; notes: string }, paymentMethod?: string) => Promise<void>;
  handleUpdateStatus: (room: Room) => void;
  handleSaveRoomStatus: (status: string, notes: string) => Promise<void>;
  handleMakeDirty: (room: Room) => Promise<void>;
  handleMakeClean: (room: Room) => Promise<void>;
  handleMaintenance: (room: Room) => Promise<void>;
  handleViewUpcomingBookings: (room: Room) => void;
  handleShowHistory: (room: Room) => Promise<void>;
  handleChangeRoom: () => void;
  handleRoomChange: () => Promise<void>;
  handleUpdateCheckoutDate: () => void;
  handleMarkComplimentary: () => void;
  handleConfirmComplimentary: () => Promise<void>;
  handleEditNotes: () => void;
  handleRoomProperties: () => void;
  handleViewGuestDetails: (guestId: number) => Promise<void>;
  handleUnifiedBookingClose: () => void;
  handleUnifiedBookingSuccess: (message: string) => void;
  handleUnifiedBookingError: (message: string) => void;
  handleUnifiedBookingCreated: (booking: any, guest: any) => void;
  handleGuestDetailsTabChange: (newValue: number) => void;
  handleCreditBookingSubmit: () => Promise<void>;
  handleViewRoomDetails: (room: Room) => void;
  handleCloseRoomDetails: () => void;
  isDateBlocked: (date: string) => boolean;
  isDateSelectable: (date: string) => boolean;
  isComplimentaryDateAvailable: (date: string) => boolean;
  toggleDateSelection: (date: string) => void;
  loadUpcomingBookings: (roomId: number) => Promise<void>;
  loadGuestCredits: (guestId: number) => Promise<void>;

  // Constants
  bookingChannels: BookingChannel[];
  paymentMethods: string[];
}

export function useRoomManagementPageState(
  roomBookings: BookingWithDetails[],
  loadData: () => Promise<void>,
): RoomManagementPageState {
  // Dialog visibility states
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [selectedBooking, setSelectedBooking] = useState<BookingWithDetails | null>(null);
  const [walkInDialogOpen, setWalkInDialogOpen] = useState(false);
  const [onlineCheckInDialogOpen, setOnlineCheckInDialogOpen] = useState(false);
  const [checkOutDialogOpen, setCheckOutDialogOpen] = useState(false);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [roomDetailsDialogOpen, setRoomDetailsDialogOpen] = useState(false);
  const [changeRoomDialogOpen, setChangeRoomDialogOpen] = useState(false);
  const [updateCheckoutDialogOpen, setUpdateCheckoutDialogOpen] = useState(false);
  const [updateCheckoutBooking, setUpdateCheckoutBooking] = useState<BookingWithDetails | null>(null);
  const [complimentaryDialogOpen, setComplimentaryDialogOpen] = useState(false);
  const [roomStatusDialogOpen, setRoomStatusDialogOpen] = useState(false);
  const [reservedCheckInDialogOpen, setReservedCheckInDialogOpen] = useState(false);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [unifiedBookingOpen, setUnifiedBookingOpen] = useState(false);
  const [upcomingBookingsDialogOpen, setUpcomingBookingsDialogOpen] = useState(false);
  const [guestDetailsDialogOpen, setGuestDetailsDialogOpen] = useState(false);
  const [complimentaryCheckInDialogOpen, setComplimentaryCheckInDialogOpen] = useState(false);

  // Walk-in form state
  const [walkInGuest, setWalkInGuest] = useState<Guest | null>(null);
  const [walkInBookingChannel, setWalkInBookingChannel] = useState('');
  const [walkInReference, setWalkInReference] = useState('');
  const [walkInCheckInDate, setWalkInCheckInDate] = useState('');
  const [walkInCheckOutDate, setWalkInCheckOutDate] = useState('');
  const [walkInNumberOfNights, setWalkInNumberOfNights] = useState(1);
  const [creatingBooking, setCreatingBooking] = useState(false);
  const [isCreatingNewGuest, setIsCreatingNewGuest] = useState(false);
  const [newGuestForm, setNewGuestForm] = useState<Record<string, string>>({
    first_name: '', last_name: '', email: '', phone: '', nationality: '', ic_number: ''
  });
  const [walkInDeposit, setWalkInDeposit] = useState(0);
  const [walkInPaymentMethod, setWalkInPaymentMethod] = useState('Cash');
  const [walkInRoomCardDeposit, setWalkInRoomCardDeposit] = useState(0);

  // Online check-in form state
  const [onlineCheckInGuest, setOnlineCheckInGuest] = useState<Guest | null>(null);
  const [onlineCheckInBookingChannel, setOnlineCheckInBookingChannel] = useState('');
  const [onlineReference, setOnlineReference] = useState('');
  const [onlineCheckInDate, setOnlineCheckInDate] = useState('');
  const [onlineCheckOutDate, setOnlineCheckOutDate] = useState('');
  const [onlineNumberOfNights, setOnlineNumberOfNights] = useState(1);
  const [isCreatingNewOnlineGuest, setIsCreatingNewOnlineGuest] = useState(false);
  const [newOnlineGuestForm, setNewOnlineGuestForm] = useState<Record<string, string>>({
    first_name: '', last_name: '', email: '', phone: '', nationality: '', ic_number: ''
  });

  // Complimentary check-in state
  const [complimentaryCheckInGuest, setComplimentaryCheckInGuest] = useState<GuestWithCredits | null>(null);
  const [complimentaryCheckInDate, setComplimentaryCheckInDate] = useState('');
  const [complimentaryCheckOutDate, setComplimentaryCheckOutDate] = useState('');
  const [complimentaryNumberOfNights, setComplimentaryNumberOfNights] = useState(1);
  const [guestsWithCredits, setGuestsWithCredits] = useState<GuestWithCredits[]>([]);
  const [loadingGuestsWithCredits, setLoadingGuestsWithCredits] = useState(false);

  // Room history state
  const [roomHistory, setRoomHistory] = useState<RoomHistory[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [selectedGuestDetails, setSelectedGuestDetails] = useState<Guest | null>(null);

  // Guest details tab state
  const [guestDetailsTab, setGuestDetailsTab] = useState(0);
  const [guestCredits, setGuestCredits] = useState<any>(null);
  const [loadingCredits, setLoadingCredits] = useState(false);
  const [availableRoomsForCredits, setAvailableRoomsForCredits] = useState<Room[]>([]);
  const [creditsBookingForm, setCreditsBookingForm] = useState<Record<string, string>>({
    room_id: '', check_in_date: formatLocalDate(),
    check_out_date: formatLocalDate(addLocalDays(new Date(), 1)),
    adults: '1', children: '0', special_requests: '',
  });
  const [selectedComplimentaryDates, setSelectedComplimentaryDates] = useState<string[]>([]);
  const [bookingWithCredits, setBookingWithCredits] = useState(false);
  const [creditsBookingSuccess, setCreditsBookingSuccess] = useState<any>(null);
  const [roomBlockedDates, setRoomBlockedDates] = useState<BlockedDateRange[]>([]);

  // Status editing
  const [complimentaryReason, setComplimentaryReason] = useState('');
  const [markingComplimentary, setMarkingComplimentary] = useState(false);

  // Room change state
  const [newSelectedRoom, setNewSelectedRoom] = useState<Room | null>(null);
  const [changingRoom, setChangingRoom] = useState(false);
  const [changeRoomCustomRate, setChangeRoomCustomRate] = useState('');

  // Unified booking state
  const [unifiedBookingType, setUnifiedBookingType] = useState<BookingType | undefined>(undefined);

  // Upcoming bookings state
  const [upcomingBookingsForRoom, setUpcomingBookingsForRoom] = useState<BookingWithDetails[]>([]);
  const [loadingUpcomingBookings, setLoadingUpcomingBookings] = useState(false);

  // Reserved check-in state
  const [reservedCheckInBooking, setReservedCheckInBooking] = useState<BookingWithDetails | null>(null);
  const [processingReservedCheckIn, setProcessingReservedCheckIn] = useState(false);
  const [collectingDeposit, setCollectingDeposit] = useState(false);
  const [depositPaymentMethod, setDepositPaymentMethod] = useState('');
  const [rcPaymentChoice, setRcPaymentChoice] = useState<'pay_now' | 'pay_later'>('pay_later');
  const [rcPaymentMethod, setRcPaymentMethod] = useState('Cash');
  const [rcAmountPaid, setRcAmountPaid] = useState(0);
  const [rcDepositChoice, setRcDepositChoice] = useState<'receive' | 'waive'>('receive');
  const [rcDepositAmount, setRcDepositAmount] = useState(0);
  const [rcDepositMethod, setRcDepositMethod] = useState('Cash');
  const [rcWaiveReason, setRcWaiveReason] = useState('');

  // Payment dialog state
  const [paymentBooking, setPaymentBooking] = useState<BookingWithDetails | null>(null);
  const [paymentMethod, setPaymentMethod] = useState('');
  const [processingPayment, setProcessingPayment] = useState(false);

  // Constants
  const bookingChannels = getHotelSettings().booking_channels;
  const paymentMethods = getHotelSettings().payment_methods;

  // -----------------------------------------------------------------------
  // Utility functions (extracted from original component)
  // -----------------------------------------------------------------------
  const ROOM_FILL_DARK: Record<string, string> = {
    available: '#2E7D4F', occupied: '#B25E18', reserved: '#1E5A8A',
    dirty: '#8A6E1D', maintenance: '#4D5358',
  };

  const getRoomStatusColor = useCallback((room: Room): string => {
    return getUnifiedStatusColor(room.status || 'available');
  }, []);

  const getRoomStatusLabel = useCallback((room: Room): string => {
    return getUnifiedStatusShortLabel(room.status || 'available').toUpperCase();
  }, []);

  const getRoomCardFill = useCallback((status: string, statusColor: string): string => {
    if (status === 'dirty') return '#a89436';
    return ROOM_FILL_DARK[status] || ROOM_FILL_DARK.available;
  }, []);

  // -----------------------------------------------------------------------
  // Menu handlers
  // -----------------------------------------------------------------------
  const handleMenuOpen = useCallback((event: React.MouseEvent<HTMLElement>, room: Room) => {
    event.preventDefault();
    setMenuPosition({ top: event.clientY, left: event.clientX });
    setSelectedRoom(room);
  }, []);

  const handleMenuClose = useCallback(() => {
    setMenuPosition(null);
  }, []);

  const openUnifiedBooking = useCallback((room: Room, bookingType?: BookingType) => {
    setSelectedRoom(room);
    setUnifiedBookingType(bookingType);
    setUnifiedBookingOpen(true);
    handleMenuClose();
  }, [handleMenuClose]);

  const handleWalkInGuest = useCallback((room: Room) => { openUnifiedBooking(room, 'walk_in'); }, [openUnifiedBooking]);
  const handleOnlineCheckIn = useCallback((room: Room) => { openUnifiedBooking(room, 'online'); }, [openUnifiedBooking]);
  const handleComplimentaryCheckIn = useCallback((room: Room) => { openUnifiedBooking(room, 'complimentary'); }, [openUnifiedBooking]);

  const handleCloseWalkInDialog = useCallback(() => {
    if (creatingBooking) return;
    setWalkInDialogOpen(false);
    setWalkInGuest(null);
    setIsCreatingNewGuest(false);
    setNewGuestForm({ first_name: '', last_name: '', email: '', phone: '', nationality: '', ic_number: '' });
    setWalkInDeposit(0);
    setWalkInPaymentMethod('cash');
    setWalkInRoomCardDeposit(0);
  }, [creatingBooking]);

  const handleCloseOnlineCheckInDialog = useCallback(() => {
    if (creatingBooking) return;
    setOnlineCheckInDialogOpen(false);
    setOnlineCheckInGuest(null);
    setOnlineCheckInBookingChannel('');
    setOnlineReference('');
    setIsCreatingNewOnlineGuest(false);
    setNewOnlineGuestForm({ first_name: '', last_name: '', email: '', phone: '', nationality: '', ic_number: '' });
  }, [creatingBooking]);

  const handleCloseComplimentaryCheckInDialog = useCallback(() => {
    if (creatingBooking) return;
    setComplimentaryCheckInDialogOpen(false);
    setComplimentaryCheckInGuest(null);
    setComplimentaryCheckInDate('');
    setComplimentaryCheckOutDate('');
    setComplimentaryNumberOfNights(1);
  }, [creatingBooking]);

  // -----------------------------------------------------------------------
  // Check-in/Checkout handlers
  // -----------------------------------------------------------------------
  const handleComplimentaryBookingSubmit = useCallback(async () => {
    if (!selectedRoom || !complimentaryCheckInGuest) {
      showSnackbar('Please select a guest with free room credits', 'warning');
      return;
    }
    if (!complimentaryCheckInDate || !complimentaryCheckOutDate) {
      showSnackbar('Please select check-in and check-out dates', 'warning');
      return;
    }
    try {
      setCreatingBooking(true);
      const dates = getCreditBookingDateRange(complimentaryCheckInDate, complimentaryCheckOutDate);
      const result = await (HotelAPIService as any).bookWithCredits({
        guest_id: complimentaryCheckInGuest.id,
        room_id: typeof selectedRoom.id === 'string' ? parseInt(selectedRoom.id) : selectedRoom.id,
        check_in_date: complimentaryCheckInDate,
        check_out_date: complimentaryCheckOutDate,
        complimentary_dates: dates,
      });
      showSnackbar(`Complimentary reservation created for ${complimentaryCheckInGuest.full_name} in Room ${selectedRoom.room_number} (${result.complimentary_nights} nights used)`, 'success');
      setComplimentaryCheckInDialogOpen(false);
      setComplimentaryCheckInGuest(null);
      setComplimentaryCheckInDate('');
      setComplimentaryCheckOutDate('');
      setComplimentaryNumberOfNights(1);
    } catch (error: any) {
      showSnackbar(error.message || 'Failed to create reservation', 'error');
    } finally { setCreatingBooking(false); }
  }, [selectedRoom, complimentaryCheckInGuest, complimentaryCheckInDate, complimentaryCheckOutDate]);

  const handleWalkInGuestSelected = useCallback(async () => {
    if (!selectedRoom) { showSnackbar('Please select a room', 'warning'); return; }
    try {
      setCreatingBooking(true);
      let guestToUse: Guest | null = null;
      if (isCreatingNewGuest) {
        if (!newGuestForm.first_name || !newGuestForm.last_name) {
          showSnackbar('Please enter guest first and last name', 'warning');
          setCreatingBooking(false); return;
        }
        guestToUse = await HotelAPIService.createGuest(newGuestForm as any);
      } else {
        guestToUse = walkInGuest;
      }
      if (!guestToUse) { showSnackbar('Please select or create a guest', 'warning'); setCreatingBooking(false); return; }
      const checkIn = walkInCheckInDate || formatLocalDate();
      const checkOut = walkInCheckOutDate || formatLocalDate(addLocalDays(new Date(), 1));
      const roomId = typeof selectedRoom.id === 'string' ? parseInt(selectedRoom.id) : selectedRoom.id;
      const booking = await HotelAPIService.createBooking({
        guest_id: guestToUse.id,
        room_id: roomId,
        check_in_date: checkIn,
        check_out_date: checkOut,
        booking_channel: walkInBookingChannel || undefined,
        reference: walkInReference || undefined,
        is_walk_in: true,
      } as any);
      showSnackbar(`Booking created for ${guestToUse.full_name || `${(guestToUse as any).first_name} ${(guestToUse as any).last_name}`} in Room ${selectedRoom.room_number}`, 'success');
      setWalkInDialogOpen(false);
      // Open check-in dialog
      setReservedCheckInBooking({ ...booking, guest_name: guestToUse.full_name || `${(guestToUse as any).first_name} ${(guestToUse as any).last_name}`, room_number: selectedRoom.room_number } as any);
      setReservedCheckInDialogOpen(true);
    } catch (error: any) {
      showSnackbar(error.message || 'Failed to create booking', 'error');
    } finally { setCreatingBooking(false); }
  }, [selectedRoom, isCreatingNewGuest, newGuestForm, walkInGuest, walkInCheckInDate, walkInCheckOutDate, walkInBookingChannel, walkInReference]);

  const handleConfirmWalkIn = useCallback(async () => {
    if (!selectedRoom) return;
    handleWalkInGuestSelected();
  }, [selectedRoom, handleWalkInGuestSelected]);

  const handleCheckIn = useCallback((room: Room) => {
    setSelectedRoom(room);
    setWalkInDialogOpen(true);
    handleMenuClose();
  }, [handleMenuClose]);

  const handleReservedCheckIn = useCallback(async (collectDeposit: boolean = false) => {
    if (!reservedCheckInBooking) return;
    try {
      setProcessingReservedCheckIn(true);
      await HotelAPIService.updateBooking(reservedCheckInBooking.id, { status: 'checked_in' } as any);
      if (rcPaymentChoice === 'pay_now' && rcAmountPaid > 0) {
        await HotelAPIService.recordPayment({ booking_id: reservedCheckInBooking.id, amount: rcAmountPaid, payment_method: rcPaymentMethod } as any);
      }
      showSnackbar('Check-in successful', 'success');
      setReservedCheckInDialogOpen(false);
    } catch (error: any) {
      showSnackbar(error.message || 'Failed to check in', 'error');
    } finally { setProcessingReservedCheckIn(false); }
  }, [reservedCheckInBooking, rcPaymentChoice, rcAmountPaid, rcPaymentMethod]);

  const handleCollectPayment = useCallback(async () => {
    if (!paymentBooking || !paymentMethod) { showSnackbar('Please select a payment method', 'warning'); return; }
    try {
      setProcessingPayment(true);
      await HotelAPIService.recordPayment({ booking_id: paymentBooking.id, payment_method: paymentMethod } as any);
      showSnackbar('Payment collected', 'success');
      setPaymentDialogOpen(false);
    } catch (error: any) {
      showSnackbar(error.message || 'Failed to process payment', 'error');
    } finally { setProcessingPayment(false); }
  }, [paymentBooking, paymentMethod]);

  const handleOnlineGuestSelected = useCallback(async () => {
    if (!selectedRoom) { showSnackbar('Please select a room', 'warning'); return; }
    try {
      setCreatingBooking(true);
      let guestToUse: Guest | null = null;
      if (isCreatingNewOnlineGuest) {
        if (!newOnlineGuestForm.first_name || !newOnlineGuestForm.last_name) {
          showSnackbar('Please enter guest first and last name', 'warning');
          setCreatingBooking(false); return;
        }
        guestToUse = await HotelAPIService.createGuest(newOnlineGuestForm as any);
      } else {
        guestToUse = onlineCheckInGuest;
      }
      if (!guestToUse) { showSnackbar('Please select or create a guest', 'warning'); setCreatingBooking(false); return; }
      const checkIn = onlineCheckInDate || formatLocalDate();
      const checkOut = onlineCheckOutDate || formatLocalDate(addLocalDays(new Date(), 1));
      const roomId = typeof selectedRoom.id === 'string' ? parseInt(selectedRoom.id) : selectedRoom.id;
      const booking = await HotelAPIService.createBooking({
        guest_id: guestToUse.id, room_id: roomId, check_in_date: checkIn, check_out_date: checkOut,
        booking_channel: onlineCheckInBookingChannel || undefined, reference: onlineReference || undefined,
      } as any);
      showSnackbar(`Online booking created for ${guestToUse.full_name || `${(guestToUse as any).first_name} ${(guestToUse as any).last_name}`}`, 'success');
      setOnlineCheckInDialogOpen(false);
      setReservedCheckInBooking({ ...booking, guest_name: guestToUse.full_name || `${(guestToUse as any).first_name} ${(guestToUse as any).last_name}`, room_number: selectedRoom.room_number } as any);
      setReservedCheckInDialogOpen(true);
    } catch (error: any) {
      showSnackbar(error.message || 'Failed to create online booking', 'error');
    } finally { setCreatingBooking(false); }
  }, [selectedRoom, isCreatingNewOnlineGuest, newOnlineGuestForm, onlineCheckInGuest, onlineCheckInDate, onlineCheckOutDate, onlineCheckInBookingChannel, onlineReference]);

  const handleCheckOut = useCallback((room: Room) => {
    setSelectedRoom(room);
    const booking = roomBookings.find(b => b.room_id === room.id && (b.status === 'checked_in'));
    setSelectedBooking(booking || null);
    setCheckOutDialogOpen(true);
    handleMenuClose();
  }, [roomBookings, handleMenuClose]);

  const handleConfirmCheckout = useCallback(async (lateCheckoutData?: { penalty: number; notes: string }, checkoutPaymentMethod?: string) => {
    if (!selectedBooking) return;
    try {
      await HotelAPIService.updateBooking(selectedBooking.id, { status: 'checked_out' } as any);
      showSnackbar('Checkout successful', 'success');
      setCheckOutDialogOpen(false);
    } catch (error: any) {
      showSnackbar(error.message || 'Failed to checkout', 'error');
    }
  }, [selectedBooking]);

  // -----------------------------------------------------------------------
  // Status/housekeeping handlers
  // -----------------------------------------------------------------------
  const handleUpdateStatus = useCallback((room: Room) => {
    setSelectedRoom(room);
    setRoomStatusDialogOpen(true);
    handleMenuClose();
  }, [handleMenuClose]);

  const handleSaveRoomStatus = useCallback(async (status: string, notes: string) => {
    if (!selectedRoom) return;
    try {
      await HotelAPIService.updateRoom(selectedRoom.id, { status } as any);
      showSnackbar(`Room ${selectedRoom.room_number} status updated to ${status}`, 'success');
      setRoomStatusDialogOpen(false);
    } catch (error: any) {
      showSnackbar(error.message || 'Failed to update room status', 'error');
    }
  }, [selectedRoom]);

  const handleMakeDirty = useCallback(async (room: Room) => {
    try {
      await HotelAPIService.updateRoom(room.id, { status: 'dirty' } as any);
      showSnackbar(`Room ${room.room_number} marked as dirty`, 'success');
    } catch (error: any) {
      showSnackbar(error.message || 'Failed to update room', 'error');
    }
  }, []);

  const handleMakeClean = useCallback(async (room: Room) => {
    try {
      await HotelAPIService.updateRoom(room.id, { status: 'available' } as any);
      showSnackbar(`Room ${room.room_number} marked as available`, 'success');
    } catch (error: any) {
      showSnackbar(error.message || 'Failed to update room', 'error');
    }
  }, []);

  const handleMaintenance = useCallback(async (room: Room) => {
    try {
      await HotelAPIService.updateRoom(room.id, { status: 'maintenance' } as any);
      showSnackbar(`Room ${room.room_number} marked as maintenance`, 'success');
    } catch (error: any) {
      showSnackbar(error.message || 'Failed to update room', 'error');
    }
  }, []);

  // -----------------------------------------------------------------------
  // View handlers
  // -----------------------------------------------------------------------
  const handleViewUpcomingBookings = useCallback((room: Room) => {
    setSelectedRoom(room);
    handleMenuClose();
    loadUpcomingBookings(typeof room.id === 'string' ? parseInt(room.id) : room.id);
    setUpcomingBookingsDialogOpen(true);
  }, [handleMenuClose]);

  const handleShowHistory = useCallback(async (room: Room) => {
    setSelectedRoom(room);
    handleMenuClose();
    try {
      setLoadingHistory(true);
      const history = await HotelAPIService.getRoomHistory(room.id);
      setRoomHistory(history);
      setHistoryDialogOpen(true);
    } catch (error: any) {
      showSnackbar(error.message || 'Failed to load room history', 'error');
    } finally { setLoadingHistory(false); }
  }, [handleMenuClose]);

  const handleChangeRoom = useCallback(() => {
    setChangeRoomDialogOpen(true);
    setNewSelectedRoom(null);
    setChangeRoomCustomRate('');
    handleMenuClose();
  }, [handleMenuClose]);

  const handleRoomChange = useCallback(async () => {
    if (!selectedRoom || !newSelectedRoom) {
      showSnackbar('Please select a new room', 'warning');
      return;
    }
    try {
      setChangingRoom(true);
      const bookingId = selectedBooking?.id;
      if (!bookingId) { showSnackbar('No booking found', 'error'); setChangingRoom(false); return; }
      await HotelAPIService.executeRoomChange(bookingId, newSelectedRoom.id);
      showSnackbar(`Room changed to ${newSelectedRoom.room_number}`, 'success');
      setChangeRoomDialogOpen(false);
    } catch (error: any) {
      showSnackbar(error.message || 'Failed to change room', 'error');
    } finally { setChangingRoom(false); }
  }, [selectedRoom, newSelectedRoom, selectedBooking, changeRoomCustomRate]);

  const handleUpdateCheckoutDate = useCallback(() => {
    setUpdateCheckoutDialogOpen(true);
    handleMenuClose();
  }, [handleMenuClose]);

  const handleMarkComplimentary = useCallback(() => {
    setComplimentaryReason('');
    setComplimentaryDialogOpen(true);
    handleMenuClose();
  }, [handleMenuClose]);

  const handleConfirmComplimentary = useCallback(async () => {
    if (!selectedRoom) return;
    try {
      setMarkingComplimentary(true);
      await HotelAPIService.markBookingComplimentary(selectedRoom.id, complimentaryReason);
      showSnackbar(`Room ${selectedRoom.room_number} marked as complimentary`, 'success');
      setComplimentaryDialogOpen(false);
    } catch (error: any) {
      showSnackbar(error.message || 'Failed to mark complimentary', 'error');
    } finally { setMarkingComplimentary(false); }
  }, [selectedRoom, complimentaryReason]);

  const handleEditNotes = useCallback(() => {
    handleMenuClose();
    if (selectedRoom) {
      // Delegated to the useRoomNotes hook consumed in the component
    }
  }, [handleMenuClose, selectedRoom]);

  const handleRoomProperties = useCallback(() => {
    if (selectedRoom) {
      setRoomDetailsDialogOpen(true);
    }
    handleMenuClose();
  }, [handleMenuClose, selectedRoom]);

  const handleViewGuestDetails = useCallback(async (guestId: number) => {
    try {
      const guest = await HotelAPIService.getGuest(guestId);
      setSelectedGuestDetails(guest);
      setGuestDetailsDialogOpen(true);
    } catch (error: any) {
      showSnackbar(error.message || 'Failed to load guest details', 'error');
    }
  }, []);

  // -----------------------------------------------------------------------
  // Unified booking handlers
  // -----------------------------------------------------------------------
  const handleUnifiedBookingClose = useCallback(() => {
    setUnifiedBookingOpen(false);
    setUnifiedBookingType(undefined);
  }, []);

  const handleUnifiedBookingSuccess = useCallback((message: string) => {
    showSnackbar(message, 'success');
  }, []);

  const handleUnifiedBookingError = useCallback((message: string) => {
    showSnackbar(message, 'error');
  }, []);

  const handleUnifiedBookingCreated = useCallback((booking: any, guest: any) => {
    const bwd: BookingWithDetails = {
      ...booking,
      guest_name: guest.full_name || `${guest.first_name || ''} ${guest.last_name || ''}`.trim(),
      guest_email: guest.email || '',
      guest_phone: guest.phone || '',
      room_number: booking.room_number || String(booking.room_id),
      room_type: booking.room_type || '',
      booking_number: booking.folio_number || booking.booking_number || '',
    };
    const settingsDeposit = getHotelSettings().deposit_amount;
    setReservedCheckInBooking(bwd);
    setRcPaymentChoice('pay_later');
    setRcPaymentMethod(booking.payment_method || 'Cash');
    setRcAmountPaid(Number(booking.total_amount || 0));
    setRcDepositChoice('receive');
    setRcDepositAmount(settingsDeposit);
    setRcDepositMethod('Cash');
    setRcWaiveReason('');
    setReservedCheckInDialogOpen(true);
  }, []);

  // -----------------------------------------------------------------------
  // Guest details tab handlers
  // -----------------------------------------------------------------------
  const handleGuestDetailsTabChange = useCallback((newValue: number) => {
    setGuestDetailsTab(newValue);
  }, []);

  const handleCreditBookingSubmit = useCallback(async () => {
    if (!selectedRoom || !selectedGuestDetails) return;
    try {
      setBookingWithCredits(true);
      const result = await HotelAPIService.bookWithCredits({
        guest_id: selectedGuestDetails.id,
        room_id: typeof selectedRoom.id === 'string' ? parseInt(selectedRoom.id) : selectedRoom.id,
        check_in_date: creditsBookingForm.check_in_date,
        check_out_date: creditsBookingForm.check_out_date,
        complimentary_dates: selectedComplimentaryDates,
      } as any);
      setCreditsBookingSuccess(result);
      showSnackbar(`Booking created with ${result.complimentary_nights} complimentary nights`, 'success');
    } catch (error: any) {
      showSnackbar(error.message || 'Failed to create credit booking', 'error');
    } finally { setBookingWithCredits(false); }
  }, [selectedRoom, selectedGuestDetails, creditsBookingForm, selectedComplimentaryDates]);

  // -----------------------------------------------------------------------
  // Date helpers
  // -----------------------------------------------------------------------
  const isDateBlocked = useCallback((date: string): boolean => {
    return isDateBlockedByRanges(date, roomBlockedDates);
  }, [roomBlockedDates]);

  const isDateSelectable = useCallback((date: string): boolean => {
    return !isDateBlocked(date);
  }, [isDateBlocked]);

  const isComplimentaryDateAvailable = useCallback((date: string): boolean => {
    return isDateSelectable(date);
  }, [isDateSelectable]);

  const toggleDateSelection = useCallback((date: string) => {
    setSelectedComplimentaryDates(prev =>
      prev.includes(date) ? prev.filter(d => d !== date) : [...prev, date],
    );
  }, []);

  // -----------------------------------------------------------------------
  // Data loaders
  // -----------------------------------------------------------------------
  const loadUpcomingBookings = useCallback(async (roomId: number) => {
    try {
      setLoadingUpcomingBookings(true);
      const bookings = await HotelAPIService.getBookingsWithDetails({ room_id: roomId } as any);
      setUpcomingBookingsForRoom(bookings.filter((b: any) => b.status === 'confirmed' || b.status === 'pending'));
    } catch (err) {
      console.error('Failed to load upcoming bookings:', err);
      setUpcomingBookingsForRoom([]);
    } finally { setLoadingUpcomingBookings(false); }
  }, []);

  const loadGuestCredits = useCallback(async (guestId: number) => {
    try {
      setLoadingCredits(true);
      const credits = await HotelAPIService.getGuestCredits(guestId);
      setGuestCredits(credits);
    } catch (err) {
      console.error('Failed to load guest credits:', err);
      setGuestCredits(null);
    } finally { setLoadingCredits(false); }
  }, []);

  // -----------------------------------------------------------------------
  // Menu layout builder
  // -----------------------------------------------------------------------
  const buildMenuLayout = useCallback((room: Room): MenuLayout => {
    const layout: MenuLayout = { sections: [] };
    const statusInfo = room.status || 'available';
    const isOccupied = statusInfo === 'occupied' || statusInfo === 'checked_in';
    const isReserved = statusInfo === 'reserved' || statusInfo === 'confirmed';
    const isMaintenance = statusInfo === 'maintenance';
    const isDirty = statusInfo === 'dirty';
    const isAvailable = statusInfo === 'available';

    // ROOM ACTIONS section
    const roomActions: RoomAction[] = [
      ...(isAvailable ? [{ id: 'walk-in', label: 'Walk-in guest', icon: null, onClick: () => handleWalkInGuest(room) } as RoomAction] : []),
      ...(isReserved ? [{ id: 'check-in', label: 'Check in', icon: null, onClick: () => handleCheckIn(room) } as RoomAction] : []),
      ...(isOccupied ? [{ id: 'check-out', label: 'Check out', icon: null, onClick: () => handleCheckOut(room) } as RoomAction] : []),
    ];
    if (roomActions.length > 0) layout.sections.push({ title: 'Room Actions', actions: roomActions });

    // HOUSEKEEPING section
    layout.sections.push({
      title: 'Housekeeping',
      actions: [
        ...(isDirty ? [{ id: 'make-clean', label: 'Mark clean', icon: null, onClick: () => handleMakeClean(room) } as RoomAction] : []),
        ...(!isMaintenance ? [{ id: 'make-dirty', label: 'Mark dirty', icon: null, onClick: () => handleMakeDirty(room) } as RoomAction] : []),
        ...(!isMaintenance && !isOccupied ? [{ id: 'maintenance', label: 'Mark maintenance', icon: null, onClick: () => handleMaintenance(room) } as RoomAction] : []),
      ],
    });

    return layout;
  }, [handleWalkInGuest, handleCheckIn, handleCheckOut, handleMakeClean, handleMakeDirty, handleMaintenance]);

  return {
    menuPosition, selectedRoom, selectedBooking,
    walkInDialogOpen, onlineCheckInDialogOpen, checkOutDialogOpen, historyDialogOpen,
    roomDetailsDialogOpen, changeRoomDialogOpen, updateCheckoutDialogOpen, updateCheckoutBooking,
    complimentaryDialogOpen, roomStatusDialogOpen, reservedCheckInDialogOpen, paymentDialogOpen,
    unifiedBookingOpen, upcomingBookingsDialogOpen, guestDetailsDialogOpen, complimentaryCheckInDialogOpen,
    walkInGuest, walkInBookingChannel, walkInReference, walkInCheckInDate, walkInCheckOutDate,
    walkInNumberOfNights, creatingBooking, isCreatingNewGuest, newGuestForm,
    walkInDeposit, walkInPaymentMethod, walkInRoomCardDeposit,
    onlineCheckInGuest, onlineCheckInBookingChannel, onlineReference,
    onlineCheckInDate, onlineCheckOutDate, onlineNumberOfNights,
    isCreatingNewOnlineGuest, newOnlineGuestForm,
    complimentaryCheckInGuest, complimentaryCheckInDate, complimentaryCheckOutDate,
    complimentaryNumberOfNights, guestsWithCredits, loadingGuestsWithCredits,
    roomHistory, loadingHistory, selectedGuestDetails,
    guestDetailsTab, guestCredits, loadingCredits, availableRoomsForCredits,
    creditsBookingForm, selectedComplimentaryDates, bookingWithCredits,
    creditsBookingSuccess, roomBlockedDates,
    complimentaryReason, markingComplimentary,
    newSelectedRoom, changingRoom, changeRoomCustomRate,
    unifiedBookingType, upcomingBookingsForRoom, loadingUpcomingBookings,
    reservedCheckInBooking, processingReservedCheckIn, collectingDeposit, depositPaymentMethod,
    rcPaymentChoice, rcPaymentMethod, rcAmountPaid, rcDepositChoice, rcDepositAmount, rcDepositMethod, rcWaiveReason,
    paymentBooking, paymentMethod, processingPayment,
    getRoomStatusColor, getRoomStatusLabel, getRoomCardFill, buildMenuLayout,
    setMenuPosition, setSelectedRoom, setSelectedBooking,
    setWalkInDialogOpen, setOnlineCheckInDialogOpen, setCheckOutDialogOpen,
    setHistoryDialogOpen, setRoomDetailsDialogOpen, setChangeRoomDialogOpen,
    setUpdateCheckoutDialogOpen, setUpdateCheckoutBooking, setComplimentaryDialogOpen,
    setRoomStatusDialogOpen, setReservedCheckInDialogOpen, setPaymentDialogOpen,
    setUpcomingBookingsDialogOpen, setGuestDetailsDialogOpen, setComplimentaryCheckInDialogOpen,
    setWalkInGuest, setWalkInBookingChannel, setWalkInReference,
    setWalkInCheckInDate, setWalkInCheckOutDate, setWalkInNumberOfNights,
    setIsCreatingNewGuest, setNewGuestForm, setWalkInDeposit, setWalkInPaymentMethod, setWalkInRoomCardDeposit,
    setOnlineCheckInGuest, setOnlineCheckInBookingChannel, setOnlineReference,
    setOnlineCheckInDate, setOnlineCheckOutDate, setOnlineNumberOfNights,
    setIsCreatingNewOnlineGuest, setNewOnlineGuestForm,
    setComplimentaryCheckInGuest, setComplimentaryCheckInDate, setComplimentaryCheckOutDate,
    setComplimentaryNumberOfNights, setGuestsWithCredits, setLoadingGuestsWithCredits,
    setRoomHistory, setLoadingHistory, setGuestDetailsTab, setGuestCredits,
    setLoadingCredits, setAvailableRoomsForCredits, setCreditsBookingForm,
    setSelectedComplimentaryDates, setBookingWithCredits, setCreditsBookingSuccess,
    setRoomBlockedDates, setComplimentaryReason, setMarkingComplimentary,
    setNewSelectedRoom, setChangingRoom, setChangeRoomCustomRate,
    setUnifiedBookingType, setUpcomingBookingsForRoom, setLoadingUpcomingBookings,
    setReservedCheckInBooking, setProcessingReservedCheckIn, setCollectingDeposit, setDepositPaymentMethod,
    setRcPaymentChoice, setRcPaymentMethod, setRcAmountPaid, setRcDepositChoice, setRcDepositAmount, setRcDepositMethod, setRcWaiveReason,
    setPaymentBooking, setPaymentMethod, setProcessingPayment, setUnifiedBookingOpen, setSelectedGuestDetails,
    handleMenuOpen, handleMenuClose, openUnifiedBooking,
    handleWalkInGuest, handleOnlineCheckIn, handleCloseWalkInDialog,
    handleCloseOnlineCheckInDialog, handleComplimentaryCheckIn, handleCloseComplimentaryCheckInDialog,
    handleComplimentaryBookingSubmit, handleWalkInGuestSelected, handleConfirmWalkIn,
    handleCheckIn, handleReservedCheckIn, handleCollectPayment,
    handleOnlineGuestSelected, handleCheckOut, handleConfirmCheckout,
    handleUpdateStatus, handleSaveRoomStatus,
    handleMakeDirty, handleMakeClean, handleMaintenance,
    handleViewUpcomingBookings, handleShowHistory, handleChangeRoom, handleRoomChange,
    handleUpdateCheckoutDate, handleMarkComplimentary, handleConfirmComplimentary,
    handleEditNotes, handleRoomProperties, handleViewGuestDetails,
    handleUnifiedBookingClose, handleUnifiedBookingSuccess, handleUnifiedBookingError, handleUnifiedBookingCreated,
    handleGuestDetailsTabChange, handleCreditBookingSubmit,
    handleViewRoomDetails: (room: Room) => { setSelectedRoom(room); setRoomDetailsDialogOpen(true); },
    handleCloseRoomDetails: () => setRoomDetailsDialogOpen(false),
    isDateBlocked, isDateSelectable, isComplimentaryDateAvailable, toggleDateSelection,
    loadUpcomingBookings, loadGuestCredits,
    bookingChannels: getHotelSettings().booking_channels,
    paymentMethods: getHotelSettings().payment_methods,
  };
}
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from '../../../../router';
import {
  Box,
  Typography,
  Chip,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  Paper,
  Skeleton,
  Stack,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import {
  CheckCircle as CheckCircleIcon,
  Person as PersonIcon,
  PersonAdd as PersonAddIcon,
  Login as LoginIcon,
  Logout as LogoutIcon,
  History as HistoryIcon,
  Settings as SettingsIcon,
  CardGiftcard as GiftIcon,
  CalendarMonth as CalendarIcon,
  Update as ExtendIcon,
  SwapHoriz as SwapIcon,
  Notes as NotesIcon,
  AutoAwesome as SparkleIcon,
  Build as BuildIcon,
} from '@mui/icons-material';
import { BookingsService, RoomsService } from '../../../../api';

import { Room, Guest, Booking, BookingWithDetails, RoomHistory } from '../../../../types';
import { useCurrency } from '../../../../hooks/useCurrency';
import {
  useBookingNotes,
  useGuestCreditsWorkflow,
  useReservedCheckInWorkflow,
  useRoomData,
  useRoomManagementFilters,
  useRoomNotes,
  useUpcomingBookingsDialog,
} from '../../hooks';
import { getHotelSettings } from '../../../../utils/hotelSettings';
import { formatLocalDate, parseLocalDate } from '../../../../utils/date';
import { isGreaterMoney, isLessMoney, subtractMoney, toMoneyNumber } from '../../../../utils/money';
import CheckoutInvoiceModals from '../../../invoices/components/CheckoutInvoiceModals';
import { useCheckoutFlow } from '../../../invoices/hooks/useCheckoutFlow';
import UnifiedBookingModal, { BookingType } from '../UnifiedBooking/UnifiedBookingModal';
import UpdateCheckoutDateDialog from '../UpdateCheckoutDateDialog';
import RoomStatusDialog from './RoomStatusDialog';
import { ApiNotificationSeverity, emitApiNotification } from '../../../../utils/apiNotifications';
import { RoomAction, MenuLayout, RoomMenuAnchor } from './types';
import { getUnifiedStatusShortLabel } from '../../config';
import RoomNotesDialog from './components/RoomNotesDialog';
import RoomDetailsDialog from './components/RoomDetailsDialog';
import RoomHistoryDialog from './components/RoomHistoryDialog';
import BookingNotesDialog from './components/BookingNotesDialog';
import MarkComplimentaryDialog from './components/MarkComplimentaryDialog';
import UpcomingBookingsDialog from './components/UpcomingBookingsDialog';
import ChangeRoomDialog from './components/ChangeRoomDialog';
import ReservedCheckInDialog from './components/ReservedCheckInDialog';
import { getRoomCardFill } from './roomCardPresentation';
import GuestDetailsDialog from './components/GuestDetailsDialog';
import RoomManagementHeader from './components/RoomManagementHeader';
import RoomCard from './components/RoomCard';
import RoomContextMenu from './components/RoomContextMenu';

const DAY_MS = 24 * 60 * 60 * 1000;

const getDateOnly = (value?: string) => (value || '').split('T')[0];

const formatReviewDate = (value?: string) => {
  const dateOnly = getDateOnly(value);
  if (!dateOnly) return '-';
  return parseLocalDate(dateOnly).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
};

const getOverdueDays = (checkOutDate: string, todayIso: string) => {
  const checkOut = parseLocalDate(getDateOnly(checkOutDate));
  const today = parseLocalDate(todayIso);
  return Math.max(1, Math.ceil((today.getTime() - checkOut.getTime()) / DAY_MS));
};

// UnifiedBookingModal's onBookingCreated forwards the raw booking/guest objects it built
// (see UnifiedBookingModal.tsx `onBookingCreated?: (booking: Booking & { room_number?: string }, guest: Guest) => void`),
// whose booking object carries an optional `room_number` overlay on the declared `Booking`
// shape. Keep this local alias in sync with that hand-off type.
// `first_name`/`last_name` are NOT part of the real `Guest` API type (only `full_name` is) —
// kept optional here since the fallback that reads them is effectively dead code today.
type BookingCreatedPayload = Booking & { room_number?: string };
type GuestCreatedPayload = Guest & { first_name?: string; last_name?: string };

const RoomManagementPage: React.FC = () => {
  const navigate = useNavigate();
  const theme = useTheme();
  const isDarkMode = theme.palette.mode !== 'light';
  const { format: formatCurrency, symbol: currencySymbol } = useCurrency();
  // Unified booking modal state — declared before useRoomData because it gates
  // the guest-list query (guests are only needed once the modal opens).
  const [unifiedBookingOpen, setUnifiedBookingOpen] = useState(false);
  const [unifiedBookingType, setUnifiedBookingType] = useState<BookingType | undefined>(undefined);
  const {
    rooms,
    guests,
    loading,
    error: dataError,
    roomBookings,
    reservedBookings,
    allBookingsData,
    reload: loadData,
    reloadRooms: loadRooms,
    reloadBookings: loadBookings,
  } = useRoomData(unifiedBookingOpen);
  const showSnackbar = useCallback((message: string, severity: ApiNotificationSeverity) => {
    emitApiNotification({ message, severity });
  }, []);

  // Shared checkout flow (no read-only receipt view on this page).
  const checkoutFlow = useCheckoutFlow({
    onAfterCheckout: () => loadData(),
    successMessage: (b, late) =>
      late
        ? `Room ${b.room_number} checked out (late checkout penalty: RM ${late.penalty})`
        : `Room ${b.room_number} checked out successfully`,
    notify: (message, severity) => showSnackbar(message, (severity ?? 'success') as ApiNotificationSeverity),
  });
  // Stable useCallback inside the hook — destructured so it can be a dep of
  // memoized handlers below (the checkoutFlow object itself is a fresh
  // literal every render).
  const { openCheckout } = checkoutFlow;
  const {
    notesDialogOpen,
    notesRoom,
    editingNotes,
    setEditingNotes,
    savingNotes,
    openRoomNotes,
    closeRoomNotes,
    saveRoomNotes,
  } = useRoomNotes({ reload: loadData, showSnackbar });
  const {
    bookingNotesDialogOpen,
    bookingNotesEditBooking,
    editedBookingNotes,
    setEditedBookingNotes,
    editedCleaningPreference,
    setEditedCleaningPreference,
    savingBookingNotes,
    openBookingNotes: handleEditBookingNotes,
    closeBookingNotes,
    saveBookingNotes: handleSaveBookingNotes,
  } = useBookingNotes({ reload: loadData, showSnackbar });
  const {
    roomStatusFilter,
    setRoomStatusFilter,
    attrFilters,
    toggleAttrFilter,
    floorFilter,
    setFloorFilter,
    roomSearch,
    setRoomSearch,
    prioritySort,
    togglePrioritySort,
    floors,
    getRoomStatusInfo,
    availableCount,
    occupiedCount,
    reservedCount,
    dirtyCount,
    maintenanceCount,
    occupancyRate,
    smokingCount,
    dailyCleaningCount,
    noCleaningCount,
    filteredRooms,
    filterOptions,
  } = useRoomManagementFilters({ rooms, roomBookings, reservedBookings });
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [selectedBooking, setSelectedBooking] = useState<BookingWithDetails | null>(null);
  const handleMenuClose = useCallback(() => {
    setMenuPosition(null);
  }, []);
  const reservedCheckIn = useReservedCheckInWorkflow({
    reload: loadData,
    showSnackbar,
  });
  // Stable reference for use in memoized callback deps below (the reservedCheckIn
  // object itself is a fresh literal every render; openWithBooking is the useCallback
  // inside the hook and is what actually needs to be tracked).
  const { openWithBooking: openReservedCheckIn } = reservedCheckIn;
  const guestCreditsWorkflow = useGuestCreditsWorkflow({
    guests,
    rooms,
    allBookings: allBookingsData,
    reloadRooms: loadRooms,
    reloadBookings: loadBookings,
    showSnackbar,
    onCloseMenu: handleMenuClose,
  });
  const upcomingBookings = useUpcomingBookingsDialog({
    allBookings: allBookingsData,
    onSelectRoom: setSelectedRoom,
    onCloseMenu: handleMenuClose,
  });

  // Dialogs
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [roomDetailsDialogOpen, setRoomDetailsDialogOpen] = useState(false);
  const [changeRoomDialogOpen, setChangeRoomDialogOpen] = useState(false);
  const [updateCheckoutDialogOpen, setUpdateCheckoutDialogOpen] = useState(false);
  const [updateCheckoutBooking, setUpdateCheckoutBooking] = useState<BookingWithDetails | null>(null);
  const [overdueCheckoutDialogOpen, setOverdueCheckoutDialogOpen] = useState(false);
  const [complimentaryDialogOpen, setComplimentaryDialogOpen] = useState(false);

  // Notes and status editing state
  const [roomStatusDialogOpen, setRoomStatusDialogOpen] = useState(false);
  const [complimentaryReason, setComplimentaryReason] = useState('');
  const [markingComplimentary, setMarkingComplimentary] = useState(false);

  // Room change state
  const [newSelectedRoom, setNewSelectedRoom] = useState<Room | null>(null);
  const [changingRoom, setChangingRoom] = useState(false);
  const [changeRoomCustomRate, setChangeRoomCustomRate] = useState<string>('');

  // Room history state
  const [roomHistory, setRoomHistory] = useState<RoomHistory[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Get configurable payment methods from hotel settings
  // Can be modified in Settings page or by editing hotelSettings.ts
  const PAYMENT_METHODS = useMemo(() => getHotelSettings().payment_methods, []);
  const todayIso = formatLocalDate();

  const roomById = useMemo(() => {
    return new Map(rooms.map((room) => [String(room.id), room]));
  }, [rooms]);

  const overdueCheckoutBookings = useMemo(() => {
    return allBookingsData
      .filter((booking) => {
        const status = String(booking.status || '');
        return (
          (status === 'checked_in' || status === 'auto_checked_in') &&
          Boolean(booking.check_out_date) &&
          getDateOnly(booking.check_out_date) < todayIso
        );
      })
      .sort((a, b) => {
        const dateSort = getDateOnly(a.check_out_date).localeCompare(getDateOnly(b.check_out_date));
        if (dateSort !== 0) return dateSort;
        return String(a.room_number || '').localeCompare(String(b.room_number || ''), undefined, { numeric: true });
      });
  }, [allBookingsData, todayIso]);

  // room_id -> days past checkout, for the per-card OVERDUE badge.
  const overdueDaysByRoom = useMemo(() => {
    const map = new Map<string, number>();
    overdueCheckoutBookings.forEach((booking) => {
      map.set(String(booking.room_id), getOverdueDays(booking.check_out_date, todayIso));
    });
    return map;
  }, [overdueCheckoutBookings, todayIso]);

  // Rooms and bookings poll themselves via refetchInterval in useRoomData,
  // which also pauses while the tab is hidden.

  // Refetch errors surface as a snackbar when rooms are on screen; an
  // initial-load failure shows the persistent inline alert instead.
  useEffect(() => {
    if (dataError && rooms.length > 0) showSnackbar(dataError, 'error');
  }, [dataError, rooms.length, showSnackbar]);

  // Memoized callbacks for UnifiedBookingModal to prevent re-renders during periodic refresh
  const handleUnifiedBookingClose = useCallback(() => {
    setUnifiedBookingOpen(false);
    setUnifiedBookingType(undefined);
  }, []);

  const handleUnifiedBookingSuccess = useCallback((message: string) => {
    showSnackbar(message, 'success');
  }, [showSnackbar]);

  const handleUnifiedBookingError = useCallback((message: string) => {
    showSnackbar(message, 'error');
  }, [showSnackbar]);

  const handleUnifiedBookingCreated = useCallback((booking: BookingCreatedPayload, guest: GuestCreatedPayload) => {
    // Convert to BookingWithDetails for the reserved check-in dialog. `booking`/`guest`
    // are the raw objects UnifiedBookingModal passes through onBookingCreated — they can
    // carry fields beyond the declared Booking/Guest shapes (see
    // UnifiedBookingModal.tsx:503, which bolts `room_number` onto the booking object).
    // `as BookingWithDetails` mirrors that: BookingWithDetails requires fields (e.g.
    // `price_per_night`) that Booking/booking here does not carry, so this was already
    // an incomplete object before typing (previously masked by `any`) — flagged in the
    // task report rather than invented here.
    const bwd = {
      ...booking,
      guest_name: guest.nick_name || `${guest.first_name || ''} ${guest.last_name || ''}`.trim(),
      guest_email: guest.email || '',
      guest_phone: guest.phone || '',
      room_number: booking.room_number || String(booking.room_id),
      room_type: booking.room_type || '',
      booking_number: booking.folio_number || booking.booking_number || '',
    } as BookingWithDetails;
    openReservedCheckIn(bwd, booking.payment_method || 'Cash');
  }, [openReservedCheckIn]);

  // useCallback'd handlers keep memoized RoomCards from re-rendering on every
  // parent state change (menu open/close, dialog toggles, poll refetches).
  const handleMenuOpen = useCallback((anchor: RoomMenuAnchor, room: Room) => {
    if ('preventDefault' in anchor) {
      anchor.preventDefault();
      setMenuPosition({ top: anchor.clientY, left: anchor.clientX });
    } else {
      setMenuPosition(anchor);
    }
    setSelectedRoom(room);
  }, []);

  // Room Actions - Unified Booking Modal
  const openUnifiedBooking = useCallback((room: Room, bookingType?: BookingType) => {
    setSelectedRoom(room);
    setUnifiedBookingType(bookingType);
    setUnifiedBookingOpen(true);
  }, []);

  const handleCheckIn = useCallback((room: Room) => {
    const reservedBooking = reservedBookings.get(room.id);
    if (reservedBooking) {
      // Reserved rooms go through the streamlined check-in dialog.
      setSelectedRoom(room);
      openReservedCheckIn(reservedBooking);
      return;
    }

    // No reservation on file — fall back to the unified booking flow.
    openUnifiedBooking(room, 'online');
  }, [reservedBookings, openReservedCheckIn, openUnifiedBooking]);

  const handleCheckOut = useCallback((room: Room) => {
    setSelectedRoom(room);
    // Find the active booking for this room
    const booking = roomBookings.get(room.id);
    if (booking) {
      setSelectedBooking(booking);
      openCheckout(booking);
    } else {
      showSnackbar('No active booking found for this room', 'warning');
    }
  }, [roomBookings, openCheckout, showSnackbar]);

  const handleUpdateStatus = (room: Room) => {
    setSelectedRoom(room);
    setRoomStatusDialogOpen(true);
  };

  const handleSaveRoomStatus = async (status: string, notes: string) => {
    if (!selectedRoom) return;

    // Send the requested status as-is. The backend decides whether to flip an
    // "available" request to "reserved" — but only for a reservation arriving
    // today after the configured check-in time. Pre-empting that here (forcing
    // "reserved" for any upcoming booking, with no booking_id) made the backend
    // reject the request, so rooms with a future booking could never be set
    // available.
    const updated = await RoomsService.updateRoomStatus(selectedRoom.id, {
      status: status as 'maintenance' | 'reserved' | 'reserved_dirty' | 'available' | 'occupied' | 'dirty',
      notes,
    });

    showSnackbar(`Room status updated to ${updated?.status ?? status}`, 'success');
    loadData();
  };

  const handleMakeDirty = async (room: Room) => {
    try {
      // Update room status to dirty (needs cleaning)
      await RoomsService.updateRoomStatus(room.id, {
        status: 'dirty',
        notes: 'Room marked as dirty - requires cleaning',
      });

      showSnackbar(`Room ${room.room_number} marked as dirty`, 'success');
      await loadData(); // Reload all data including rooms and bookings
    } catch (error) {
      showSnackbar(error instanceof Error && error.message ? error.message : 'Failed to update room status', 'error');
    }
  };

  const handleMarkAvailable = useCallback(async (room: Room) => {
    try {
      // Request "available"; the backend keeps reserved-dirty rooms reserved
      // when an active reservation still exists.
      const updated = await RoomsService.updateRoomStatus(room.id, {
        status: 'available',
        notes: 'Room marked as available',
      });

      showSnackbar(`Room ${room.room_number} updated to ${updated?.status ?? 'available'}`, 'success');
      await loadData(); // Reload all data including rooms and bookings
    } catch (error) {
      showSnackbar(error instanceof Error && error.message ? error.message : 'Failed to update room status', 'error');
    }
  }, [loadData, showSnackbar]);

  const handleMaintenance = async (room: Room) => {
    try {
      await RoomsService.updateRoomStatus(room.id, {
        status: 'maintenance',
        notes: 'Room under maintenance',
      });
      showSnackbar(`Room ${room.room_number} set to maintenance`, 'success');
      await loadData(); // Reload all data including rooms and bookings
    } catch (error) {
      showSnackbar(error instanceof Error && error.message ? error.message : 'Failed to update room status', 'error');
    }
  };

  const handleViewUpcomingBookings = upcomingBookings.openForRoom;

  const handleShowHistory = async (room: Room) => {
    setSelectedRoom(room);
    setHistoryDialogOpen(true);

    // Load room history
    try {
      setLoadingHistory(true);
      const history = await RoomsService.getRoomHistory(room.id);
      setRoomHistory(history);
    } catch (error) {
      showSnackbar(error instanceof Error && error.message ? error.message : 'Failed to load room history', 'error');
      setRoomHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleViewGuestDetails = guestCreditsWorkflow.openGuestDetails;

  const handleRoomProperties = (room: Room) => {
    setSelectedRoom(room);
    setRoomDetailsDialogOpen(true);
  };

  const handleEditNotes = useCallback((room: Room) => {
    setSelectedRoom(room);
    openRoomNotes(room);
  }, [openRoomNotes]);

  const handleChangeRoom = useCallback((room: Room) => {
    setSelectedRoom(room);
    setNewSelectedRoom(null);
    setChangeRoomCustomRate('');
    // Get the active booking for this room
    const booking = roomBookings.get(room.id);
    setSelectedBooking(booking || null);
    setChangeRoomDialogOpen(true);
  }, [roomBookings]);

  const handleUpdateCheckoutDate = (room: Room) => {
    const booking = roomBookings.get(room.id);
    if (booking) {
      setUpdateCheckoutBooking(booking);
      setUpdateCheckoutDialogOpen(true);
    }
  };

  const handleReviewCheckout = (booking: BookingWithDetails) => {
    const room = roomById.get(String(booking.room_id)) ?? null;
    setSelectedRoom(room);
    setSelectedBooking(booking);
    setOverdueCheckoutDialogOpen(false);
    checkoutFlow.openCheckout(booking);
  };

  const handleReviewUpdateCheckout = (booking: BookingWithDetails) => {
    const room = roomById.get(String(booking.room_id)) ?? null;
    setSelectedRoom(room);
    setUpdateCheckoutBooking(booking);
    setOverdueCheckoutDialogOpen(false);
    setUpdateCheckoutDialogOpen(true);
  };

  const handleConfirmRoomChange = async () => {
    if (!selectedRoom || !newSelectedRoom || !selectedBooking) {
      showSnackbar('Please select a new room', 'warning');
      return;
    }

    try {
      setChangingRoom(true);

      // Determine the effective rate
      const customRate = toMoneyNumber(changeRoomCustomRate);
      const effectiveRate = changeRoomCustomRate.trim() && isGreaterMoney(customRate, 0)
        ? customRate
        : toMoneyNumber(newSelectedRoom.price_per_night);
      const priceDifference = subtractMoney(effectiveRate, selectedRoom.price_per_night);

      // One transactional call: booking reassignment + rate override + old
      // room→dirty + new room→occupied + room_changes/history audit rows.
      // (Previously three separate API calls that could half-apply.)
      await RoomsService.executeRoomChange(selectedRoom.id, String(newSelectedRoom.id), {
        roomRateOverride: effectiveRate,
        reason: `Guest moved from room ${selectedRoom.room_number} to ${newSelectedRoom.room_number}`,
      });

      const changeMessage = isGreaterMoney(priceDifference, 0)
        ? `Room changed successfully. Additional charge: ${currencySymbol}${Math.abs(priceDifference).toFixed(2)}/night`
        : isLessMoney(priceDifference, 0)
        ? `Room changed successfully. Credit applied: ${currencySymbol}${Math.abs(priceDifference).toFixed(2)}/night`
        : 'Room changed successfully. No additional charges.';

      showSnackbar(changeMessage, 'success');
      setChangeRoomDialogOpen(false);
      setNewSelectedRoom(null);
      await loadData();
    } catch (error) {
      showSnackbar(error instanceof Error && error.message ? error.message : 'Failed to change room', 'error');
    } finally {
      setChangingRoom(false);
    }
  };

  const handleMarkComplimentary = (room: Room) => {
    setSelectedRoom(room);
    // Get the reserved booking for this room
    const booking = reservedBookings.get(room.id);
    if (booking) {
      setSelectedBooking(booking);
      setComplimentaryReason('');
      setComplimentaryDialogOpen(true);
    } else {
      showSnackbar('No pending booking found for this room', 'warning');
    }
  };

  const handleConfirmMarkComplimentary = async () => {
    if (!selectedBooking) {
      showSnackbar('No booking selected', 'warning');
      return;
    }

    try {
      setMarkingComplimentary(true);

      // Call API to mark booking as complimentary
      const result = await BookingsService.markBookingComplimentary(selectedBooking.id, complimentaryReason || undefined);

      showSnackbar(`Booking marked as complimentary! ${result.nights_credited} night(s) of ${result.room_type} credits added to guest.`, 'success');
      setComplimentaryDialogOpen(false);
      setComplimentaryReason('');
      setSelectedBooking(null);
      await loadData();
    } catch (error) {
      showSnackbar(error instanceof Error && error.message ? error.message : 'Failed to mark booking as complimentary', 'error');
    } finally {
      setMarkingComplimentary(false);
    }
  };

  const getMenuLayout = (room: Room | null): MenuLayout => {
    if (!room) return { sections: [] };

    const { computedStatus, booking, reservedBooking, isOccupied, isReserved, isComplimentary } = getRoomStatusInfo(room);
    const isMaintenance = computedStatus === 'maintenance';
    const isReservedDirty = computedStatus === 'reserved_dirty';
    const layout: MenuLayout = { sections: [] };

    // Primary action — anchors the menu with the most likely next step for this room state
    if (isOccupied) {
      layout.primary = { label: 'Check out', icon: <LogoutIcon />, onClick: handleCheckOut, color: 'error' };
    } else if (isReserved && reservedBooking) {
      layout.primary = { label: 'Check-in guest', icon: <LoginIcon />, onClick: handleCheckIn, color: 'primary', dark: true };
    } else if (isReservedDirty) {
      layout.primary = { label: 'Mark clean', icon: <SparkleIcon />, onClick: handleMarkAvailable, color: 'success', dark: true };
    } else if (!isMaintenance) {
      layout.primary = { label: 'New booking', icon: <PersonAddIcon />, onClick: openUnifiedBooking, dark: true };
    }

    // BOOKING section
    const bookingActions: RoomAction[] = [];
    if (!isMaintenance) {
      bookingActions.push({
        id: 'upcoming',
        label: 'Upcoming bookings',
        icon: <CalendarIcon />,
        onClick: handleViewUpcomingBookings,
      });
    }
    if (isOccupied && booking) {
      bookingActions.push({ id: 'change-room', label: 'Change room', icon: <SwapIcon />, onClick: handleChangeRoom });
      bookingActions.push({ id: 'update-checkout', label: 'Extend checkout date', icon: <ExtendIcon />, onClick: handleUpdateCheckoutDate });
    }
    if (isOccupied && booking?.guest_id) {
      bookingActions.push({ id: 'guest-details', label: 'Guest details', icon: <PersonIcon />, onClick: () => handleViewGuestDetails(booking.guest_id) });
    }
    if (isComplimentary) {
      bookingActions.push({
        id: 'complimentary-info',
        label: 'Free gift booking',
        icon: <GiftIcon />,
        color: '#7b1fa2',
        secondary: 'No cancellation',
        onClick: () => {
          showSnackbar('This is a complimentary (Free Gift) booking. Cancellation is not recommended as the guest has used their free credits.', 'warning');
        },
      });
    }
    if (isReserved && reservedBooking && !reservedBooking.is_complimentary) {
      bookingActions.push({ id: 'mark-complimentary', label: 'Mark as complimentary', icon: <GiftIcon />, color: '#7b1fa2', onClick: handleMarkComplimentary });
    }
    if (bookingActions.length > 0) {
      layout.sections.push({ title: 'Booking', actions: bookingActions });
    }

    // HOUSEKEEPING section
    const hkActions: RoomAction[] = [];
    hkActions.push({ id: 'update-status', label: 'Update status / block', icon: <BuildIcon />, onClick: handleUpdateStatus });
    layout.sections.push({ title: 'Housekeeping', actions: hkActions });

    // ROOM section
    layout.sections.push({
      title: 'Room',
      actions: [
        { id: 'history', label: 'Room history', icon: <HistoryIcon />, onClick: handleShowHistory },
        { id: 'edit-notes', label: 'Edit notes', icon: <NotesIcon />, onClick: handleEditNotes },
        { id: 'properties', label: 'Properties...', icon: <SettingsIcon />, onClick: handleRoomProperties },
      ],
    });

    return layout;
  };

  if (loading) {
    return (
      <Box sx={{ p: { xs: 1.5, md: 2.5 } }}>
        <Skeleton variant="rounded" height={130} sx={{ borderRadius: 2 }} />
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: 'repeat(2, minmax(0, 1fr))',
              sm: 'repeat(3, minmax(0, 1fr))',
              md: 'repeat(5, minmax(0, 1fr))',
              lg: 'repeat(7, minmax(0, 1fr))',
            },
            gap: 1.5,
            mt: 1.5,
          }}
        >
          {Array.from({ length: 14 }, (_, i) => (
            <Skeleton key={i} variant="rounded" height={250} sx={{ borderRadius: 2.5 }} />
          ))}
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ p: { xs: 1.5, md: 2.5 } }}>
      {/* Header */}
      <RoomManagementHeader
        rooms={filteredRooms}
        occupancyRate={occupancyRate}
        availableCount={availableCount}
        occupiedCount={occupiedCount}
        reservedCount={reservedCount}
        dirtyCount={dirtyCount}
        maintenanceCount={maintenanceCount}
        statusFilter={roomStatusFilter}
        onStatusFilterChange={setRoomStatusFilter}
        filterOptions={filterOptions}
        attrFilters={attrFilters}
        onToggleAttr={toggleAttrFilter}
        smokingCount={smokingCount}
        dailyCleaningCount={dailyCleaningCount}
        noCleaningCount={noCleaningCount}
        floors={floors}
        floorFilter={floorFilter}
        onFloorFilterChange={setFloorFilter}
        roomSearch={roomSearch}
        onRoomSearchChange={setRoomSearch}
        prioritySort={prioritySort}
        onTogglePrioritySort={togglePrioritySort}
      />
      {dataError && rooms.length === 0 && (
        <Alert
          severity="error"
          action={
            <Button
              color="inherit"
              size="small"
              onClick={() => loadData()}
              sx={{ fontWeight: 800 }}
            >
              Retry
            </Button>
          }
          sx={{ mt: 1.5, border: '1px solid', borderColor: 'error.light', alignItems: 'center' }}
        >
          {dataError}
        </Alert>
      )}
      {overdueCheckoutBookings.length > 0 && (
        <Alert
          severity="warning"
          action={
            <Button
              color="inherit"
              size="small"
              onClick={() => setOverdueCheckoutDialogOpen(true)}
              sx={{ fontWeight: 800 }}
            >
              Review
            </Button>
          }
          sx={{
            mt: 1.5,
            border: '1px solid',
            borderColor: 'warning.light',
            alignItems: 'center',
          }}
        >
          <Typography variant="body2" sx={{ fontWeight: 800 }}>
            {overdueCheckoutBookings.length} room{overdueCheckoutBookings.length === 1 ? '' : 's'} past scheduled checkout
          </Typography>
          <Typography variant="caption" sx={{
            color: "text.secondary"
          }}>
            Review checked-in bookings whose checkout date has already passed.
          </Typography>
        </Alert>
      )}
      {/* Room Grid */}
      <Paper
        elevation={0}
        sx={{
          bgcolor: 'background.default',
          border: '1px solid',
          borderTop: 0,
          borderColor: 'divider',
          borderRadius: '0 0 12px 12px',
          p: { xs: 1.25, md: 2 },
        }}
      >
      <Box 
        sx={{ 
          display: 'grid', 
          gridTemplateColumns: {
            xs: 'repeat(2, minmax(0, 1fr))',
            sm: 'repeat(3, minmax(0, 1fr))',
            md: 'repeat(5, minmax(0, 1fr))',
            lg: 'repeat(7, minmax(0, 1fr))',
            xl: 'repeat(7, minmax(0, 1fr))',
          }, 
          gap: 1.5 
        }}
      >
        {filteredRooms.map((room) => {
          const info = getRoomStatusInfo(room);
          const cardFill = getRoomCardFill(info.computedStatus, isDarkMode);
          return (
            <RoomCard
              key={room.id}
              room={room}
              computedStatus={info.computedStatus}
              statusLabel={getUnifiedStatusShortLabel(info.computedStatus)}
              booking={info.booking}
              reservedBooking={info.reservedBooking}
              hasReservationForToday={info.hasReservationForToday}
              isOccupied={info.isOccupied}
              isReservedToday={info.isReservedToday}
              isComplimentary={info.isComplimentary}
              overdueDays={overdueDaysByRoom.get(room.id)}
              cardFill={cardFill}
              isDarkMode={isDarkMode}
              onMenuOpen={handleMenuOpen}
              onEditNotes={handleEditNotes}
              onEditBookingNotes={handleEditBookingNotes}
              onCheckOut={handleCheckOut}
              onChangeRoom={handleChangeRoom}
              onCheckIn={handleCheckIn}
              onNewBooking={openUnifiedBooking}
              onMarkAvailable={handleMarkAvailable}
            />
          );
        })}
      </Box>
      </Paper>
      {/* Context Menu */}
      <RoomContextMenu
        menuPosition={menuPosition}
        onClose={handleMenuClose}
        room={selectedRoom}
        getStatusInfo={getRoomStatusInfo}
        getMenuLayout={getMenuLayout}
        formatCurrency={formatCurrency}
      />
      <Dialog
        open={overdueCheckoutDialogOpen}
        onClose={() => setOverdueCheckoutDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>Overdue Checkouts</DialogTitle>
        <DialogContent dividers>
          {overdueCheckoutBookings.length === 0 ? (
            <Box sx={{ py: 4, textAlign: 'center' }}>
              <CheckCircleIcon color="success" sx={{ fontSize: 36, mb: 1 }} />
              <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                No overdue checkouts
              </Typography>
              <Typography variant="body2" sx={{
                color: "text.secondary"
              }}>
                All checked-in rooms are within their scheduled checkout dates.
              </Typography>
            </Box>
          ) : (
            <Stack spacing={1.25}>
              {overdueCheckoutBookings.map((booking) => {
                const room = roomById.get(String(booking.room_id));
                const overdueDays = getOverdueDays(booking.check_out_date, todayIso);
                const bookingRef = booking.invoice_number || booking.folio_number || booking.booking_number || `#${booking.id}`;

                return (
                  <Paper
                    key={booking.id}
                    variant="outlined"
                    sx={{
                      p: 1.5,
                      display: 'grid',
                      gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) auto' },
                      gap: 1.25,
                      alignItems: 'center',
                      borderColor: 'warning.light',
                      bgcolor: alpha(theme.palette.warning.main, 0.05),
                    }}
                  >
                    <Box sx={{ minWidth: 0 }}>
                      <Stack
                        direction="row"
                        spacing={1}
                        useFlexGap
                        sx={{
                          flexWrap: "wrap",
                          alignItems: "center",
                          mb: 0.75
                        }}>
                        <Chip
                          size="small"
                          color="warning"
                          label={`${overdueDays} day${overdueDays === 1 ? '' : 's'} overdue`}
                          sx={{ fontWeight: 800 }}
                        />
                        <Chip
                          size="small"
                          variant="outlined"
                          label={bookingRef}
                          sx={{ fontWeight: 700 }}
                        />
                      </Stack>
                      <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>
                        Room {booking.room_number || room?.room_number || booking.room_id} · {booking.guest_name || 'Unknown guest'}
                      </Typography>
                      <Typography variant="body2" sx={{
                        color: "text.secondary"
                      }}>
                        Stay {formatReviewDate(booking.check_in_date)} - {formatReviewDate(booking.check_out_date)}
                      </Typography>
                    </Box>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                      <Button
                        variant="outlined"
                        color="warning"
                        startIcon={<ExtendIcon />}
                        onClick={() => handleReviewUpdateCheckout(booking)}
                      >
                        Extend checkout date
                      </Button>
                      <Button
                        variant="contained"
                        color="error"
                        startIcon={<LogoutIcon />}
                        onClick={() => handleReviewCheckout(booking)}
                      >
                        Check out
                      </Button>
                    </Stack>
                  </Paper>
                );
              })}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOverdueCheckoutDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
      {/* Extend Checkout Date Dialog */}
      <UpdateCheckoutDateDialog
        open={updateCheckoutDialogOpen}
        onClose={() => setUpdateCheckoutDialogOpen(false)}
        booking={updateCheckoutBooking}
        onSuccess={() => {
          showSnackbar('Checkout date extended successfully', 'success');
          loadData();
        }}
      />
      {/* Change Room Dialog */}
      <ChangeRoomDialog
        open={changeRoomDialogOpen}
        onClose={() => !changingRoom && setChangeRoomDialogOpen(false)}
        onCancel={() => setChangeRoomDialogOpen(false)}
        currentRoom={selectedRoom}
        rooms={rooms}
        selectedNewRoom={newSelectedRoom}
        onSelectNewRoom={setNewSelectedRoom}
        customRate={changeRoomCustomRate}
        onCustomRateChange={setChangeRoomCustomRate}
        currencySymbol={currencySymbol}
        changing={changingRoom}
        onConfirm={handleConfirmRoomChange}
      />
      {/* Unified Booking Modal */}
      <UnifiedBookingModal
        open={unifiedBookingOpen}
        onClose={handleUnifiedBookingClose}
        room={selectedRoom}
        guests={guests}
        initialBookingType={unifiedBookingType}
        onSuccess={handleUnifiedBookingSuccess}
        onError={handleUnifiedBookingError}
        onBookingCreated={handleUnifiedBookingCreated}
        onRefreshData={loadData}
      />
      {/* Check Out Dialog with Invoice (shared flow; no read-only receipt here) */}
      <CheckoutInvoiceModals flow={checkoutFlow} withReceipt={false} />
      {/* Room History Dialog - Enhanced */}
      <RoomHistoryDialog
        open={historyDialogOpen}
        onClose={() => setHistoryDialogOpen(false)}
        room={selectedRoom}
        loading={loadingHistory}
        history={roomHistory}
        currentBooking={selectedRoom ? roomBookings.get(selectedRoom.id) : undefined}
        onViewGuestDetails={handleViewGuestDetails}
      />
      {/* Room Properties Dialog - Placeholder */}
      <RoomDetailsDialog
        open={roomDetailsDialogOpen}
        onClose={() => setRoomDetailsDialogOpen(false)}
        room={selectedRoom}
        formatCurrency={formatCurrency}
      />
      {/* Edit Room Notes Dialog */}
      <RoomNotesDialog
        open={notesDialogOpen}
        onClose={closeRoomNotes}
        roomNumber={notesRoom?.room_number}
        notes={editingNotes}
        onNotesChange={setEditingNotes}
        onSave={saveRoomNotes}
        saving={savingNotes}
      />
      <RoomStatusDialog
        open={roomStatusDialogOpen}
        room={selectedRoom}
        onClose={() => setRoomStatusDialogOpen(false)}
        onSubmit={handleSaveRoomStatus}
      />
      {/* Booking Notes Edit Dialog */}
      <BookingNotesDialog
        open={bookingNotesDialogOpen}
        onClose={closeBookingNotes}
        booking={bookingNotesEditBooking}
        notes={editedBookingNotes}
        onNotesChange={setEditedBookingNotes}
        cleaningPreference={editedCleaningPreference}
        onCleaningPreferenceChange={setEditedCleaningPreference}
        onSave={handleSaveBookingNotes}
        saving={savingBookingNotes}
      />
      {/* Upcoming Bookings Dialog */}
      <UpcomingBookingsDialog
        open={upcomingBookings.open}
        onClose={upcomingBookings.close}
        roomNumber={selectedRoom?.room_number}
        loading={upcomingBookings.loading}
        bookings={upcomingBookings.bookings}
        formatCurrency={formatCurrency}
        onViewAllInBookings={() => navigate(`/bookings?room=${selectedRoom?.room_number}`)}
        onCheckInBooking={(booking) => {
          upcomingBookings.close();
          reservedCheckIn.openWithBooking(booking);
        }}
      />
      {/* Reserved Check-In Dialog - Streamlined check-in for reserved rooms */}
      <ReservedCheckInDialog
        open={reservedCheckIn.dialogOpen}
        onClose={reservedCheckIn.close}
        onCancel={reservedCheckIn.cancel}
        booking={reservedCheckIn.booking}
        formatCurrency={formatCurrency}
        currencySymbol={currencySymbol}
        paymentMethods={PAYMENT_METHODS}
        paymentChoice={reservedCheckIn.paymentChoice}
        onPaymentChoiceChange={reservedCheckIn.setPaymentChoice}
        paymentMethod={reservedCheckIn.paymentMethod}
        onPaymentMethodChange={reservedCheckIn.setPaymentMethod}
        amountPaid={reservedCheckIn.amountPaid}
        onAmountPaidChange={reservedCheckIn.setAmountPaid}
        depositChoice={reservedCheckIn.depositChoice}
        onDepositChoiceChange={reservedCheckIn.setDepositChoice}
        depositMethod={reservedCheckIn.depositMethod}
        onDepositMethodChange={reservedCheckIn.setDepositMethod}
        depositAmount={reservedCheckIn.depositAmount}
        onDepositAmountChange={reservedCheckIn.setDepositAmount}
        waiveReason={reservedCheckIn.waiveReason}
        onWaiveReasonChange={reservedCheckIn.setWaiveReason}
        icNumber={reservedCheckIn.icNumber}
        onIcNumberChange={reservedCheckIn.setIcNumber}
        phone={reservedCheckIn.phone}
        onPhoneChange={reservedCheckIn.setPhone}
        processing={reservedCheckIn.processing}
        onCheckIn={reservedCheckIn.checkIn}
      />
      {/* Guest Details Dialog with Tabs */}
      <GuestDetailsDialog
        open={guestCreditsWorkflow.dialogOpen}
        onClose={guestCreditsWorkflow.close}
        guest={guestCreditsWorkflow.selectedGuest}
        tab={guestCreditsWorkflow.tab}
        onTabChange={guestCreditsWorkflow.changeTab}
        guestCredits={guestCreditsWorkflow.guestCredits}
        loadingCredits={guestCreditsWorkflow.loadingCredits}
        creditsBookingSuccess={guestCreditsWorkflow.creditsBookingSuccess}
        creditsBookingForm={guestCreditsWorkflow.creditsBookingForm}
        availableRoomsForCredits={guestCreditsWorkflow.availableRoomsForCredits}
        roomBlockedDates={guestCreditsWorkflow.roomBlockedDates}
        selectedComplimentaryDates={guestCreditsWorkflow.selectedComplimentaryDates}
        bookingWithCredits={guestCreditsWorkflow.bookingWithCredits}
        getCreditsBookingDates={guestCreditsWorkflow.getCreditsBookingDates}
        getTotalCreditsForRoom={guestCreditsWorkflow.getTotalCreditsForRoom}
        isDateBlocked={guestCreditsWorkflow.isDateBlocked}
        onCheckInFromCreditsBooking={guestCreditsWorkflow.checkInFromCreditsBooking}
        onBookAnother={guestCreditsWorkflow.bookAnother}
        onCheckInDateChange={guestCreditsWorkflow.changeCheckInDate}
        onCheckOutDateChange={guestCreditsWorkflow.changeCheckOutDate}
        onRoomChange={guestCreditsWorkflow.changeRoom}
        onAdultsChange={guestCreditsWorkflow.changeAdults}
        onChildrenChange={guestCreditsWorkflow.changeChildren}
        onSelectAllAvailable={guestCreditsWorkflow.selectAllAvailable}
        onToggleDate={guestCreditsWorkflow.toggleDate}
        onBookWithCredits={guestCreditsWorkflow.bookWithCreditsAndCheckIn}
      />
      {/* Mark as Complimentary Dialog */}
      <MarkComplimentaryDialog
        open={complimentaryDialogOpen}
        onClose={() => !markingComplimentary && setComplimentaryDialogOpen(false)}
        onCancel={() => setComplimentaryDialogOpen(false)}
        booking={selectedBooking}
        room={selectedRoom}
        currencySymbol={currencySymbol}
        reason={complimentaryReason}
        onReasonChange={setComplimentaryReason}
        processing={markingComplimentary}
        onConfirm={handleConfirmMarkComplimentary}
      />
    </Box>
  );
};

export default RoomManagementPage;

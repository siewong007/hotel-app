// @vitest-environment jsdom
// Page-level coverage for RoomManagementPage:
//  - smoke + axe tests keep the grid rendering from empty data (master).
//  - "booking notes menu action" regression tests: the compact phone card
//    dropped the card's inline notes editor, so the menu (BottomSheet on
//    phone, anchored Menu on desktop) must keep it reachable.
// The page's real getMenuLayout runs here — workflow hooks are mocked at the
// barrel, dialogs are stubbed, the card + context menu under test are not.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isPhone: true,
  openBookingNotes: vi.fn(),
  rooms: [] as import('../../../../types').Room[],
  roomBookings: new Map<string, import('../../../../types').BookingWithDetails>(),
  reservedBookings: new Map<string, import('../../../../types').BookingWithDetails>(),
  infoByRoom: new Map<string, import('../../hooks/useRoomManagementFilters').RoomManagementStatusInfo>(),
  roomData: {
    loading: false,
    error: null as string | null,
  },
}));

vi.mock('@mui/material', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mui/material')>();
  return { ...actual, useMediaQuery: () => mocks.isPhone };
});

vi.mock('../../../../router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../../../api', () => ({
  BookingsService: { markBookingComplimentary: vi.fn() },
  RoomsService: {
    updateRoomStatus: vi.fn(),
    getRoomHistory: vi.fn().mockResolvedValue([]),
    executeRoomChange: vi.fn(),
  },
}));

vi.mock('../../../../components/common/ConfirmProvider', () => ({
  useConfirm: () => vi.fn(),
}));

vi.mock('../../../../hooks/useCurrency', () => ({
  useCurrency: () => ({ format: (n: number) => `RM${Number(n).toFixed(2)}`, symbol: 'RM', currency: 'MYR' }),
}));

vi.mock('../../../../auth/AuthContext', () => ({
  useAuth: () => ({ hasPermission: () => true }),
}));

vi.mock('../../hooks', () => ({
  useRoomData: () => ({
    rooms: mocks.rooms,
    guests: [],
    loading: mocks.roomData.loading,
    error: mocks.roomData.error,
    roomBookings: mocks.roomBookings,
    reservedBookings: mocks.reservedBookings,
    allBookingsData: [],
    reload: vi.fn(),
    reloadRooms: vi.fn(),
    reloadBookings: vi.fn(),
  }),
  useRoomNotes: () => ({
    notesDialogOpen: false,
    notesRoom: null,
    editingNotes: '',
    setEditingNotes: vi.fn(),
    savingNotes: false,
    openRoomNotes: vi.fn(),
    closeRoomNotes: vi.fn(),
    saveRoomNotes: vi.fn(),
  }),
  useBookingNotes: () => ({
    bookingNotesDialogOpen: false,
    bookingNotesEditBooking: null,
    editedBookingNotes: '',
    setEditedBookingNotes: vi.fn(),
    editedCleaningPreference: null,
    setEditedCleaningPreference: vi.fn(),
    savingBookingNotes: false,
    openBookingNotes: mocks.openBookingNotes,
    closeBookingNotes: vi.fn(),
    saveBookingNotes: vi.fn(),
  }),
  useRoomManagementFilters: () => ({
    roomStatusFilter: 'all',
    setRoomStatusFilter: vi.fn(),
    attrFilters: { smoking: false, daily: false, nodaily: false },
    toggleAttrFilter: vi.fn(),
    floorFilter: 'all',
    setFloorFilter: vi.fn(),
    roomSearch: '',
    setRoomSearch: vi.fn(),
    prioritySort: false,
    togglePrioritySort: vi.fn(),
    floors: [],
    getRoomStatusInfo: (room: import('../../../../types').Room) => mocks.infoByRoom.get(room.id),
    availableCount: 0,
    occupiedCount: 1,
    reservedCount: 0,
    dirtyCount: 0,
    maintenanceCount: 0,
    occupancyRate: 100,
    smokingCount: 0,
    dailyCleaningCount: 0,
    noCleaningCount: 0,
    filteredRooms: mocks.rooms,
    filterOptions: [],
  }),
  useReservedCheckInWorkflow: () => ({
    dialogOpen: false,
    booking: null,
    openWithBooking: vi.fn(),
    close: vi.fn(),
    cancel: vi.fn(),
    checkIn: vi.fn(),
    processing: false,
    paymentChoice: 'pay_later',
    setPaymentChoice: vi.fn(),
    paymentMethod: 'Cash',
    setPaymentMethod: vi.fn(),
    amountPaid: 0,
    setAmountPaid: vi.fn(),
    depositChoice: 'receive',
    setDepositChoice: vi.fn(),
    depositMethod: 'Cash',
    setDepositMethod: vi.fn(),
    depositAmount: 0,
    setDepositAmount: vi.fn(),
    waiveReason: '',
    setWaiveReason: vi.fn(),
    icNumber: '',
    setIcNumber: vi.fn(),
    phone: '',
    setPhone: vi.fn(),
  }),
  useGuestCreditsWorkflow: () => ({
    dialogOpen: false,
    booking: null,
    openWithBooking: vi.fn(),
    close: vi.fn(),
    cancel: vi.fn(),
    checkIn: vi.fn(),
    processing: false,
    openGuestDetails: vi.fn(),
    selectedGuest: null,
    tab: 0,
    changeTab: vi.fn(),
    guestCredits: [],
    loadingCredits: false,
    creditsBookingSuccess: null,
    creditsBookingForm: null,
    availableRoomsForCredits: [],
    roomBlockedDates: [],
    selectedComplimentaryDates: [],
    bookingWithCredits: null,
    getCreditsBookingDates: vi.fn(),
    getTotalCreditsForRoom: vi.fn(),
    isDateBlocked: vi.fn(),
    checkInFromCreditsBooking: vi.fn(),
    bookAnother: vi.fn(),
    changeCheckInDate: vi.fn(),
    changeCheckOutDate: vi.fn(),
    changeRoom: vi.fn(),
    changeAdults: vi.fn(),
    changeChildren: vi.fn(),
  }),
  useUpcomingBookingsDialog: () => ({
    open: false,
    close: vi.fn(),
    loading: false,
    bookings: [],
    openForRoom: vi.fn(),
  }),
}));

vi.mock('../../../invoices/hooks/useCheckoutFlow', () => ({
  useCheckoutFlow: () => ({
    openCheckout: vi.fn(),
    closeCheckout: vi.fn(),
    checkoutOpen: false,
    checkoutBooking: null,
    confirmCheckout: vi.fn(),
    receiptOpen: false,
    closeReceipt: vi.fn(),
    receiptBooking: null,
    receiptLedger: null,
    openReceipt: vi.fn(),
  }),
}));

// Dialog children are outside this test's scope — stub them so no service
// layer is needed. (The header is left real: its filter props are fully
// mocked and the smoke test asserts rendered text.)
vi.mock('../UnifiedBooking/UnifiedBookingModal', () => ({ default: () => null, BookingType: {} }));
vi.mock('../../../invoices/components/CheckoutInvoiceModals', () => ({ default: () => null }));
vi.mock('../UpdateCheckoutDateDialog', () => ({ default: () => null }));
vi.mock('./RoomStatusDialog', () => ({ default: () => null }));
vi.mock('./components/RoomNotesDialog', () => ({ default: () => null }));
vi.mock('./components/RoomDetailsDialog', () => ({ default: () => null }));
vi.mock('./components/RoomHistoryDialog', () => ({ default: () => null }));
vi.mock('./components/BookingNotesDialog', () => ({ default: () => null }));
vi.mock('./components/MarkComplimentaryDialog', () => ({ default: () => null }));
vi.mock('./components/UpcomingBookingsDialog', () => ({ default: () => null }));
vi.mock('./components/ChangeRoomDialog', () => ({ default: () => null }));
vi.mock('./components/ReservedCheckInDialog', () => ({ default: () => null }));
vi.mock('./components/GuestDetailsDialog', () => ({ default: () => null }));

import RoomManagementPage from './RoomManagementPage';
import type { BookingWithDetails, Room } from '../../../../types';
import type { RoomManagementStatusInfo } from '../../hooks/useRoomManagementFilters';
import { expectNoCriticalAxeViolations } from '../../../../test/axe';

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RoomManagementPage />
    </QueryClientProvider>,
  );

const occupiedRoom: Room = {
  id: 'r1',
  room_number: '101',
  room_type: 'deluxe',
  price_per_night: 120,
  available: false,
  max_occupancy: 2,
  status: 'occupied',
};

const reservedRoom: Room = {
  id: 'r2',
  room_number: '102',
  room_type: 'deluxe',
  price_per_night: 120,
  available: false,
  max_occupancy: 2,
  status: 'reserved',
};

const vacantRoom: Room = {
  id: 'r3',
  room_number: '103',
  room_type: 'deluxe',
  price_per_night: 120,
  available: true,
  max_occupancy: 2,
  status: 'available',
};

const booking: BookingWithDetails = {
  id: 'b1',
  booking_number: 'BK-1',
  guest_id: 'g1',
  room_id: 'r1',
  check_in_date: '2026-09-14',
  check_out_date: '2026-09-16',
  total_amount: 240,
  status: 'checked_in',
  guest_name: 'Jane Guest',
  guest_email: 'jane@example.com',
  room_number: '101',
  room_type: 'deluxe',
  price_per_night: 120,
  source: 'walk-in',
};

const reservedBooking: BookingWithDetails = {
  ...booking,
  id: 'b2',
  booking_number: 'BK-2',
  room_id: 'r2',
  status: 'confirmed',
  guest_name: 'Rob Reserved',
  room_number: '102',
};

const statusInfo = (overrides: Partial<RoomManagementStatusInfo>): RoomManagementStatusInfo => ({
  computedStatus: 'available',
  booking: undefined,
  reservedBooking: undefined,
  hasCheckedInBooking: false,
  hasReservationForToday: false,
  hasFutureReservation: false,
  futureCheckInDate: null,
  isOccupied: false,
  isReserved: false,
  isReservedToday: false,
  isComplimentary: false,
  ...overrides,
});

describe('RoomManagementPage', () => {
  beforeEach(() => {
    mocks.isPhone = false;
    mocks.roomData.loading = false;
    mocks.roomData.error = null;
    mocks.rooms = [];
    mocks.roomBookings = new Map();
    mocks.reservedBookings = new Map();
    mocks.infoByRoom = new Map();
  });

  afterEach(cleanup);

  it('renders the rooms workspace', () => {
    renderPage();
    expect(document.body.textContent?.length).toBeGreaterThan(0);
  });

  it('reports no critical axe violations', async () => {
    const { container } = renderPage();
    await expectNoCriticalAxeViolations(container);
  });
});

describe('RoomManagementPage — booking notes menu action', () => {
  beforeEach(() => {
    mocks.isPhone = true;
    mocks.openBookingNotes.mockClear();
    mocks.roomBookings = new Map([['r1', booking]]);
    mocks.reservedBookings = new Map([['r2', reservedBooking]]);
    mocks.infoByRoom = new Map([
      ['r1', statusInfo({
        computedStatus: 'occupied',
        booking,
        hasCheckedInBooking: true,
        isOccupied: true,
      })],
      ['r2', statusInfo({
        computedStatus: 'reserved',
        reservedBooking,
        hasReservationForToday: true,
        isReserved: true,
        isReservedToday: true,
      })],
      ['r3', statusInfo({})],
    ]);
  });
  afterEach(cleanup);

  it('phone: the sheet exposes "Edit booking notes" for an occupied room and opens the dialog', async () => {
    mocks.rooms = [occupiedRoom];
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /Room 101/ }));
    fireEvent.click(await screen.findByText('Edit booking notes'));

    expect(mocks.openBookingNotes).toHaveBeenCalledTimes(1);
    expect(mocks.openBookingNotes).toHaveBeenCalledWith(booking);
  });

  it('phone: the sheet exposes "Edit booking notes" for a reserved room and targets the reservation', async () => {
    mocks.rooms = [reservedRoom];
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /Room 102/ }));
    fireEvent.click(await screen.findByText('Edit booking notes'));

    expect(mocks.openBookingNotes).toHaveBeenCalledTimes(1);
    expect(mocks.openBookingNotes).toHaveBeenCalledWith(reservedBooking);
  });

  it('phone: no booking-notes action when the room has no booking attached', async () => {
    mocks.rooms = [vacantRoom];
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /Room 103/ }));
    // The sheet rendered — room-notes action still present for contrast.
    expect(await screen.findByText('Edit notes')).toBeTruthy();
    expect(screen.queryByText('Edit booking notes')).toBeNull();
  });

  it('desktop: the anchored menu carries the same action', async () => {
    mocks.isPhone = false;
    mocks.rooms = [occupiedRoom];
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /Room 101/ }));
    fireEvent.click(await screen.findByText('Edit booking notes'));

    expect(mocks.openBookingNotes).toHaveBeenCalledTimes(1);
    expect(mocks.openBookingNotes).toHaveBeenCalledWith(booking);
  });
});

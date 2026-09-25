// @vitest-environment jsdom
// Page-level coverage for RoomManagementPage:
//  - smoke + axe tests keep the grid rendering from empty data (master).
//  - "booking notes menu action" regression tests: the compact phone card
//    dropped the card's inline notes editor, so the menu (BottomSheet on
//    phone, anchored Menu on desktop) must keep it reachable.
//  - status-change workflows: the only wired quick action is mark-available
//    (card pill on dirty rooms, "Mark clean" menu primary on reserved-dirty);
//    every other status move goes through the shared RoomStatusUpdateDialog,
//    which handleSaveRoomStatus forwards to RoomsService verbatim.
// The page's real getMenuLayout runs here — workflow hooks are mocked at the
// barrel, most dialogs are stubbed, the card + context menu + the shared
// status dialog under test are not.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isPhone: true,
  openBookingNotes: vi.fn(),
  updateRoomStatus: vi.fn(),
  reload: vi.fn(),
  setRoomSearch: vi.fn(),
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
    updateRoomStatus: mocks.updateRoomStatus,
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
    reload: mocks.reload,
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
    setRoomSearch: mocks.setRoomSearch,
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

// Opens the surface a card click raises (anchored Menu on desktop, BottomSheet
// on phone) and waits for the one entry every room's housekeeping section has.
const openRoomMenu = async (roomNumber: string) => {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`Room ${roomNumber}`) }));
  await screen.findByText('Update status / block');
};

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

const dirtyRoom: Room = {
  id: 'r4',
  room_number: '104',
  room_type: 'deluxe',
  price_per_night: 120,
  available: false,
  max_occupancy: 2,
  status: 'dirty',
};

const reservedDirtyRoom: Room = {
  id: 'r5',
  room_number: '105',
  room_type: 'deluxe',
  price_per_night: 120,
  available: false,
  max_occupancy: 2,
  status: 'reserved_dirty',
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
  isAwaitingPayment: false,
  canCheckInReservation: false,
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

describe('RoomManagementPage — status-change workflows', () => {
  beforeEach(() => {
    mocks.isPhone = false;
    mocks.updateRoomStatus.mockClear();
    mocks.reload.mockClear();
    mocks.setRoomSearch.mockClear();
    mocks.rooms = [];
    mocks.roomBookings = new Map([['r1', booking]]);
    mocks.reservedBookings = new Map();
    mocks.infoByRoom = new Map([
      ['r1', statusInfo({
        computedStatus: 'occupied',
        booking,
        hasCheckedInBooking: true,
        isOccupied: true,
      })],
      ['r4', statusInfo({ computedStatus: 'dirty' })],
      ['r5', statusInfo({ computedStatus: 'reserved_dirty' })],
    ]);
  });
  afterEach(cleanup);

  it('marks a dirty room available from the card action with the canned note payload', async () => {
    mocks.rooms = [dirtyRoom];
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Mark available' }));

    await waitFor(() =>
      expect(mocks.updateRoomStatus).toHaveBeenCalledWith(dirtyRoom.id, {
        status: 'available',
        notes: 'Room marked as available',
      }),
    );
    expect(mocks.reload).toHaveBeenCalled();
  });

  it('marks a reserved-dirty room available from the menu primary action', async () => {
    mocks.rooms = [reservedDirtyRoom];
    renderPage();

    await openRoomMenu('105');
    // The card pill carries the same "Mark clean" label — scope to the menu.
    const menu = await screen.findByRole('menu');
    fireEvent.click(within(menu).getByRole('button', { name: 'Mark clean' }));

    await waitFor(() =>
      expect(mocks.updateRoomStatus).toHaveBeenCalledWith(reservedDirtyRoom.id, {
        status: 'available',
        notes: 'Room marked as available',
      }),
    );
    expect(mocks.reload).toHaveBeenCalled();
  });

  it('sends the requested status and notes verbatim from RoomStatusUpdateDialog', async () => {
    mocks.rooms = [occupiedRoom];
    renderPage();

    await openRoomMenu('101');
    fireEvent.click(screen.getByText('Update status / block'));
    const dialog = await screen.findByRole('dialog');

    fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: 'New status' }));
    fireEvent.click(await screen.findByRole('option', { name: /dirty/i }));
    fireEvent.change(within(dialog).getByLabelText(/notes/i), {
      target: { value: 'Carpet needs shampooing' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Update Status' }));

    // handleSaveRoomStatus deliberately does NOT coerce the requested status —
    // the backend owns the available→reserved decision.
    await waitFor(() =>
      expect(mocks.updateRoomStatus).toHaveBeenCalledWith(occupiedRoom.id, {
        status: 'dirty',
        notes: 'Carpet needs shampooing',
      }),
    );
    expect(mocks.reload).toHaveBeenCalled();
  });

  it('omits notes when the dialog submits none', async () => {
    mocks.rooms = [occupiedRoom];
    renderPage();

    await openRoomMenu('101');
    fireEvent.click(screen.getByText('Update status / block'));
    const dialog = await screen.findByRole('dialog');

    fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: 'New status' }));
    fireEvent.click(await screen.findByRole('option', { name: /maintenance/i }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Update Status' }));

    await waitFor(() =>
      expect(mocks.updateRoomStatus).toHaveBeenCalledWith(occupiedRoom.id, {
        status: 'maintenance',
        notes: undefined,
      }),
    );
  });

  it('typing a room number calls setRoomSearch', () => {
    mocks.rooms = [occupiedRoom];
    renderPage();

    fireEvent.change(screen.getByPlaceholderText('Room #'), { target: { value: '301' } });

    expect(mocks.setRoomSearch).toHaveBeenCalledWith('301');
  });
});

describe('RoomManagementPage — awaiting-payment holds', () => {
  // Room 210 regression: a website booking in `pending_confirmation` held the
  // room, but the grid showed it as available with no guest. The card must
  // show the guest, dates and a payment badge — without offering check-in,
  // which the backend refuses until the payment is confirmed.
  const awaitingBooking: BookingWithDetails = {
    ...reservedBooking,
    status: 'pending_confirmation',
    guest_name: 'Web Guest',
  };

  beforeEach(() => {
    mocks.isPhone = false;
    mocks.rooms = [reservedRoom];
    mocks.roomBookings = new Map();
    mocks.reservedBookings = new Map([['r2', awaitingBooking]]);
    mocks.infoByRoom = new Map([
      ['r2', statusInfo({
        computedStatus: 'reserved',
        reservedBooking: awaitingBooking,
        hasReservationForToday: true,
        isReserved: true,
        isReservedToday: true,
        isAwaitingPayment: true,
        canCheckInReservation: false,
      })],
    ]);
  });
  afterEach(cleanup);

  it('desktop: shows the guest and an awaiting-confirmation badge, with no check-in pill', () => {
    renderPage();

    expect(screen.getByText('Web Guest')).toBeTruthy();
    expect(screen.getByText('Awaiting payment confirmation')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Check in' })).toBeNull();
  });

  it('labels an unpaid hold as pending payment', () => {
    const unpaid = { ...awaitingBooking, status: 'pending_payment' };
    mocks.reservedBookings = new Map([['r2', unpaid]]);
    mocks.infoByRoom = new Map([
      ['r2', statusInfo({
        computedStatus: 'reserved',
        reservedBooking: unpaid,
        hasReservationForToday: true,
        isReserved: true,
        isReservedToday: true,
        isAwaitingPayment: true,
      })],
    ]);
    renderPage();

    expect(screen.getByText('Pending payment')).toBeTruthy();
  });

  it('phone: the card shows the badge and the menu offers no check-in', async () => {
    mocks.isPhone = true;
    renderPage();

    expect(screen.getByText('Awaiting payment confirmation')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Check in' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Room 102/ }));
    expect(await screen.findByText('Edit booking notes')).toBeTruthy();
    expect(screen.queryByText('Check-in guest')).toBeNull();
  });
});

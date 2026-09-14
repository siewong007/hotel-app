// Smoke coverage for RoomManagementPage: the workflow hooks are mocked at the
// barrel, dialogs stay closed, and the room grid renders from empty data.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  roomData: {
    rooms: [] as unknown[],
    guests: [] as unknown[],
    loading: false,
    error: null as string | null,
    roomBookings: [] as unknown[],
    reservedBookings: [] as unknown[],
    allBookingsData: [] as unknown[],
    reload: vi.fn(),
    reloadRooms: vi.fn(),
    reloadBookings: vi.fn(),
  },
  filters: {
    roomStatusFilter: 'all' as const,
    setRoomStatusFilter: vi.fn(),
    attrFilters: { smoking: false, daily: false, nodaily: false },
    toggleAttrFilter: vi.fn(),
    floorFilter: 'all' as const,
    setFloorFilter: vi.fn(),
    roomSearch: '',
    setRoomSearch: vi.fn(),
    prioritySort: false,
    togglePrioritySort: vi.fn(),
    floors: [] as number[],
    getRoomStatusInfo: vi.fn(),
    availableCount: 0,
    occupiedCount: 0,
    reservedCount: 0,
    dirtyCount: 0,
    maintenanceCount: 0,
    occupancyRate: 0,
    smokingCount: 0,
    dailyCleaningCount: 0,
    noCleaningCount: 0,
    filteredRooms: [] as unknown[],
    filterOptions: [] as unknown[],
  },
}));

const closedDialog = { dialogOpen: false, booking: null, openWithBooking: vi.fn(), close: vi.fn(), cancel: vi.fn(), checkIn: vi.fn(), processing: false };

vi.mock('../../../../router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../../../components/common/ConfirmProvider', () => ({
  useConfirm: () => vi.fn(),
}));

vi.mock('../../../../hooks/useCurrency', () => ({
  useCurrency: () => ({ format: (n: number) => `RM${Number(n).toFixed(2)}`, symbol: 'RM', currency: 'MYR' }),
}));

vi.mock('../../hooks', () => ({
  useRoomData: () => mocks.roomData,
  useRoomManagementFilters: () => mocks.filters,
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
    editedCleaningPreference: '',
    setEditedCleaningPreference: vi.fn(),
    savingBookingNotes: false,
    openBookingNotes: vi.fn(),
    closeBookingNotes: vi.fn(),
    saveBookingNotes: vi.fn(),
  }),
  useReservedCheckInWorkflow: () => ({
    ...closedDialog,
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
    ...closedDialog,
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

vi.mock('../UnifiedBooking/UnifiedBookingModal', () => ({
  default: () => null,
  BookingType: {},
}));

import RoomManagementPage from './RoomManagementPage';

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RoomManagementPage />
    </QueryClientProvider>,
  );
import { expectNoCriticalAxeViolations } from '../../../../test/axe';

describe('RoomManagementPage', () => {
  beforeEach(() => {
    mocks.roomData.loading = false;
    mocks.roomData.error = null;
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

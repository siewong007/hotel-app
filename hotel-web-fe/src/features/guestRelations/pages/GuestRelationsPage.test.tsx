import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Guest } from '../../../types';

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  hasPermission: vi.fn(),
  navigate: vi.fn(),
  searchParams: new URLSearchParams(),
  setSearchParams: vi.fn(),
  guestsPageQuery: {
    data: undefined as unknown,
    error: null as unknown,
    isError: false,
    isPending: false,
    refetch: vi.fn(),
  },
  lastGuestsPageParams: null as Record<string, unknown> | null,
  updateGuestMutation: { isPending: false, mutateAsync: vi.fn() },
  statTotals: {
    counts: {
      all: 0,
      member: 0,
      non: 0,
      incomplete: 0,
      tourist: 0,
      missingTourism: 0,
      vip: 0,
      blacklisted: 0,
      openRequests: 0,
      returning: 0,
      inHouse: 0,
      upcoming: 0,
      inactive: 0,
    },
    error: null as unknown,
    isPending: false,
    refetchAll: vi.fn(),
  },
}));

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({ hasPermission: mocks.hasPermission, user: { id: 3 } }),
}));

vi.mock('../../../router', () => ({
  useNavigate: () => mocks.navigate,
  useSearchParams: () => [mocks.searchParams, mocks.setSearchParams],
}));

vi.mock('../../../components/common/ConfirmProvider', () => ({
  useConfirm: () => mocks.confirm,
}));

// Identity debounce: the search field must reach the query params immediately
// for these tests instead of after the real 400ms timer.
vi.mock('../../../hooks/useDebouncedValue', () => ({
  useDebouncedValue: (value: unknown) => value,
}));

vi.mock('../../guests/hooks/useGuestQueries', () => ({
  useGuestsPage: (params: Record<string, unknown>) => {
    mocks.lastGuestsPageParams = params;
    return mocks.guestsPageQuery;
  },
  useGuests: () => ({ data: [], isPending: false }),
  useCreateGuest: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateGuest: () => mocks.updateGuestMutation,
  useApplyGuestTourismFromLastCheckIn: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteGuest: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useGuestBookings: () => ({ data: [], isPending: false }),
  useGuestCredits: () => ({ data: undefined, isPending: false }),
  useTransferGuestPortalAccount: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('../hooks/useGuestStatTotals', () => ({
  useGuestStatTotals: () => mocks.statTotals,
}));

vi.mock('../../rooms/hooks/useRoomQueries', () => ({
  useRooms: () => ({ data: [], refetch: vi.fn(), isPending: false }),
}));

// Heavy workflow modals — not under test here.
vi.mock('../../rooms/components/UnifiedBooking', () => ({ default: () => null }));
vi.mock('../../ekyc/components/EkycCreateDialog', () => ({ default: () => null }));
vi.mock('../components/GuestFormDialog', () => ({ default: () => null }));
vi.mock('../components/GuestBookingHistoryDialog', () => ({ default: () => null }));
vi.mock('../components/GuestCreditsDialog', () => ({ default: () => null }));
vi.mock('../components/GuestPortalAccountDialog', () => ({ default: () => null }));

import GuestRelationsPage from './GuestRelationsPage';

function buildGuest(overrides: Partial<Guest> = {}): Guest {
  return {
    id: 7,
    nick_name: 'Aisha Rahman',
    is_active: true,
    guest_type: 'member',
    tourism_type: 'local',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function setGuestsPageData(guests: Guest[], total = guests.length) {
  mocks.guestsPageQuery.data = { data: guests, total, page: 1, page_size: 50 };
}

describe('GuestRelationsPage', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        onchange: null,
        dispatchEvent: vi.fn(),
      }),
    });

    mocks.confirm.mockReset().mockResolvedValue(true);
    mocks.hasPermission.mockReset().mockReturnValue(true);
    mocks.navigate.mockReset();
    mocks.searchParams = new URLSearchParams();
    mocks.setSearchParams.mockReset();
    mocks.guestsPageQuery.error = null;
    mocks.guestsPageQuery.isError = false;
    mocks.guestsPageQuery.isPending = false;
    mocks.guestsPageQuery.refetch.mockReset();
    mocks.lastGuestsPageParams = null;
    mocks.statTotals.error = null;
    mocks.statTotals.refetchAll.mockReset();
    mocks.updateGuestMutation.mutateAsync.mockReset().mockResolvedValue({});
    setGuestsPageData([buildGuest()]);
  });

  afterEach(() => cleanup());

  it('renders the guest list from the paginated query', () => {
    render(<GuestRelationsPage />);
    expect(screen.getByText('Aisha Rahman')).toBeTruthy();
    expect(screen.getByText('Guests', { selector: 'h1, h2, h3, h4, h5, h6' })).toBeTruthy();
    expect(mocks.lastGuestsPageParams).toEqual({ page: 1, page_size: 50 });
  });

  it('denies access without guests:read', () => {
    mocks.hasPermission.mockReturnValue(false);
    render(<GuestRelationsPage />);
    expect(screen.getByText(/do not have permission/)).toBeTruthy();
  });

  it.each([
    ['VIP', { vip: true }],
    ['Blacklisted', { blacklisted: true }],
    ['Open requests', { has_open_support: true }],
    ['Members', { guest_type: 'member' }],
    ['Tourists', { tourism_type: 'foreign' }],
    ['Missing info', { missing_info: true }],
    ['Missing tourism', { missing_tourism: true }],
    ['Returning', { segment: 'returning' }],
    ['In house', { segment: 'in_house' }],
    ['Upcoming', { segment: 'upcoming' }],
    ['Inactive', { segment: 'inactive' }],
  ] as const)('the %s chip maps to the API filter params', (label, filter) => {
    const { container } = render(<GuestRelationsPage />);
    // The segment pills are the only buttons carrying aria-pressed (the stat
    // cards share their labels but aren't toggle buttons).
    const chip = Array.from(container.querySelectorAll('button[aria-pressed]')).find(
      (el) => el.textContent?.startsWith(label),
    );
    expect(chip, `chip "${label}"`).toBeTruthy();
    fireEvent.click(chip!);
    expect(mocks.lastGuestsPageParams).toEqual({ page: 1, page_size: 50, ...filter });
  });

  it('clears the segment param when the All guests chip is reselected', () => {
    const { container } = render(<GuestRelationsPage />);
    const chipByLabel = (label: string) =>
      Array.from(container.querySelectorAll('button[aria-pressed]')).find(
        (el) => el.textContent?.startsWith(label),
      );

    fireEvent.click(chipByLabel('In house')!);
    expect(mocks.lastGuestsPageParams).toEqual({ page: 1, page_size: 50, segment: 'in_house' });

    fireEvent.click(chipByLabel('All guests')!);
    expect(mocks.lastGuestsPageParams).toEqual({ page: 1, page_size: 50 });
  });

  it('renders an open-request badge on rows carrying has_open_support', () => {
    setGuestsPageData([buildGuest({ has_open_support: true })]);
    render(<GuestRelationsPage />);
    expect(screen.getByText('Open request')).toBeTruthy();
  });

  it('sends the debounced search through as the search param', async () => {
    render(<GuestRelationsPage />);
    fireEvent.change(
      screen.getByPlaceholderText(/Search by ID, name/),
      { target: { value: 'aisha' } },
    );
    await waitFor(() => {
      expect(mocks.lastGuestsPageParams).toEqual({ page: 1, page_size: 50, search: 'aisha' });
    });
  });

  it('honours the ?search= deep link forwarded by the /guest-config redirect', async () => {
    mocks.searchParams = new URLSearchParams('search=BK-1');
    render(<GuestRelationsPage />);
    await waitFor(() => {
      expect(mocks.lastGuestsPageParams).toEqual({ page: 1, page_size: 50, search: 'BK-1' });
    });
  });

  it('opens the detail drawer on row click and navigates to guest 360 from inside it', () => {
    render(<GuestRelationsPage />);

    // Row body click — the per-row eye icon was removed; the row itself is the target.
    fireEvent.click(screen.getByText('Aisha Rahman'));

    expect(screen.queryByRole('button', { name: 'View Aisha Rahman' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open guest 360' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/guest-relations/guests/7');
  });
});

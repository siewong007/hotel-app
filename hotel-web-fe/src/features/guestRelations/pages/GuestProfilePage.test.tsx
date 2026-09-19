import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Guest, GuestProfile } from '../../../types';

const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  profileQuery: {
    data: undefined as GuestProfile | undefined,
    error: null as unknown,
    isPending: false,
    refetch: vi.fn(),
  },
}));

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({ hasPermission: mocks.hasPermission, user: { id: 3 } }),
}));

vi.mock('../../../router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('../../guests/hooks/useGuestQueries', () => ({
  useGuestProfile: () => mocks.profileQuery,
  useGuests: () => ({ data: [], isPending: false }),
  useUpdateGuest: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('../../rooms/hooks/useRoomQueries', () => ({
  useRooms: () => ({ data: [], refetch: vi.fn(), isPending: false }),
}));

// Tabs and dialogs are not under test — markers keep the assertions on the
// page's own composition (tab gating, header wiring).
vi.mock('../components/tabs/OverviewTab', () => ({ default: () => <div>OverviewTab</div> }));
vi.mock('../components/tabs/StaysTab', () => ({ default: () => <div>StaysTab</div> }));
vi.mock('../components/tabs/PreferencesTab', () => ({ default: () => <div>PreferencesTab</div> }));
vi.mock('../components/tabs/InteractionsTab', () => ({ default: () => <div>InteractionsTab</div> }));
vi.mock('../components/tabs/LoyaltyVouchersTab', () => ({ default: () => <div>LoyaltyVouchersTab</div> }));
vi.mock('../components/tabs/SupportFeedbackTab', () => ({ default: () => <div>SupportFeedbackTab</div> }));
vi.mock('../components/tabs/CommunicationTab', () => ({ default: () => <div>CommunicationTab</div> }));
vi.mock('../../rooms/components/UnifiedBooking', () => ({ default: () => null }));
vi.mock('../components/GuestFormDialog', () => ({ default: () => null }));
vi.mock('../components/OpenSupportDialog', () => ({ default: () => null }));

import React from 'react';
import GuestProfilePage from './GuestProfilePage';
import { expectNoAxeViolations } from '../../../test/axe';

function buildProfile(overrides: Partial<Guest> = {}): GuestProfile {
  return {
    guest: {
      id: 7,
      nick_name: 'Aisha Rahman',
      is_active: true,
      guest_type: 'member',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      ...overrides,
    },
    summary: {
      completed_stays: 0,
      total_nights: 0,
      total_room_revenue: '0.00',
      outstanding_balance: '0.00',
      total_bookings: 0,
    },
    reservations: [],
    duplicate_candidates: [],
  };
}

const ALWAYS = () => true;

describe('GuestProfilePage', () => {
  beforeEach(() => {
    mocks.hasPermission.mockReset().mockImplementation(ALWAYS);
    mocks.profileQuery.data = buildProfile();
    mocks.profileQuery.error = null;
    mocks.profileQuery.isPending = false;
    mocks.profileQuery.refetch.mockReset();
  });

  afterEach(() => cleanup());

  it('denies access without guests:read', () => {
    mocks.hasPermission.mockReturnValue(false);
    render(<GuestProfilePage guestId="7" />);
    expect(screen.getByText(/do not have permission/)).toBeTruthy();
  });

  it('warns on a non-numeric guest id', () => {
    render(<GuestProfilePage guestId="abc" />);
    expect(screen.getByText('Invalid guest ID.')).toBeTruthy();
  });

  it('shows all seven tabs to a fully-permissioned staffer', () => {
    render(<GuestProfilePage guestId="7" />);
    for (const label of [
      'Overview',
      'Stays',
      'Preferences',
      'Interactions',
      'Loyalty & Vouchers',
      'Support & Feedback',
      'Communication',
    ]) {
      expect(screen.getByRole('tab', { name: label })).toBeTruthy();
    }
  });

  it('hides the Support & Feedback tab without support:read', () => {
    mocks.hasPermission.mockImplementation(
      (perm: string) => perm !== 'support:read' && perm !== 'support:write',
    );
    render(<GuestProfilePage guestId="7" />);
    expect(screen.queryByRole('tab', { name: 'Support & Feedback' })).toBeNull();
    // Sibling gated tab still shows when its own permission holds.
    expect(screen.getByRole('tab', { name: 'Communication' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Interactions' })).toBeTruthy();
  });

  it('hides the Communication tab without communications:read', () => {
    mocks.hasPermission.mockImplementation(
      (perm: string) => perm !== 'communications:read' && perm !== 'communications:manage',
    );
    render(<GuestProfilePage guestId="7" />);
    expect(screen.queryByRole('tab', { name: 'Communication' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Support & Feedback' })).toBeTruthy();
  });

  it('swaps the visible panel when a tab is clicked', () => {
    render(<GuestProfilePage guestId="7" />);
    expect(screen.getByText('OverviewTab')).toBeTruthy();
    expect(screen.queryByText('StaysTab')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Stays' }));

    expect(screen.getByText('StaysTab')).toBeTruthy();
    expect(screen.queryByText('OverviewTab')).toBeNull();
  });

  it('renders the 360 header chips for VIP + blacklisted guests', () => {
    mocks.profileQuery.data = buildProfile({
      first_name: 'Aisha',
      last_name: 'Rahman',
      vip_status: 'vvip',
      is_blacklisted: true,
    });
    render(<GuestProfilePage guestId="7" />);
    expect(screen.getByRole('heading', { name: 'Aisha Rahman' })).toBeTruthy();
    expect(screen.getByText('Vvip')).toBeTruthy();
    expect(screen.getByText('Blacklisted')).toBeTruthy();
    expect(screen.getByText('Member')).toBeTruthy();
  });

  it('has no axe violations on the populated guest 360 page', async () => {
    const { container } = render(<GuestProfilePage guestId="7" />);

    expect(screen.getByRole('tab', { name: 'Overview' })).toBeTruthy();
    await expectNoAxeViolations(container);
  });
});

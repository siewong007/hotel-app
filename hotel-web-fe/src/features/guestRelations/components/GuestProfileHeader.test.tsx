import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Guest, GuestSummary } from '../../../types';
import GuestProfileHeader from './GuestProfileHeader';

function buildGuest(overrides: Partial<Guest> = {}): Guest {
  return {
    id: 7,
    nick_name: 'JD',
    is_active: true,
    guest_type: 'non_member',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function buildSummary(overrides: Partial<GuestSummary> = {}): GuestSummary {
  return {
    completed_stays: 0,
    total_nights: 0,
    total_room_revenue: '0.00',
    outstanding_balance: '0.00',
    total_bookings: 0,
    ...overrides,
  };
}

function renderHeader(overrides: Partial<React.ComponentProps<typeof GuestProfileHeader>> = {}) {
  const props: React.ComponentProps<typeof GuestProfileHeader> = {
    guest: buildGuest(),
    summary: buildSummary(),
    duplicateCount: 0,
    canEdit: true,
    canAddNote: true,
    canOpenSupport: true,
    onEdit: vi.fn(),
    onNewBooking: vi.fn(),
    onAddNote: vi.fn(),
    onOpenSupport: vi.fn(),
    ...overrides,
  };
  render(<GuestProfileHeader {...props} />);
  return props;
}

afterEach(() => cleanup());

describe('GuestProfileHeader', () => {
  it('renders the legal name once both halves exist, with the booking nickname alongside', () => {
    renderHeader({ guest: buildGuest({ first_name: 'Jane', last_name: 'Doe', nick_name: 'JD' }) });
    expect(screen.getByRole('heading', { name: 'Jane Doe' })).toBeTruthy();
    expect(screen.getByText(/booked as JD/)).toBeTruthy();
  });

  it('falls back to the booking nickname when the legal name is incomplete', () => {
    renderHeader({ guest: buildGuest({ first_name: 'Jane', nick_name: 'JD' }) });
    expect(screen.getByRole('heading', { name: 'JD' })).toBeTruthy();
    expect(screen.queryByText(/booked as/)).toBeNull();
  });

  it('shows the VIP chip with the status label when vip_status is set', () => {
    renderHeader({ guest: buildGuest({ vip_status: 'vvip' }) });
    expect(screen.getByText('Vvip')).toBeTruthy();
  });

  it('hides the VIP chip when vip_status is absent or blank', () => {
    const { rerender } = render(
      <GuestProfileHeader
        guest={buildGuest({})}
        summary={buildSummary()}
        duplicateCount={0}
        canEdit={false}
        canAddNote={false}
        canOpenSupport={false}
        onEdit={vi.fn()}
        onNewBooking={vi.fn()}
        onAddNote={vi.fn()}
        onOpenSupport={vi.fn()}
      />,
    );
    expect(document.querySelector('[class*="MuiChip"]')).toBeNull();
    rerender(
      <GuestProfileHeader
        guest={buildGuest({ vip_status: '  ' })}
        summary={buildSummary()}
        duplicateCount={0}
        canEdit={false}
        canAddNote={false}
        canOpenSupport={false}
        onEdit={vi.fn()}
        onNewBooking={vi.fn()}
        onAddNote={vi.fn()}
        onOpenSupport={vi.fn()}
      />,
    );
    expect(document.querySelector('[class*="MuiChip"]')).toBeNull();
  });

  it('shows the Blacklisted chip only when the flag is set', () => {
    renderHeader({ guest: buildGuest({ is_blacklisted: true, blacklist_reason: 'Chargebacks' }) });
    expect(screen.getByText('Blacklisted')).toBeTruthy();
  });

  it('renders Member and Returning-guest chips from guest_type and stay count', () => {
    renderHeader({
      guest: buildGuest({ guest_type: 'member' }),
      summary: buildSummary({ completed_stays: 2 }),
    });
    expect(screen.getByText('Member')).toBeTruthy();
    expect(screen.getByText('Returning guest')).toBeTruthy();
  });

  it('gates the quick actions on the can* props', () => {
    renderHeader({ canEdit: false, canAddNote: false, canOpenSupport: false });
    expect(screen.getByRole('button', { name: /New booking/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Edit/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Add note/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Open support/ })).toBeNull();
  });
});

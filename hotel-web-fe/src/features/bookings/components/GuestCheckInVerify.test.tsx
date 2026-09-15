import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderPage } from '../../../test/renderPage';
import { expectNoAxeViolations } from '../../../test/axe';
import type { Booking, Guest } from '../../../types';

const mocks = vi.hoisted(() => ({
  getBooking: vi.fn(),
}));

vi.mock('../../../api', () => ({
  GuestPortalService: {
    getBooking: (...args: unknown[]) => mocks.getBooking(...args),
  },
}));

import GuestCheckInVerify from './GuestCheckInVerify';

const booking: Booking = {
  id: 'bk-1',
  folio_number: 'FOL-1001',
  guest_id: 'g-1',
  room_id: 'r-101',
  room_type: 'Deluxe King',
  check_in_date: '2026-09-20',
  check_out_date: '2026-09-23',
  number_of_guests: 2,
  total_amount: 640,
  status: 'confirmed',
};

const guest: Guest = {
  id: 1,
  first_name: 'Aminah',
  last_name: 'Yusof',
  nick_name: 'Aminah',
  email: 'aminah@example.com',
  phone: '+60123456789',
  guest_type: 'non_member',
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

describe('GuestCheckInVerify', () => {
  it('shows an error state when no access token is present', async () => {
    renderPage(<GuestCheckInVerify />, { route: '/guest-checkin/verify' });
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(mocks.getBooking).not.toHaveBeenCalled();
  });

  it('loads the booking for the token in the URL and shows stay details', async () => {
    mocks.getBooking.mockResolvedValue({ booking, guest });
    renderPage(<GuestCheckInVerify />, { route: '/guest-checkin/verify?token=tk-abc' });
    await waitFor(() => expect(mocks.getBooking).toHaveBeenCalledWith('tk-abc'));
    expect(await screen.findByRole('heading', { level: 1 })).toBeTruthy();
    expect(screen.getByText('FOL-1001')).toBeTruthy();
    expect(screen.getByText('Aminah')).toBeTruthy();
    expect(screen.getByText('Deluxe King')).toBeTruthy();
    expect(screen.getByRole('button', { name: /continue/i })).toBeTruthy();
  });

  it('shows the error state when the booking lookup fails', async () => {
    mocks.getBooking.mockRejectedValue(new Error('not found'));
    renderPage(<GuestCheckInVerify />, { route: '/guest-checkin/verify?token=tk-bad' });
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button')).toBeTruthy();
  });

  it('reports no axe violations in the populated state', async () => {
    mocks.getBooking.mockResolvedValue({ booking, guest });
    const { container } = renderPage(<GuestCheckInVerify />, {
      route: '/guest-checkin/verify?token=tk-abc',
    });
    await screen.findByText('FOL-1001');
    await expectNoAxeViolations(container);
  });
});

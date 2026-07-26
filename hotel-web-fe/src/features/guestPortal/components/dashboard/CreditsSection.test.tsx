import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  credits: vi.fn(),
}));

vi.mock('../../api/guestPortalDashboard.service', () => ({
  GuestPortalDashboardService: {
    credits: (...args: unknown[]) => mocks.credits(...args),
  },
}));

import { CreditsSection } from './PortalDashboardSections';

describe('CreditsSection', () => {
  beforeEach(() => {
    mocks.credits.mockReset();
  });

  afterEach(cleanup);

  it('shows the balance broken down by room type, because credits are not transferable', async () => {
    mocks.credits.mockResolvedValue({
      total_nights_available: 5,
      credits_by_room_type: [
        { room_type_id: 7, room_type_code: 'DLX', room_type_name: 'Deluxe Room', nights_available: 3 },
        { room_type_id: 9, room_type_code: 'STE', room_type_name: 'Suite', nights_available: 2 },
      ],
    });

    render(<CreditsSection token="guest-token" />);

    expect(await screen.findByText('5')).toBeTruthy();
    expect(screen.getByText('Across 2 room types')).toBeTruthy();
    expect(screen.getByText('Deluxe Room')).toBeTruthy();
    expect(screen.getByText('DLX · 3 free nights')).toBeTruthy();
    expect(screen.getByText('Suite')).toBeTruthy();
    expect(screen.getByText('STE · 2 free nights')).toBeTruthy();
    expect(mocks.credits).toHaveBeenCalledWith('guest-token');
  });

  it('uses the singular form for a single night', async () => {
    mocks.credits.mockResolvedValue({
      total_nights_available: 1,
      credits_by_room_type: [
        { room_type_id: 7, room_type_code: 'DLX', room_type_name: 'Deluxe Room', nights_available: 1 },
      ],
    });

    render(<CreditsSection token="guest-token" />);

    expect(await screen.findByText('DLX · 1 free night')).toBeTruthy();
    expect(screen.getByText('Across 1 room type')).toBeTruthy();
  });

  it('explains the empty state rather than showing a bare zero', async () => {
    mocks.credits.mockResolvedValue({ total_nights_available: 0, credits_by_room_type: [] });

    render(<CreditsSection token="guest-token" />);

    expect(
      await screen.findByText(
        'You have no complimentary nights right now. The hotel will let you know when you earn some.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText('Nights available')).toBeNull();
  });

  it('offers a retry when the balance cannot be loaded', async () => {
    mocks.credits.mockRejectedValue(new Error('network down'));

    render(<CreditsSection token="guest-token" />);

    expect(await screen.findByText('Unable to load your complimentary nights right now.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});

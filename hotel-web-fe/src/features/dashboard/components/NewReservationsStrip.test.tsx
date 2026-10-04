import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const getNewReservations = vi.hoisted(() => vi.fn());

vi.mock('../../../api/bookings.service', () => ({
  BookingsService: { getNewReservations },
}));

vi.mock('../../../router', () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

import { NewReservationsStrip } from './NewReservationsStrip';

describe('NewReservationsStrip', () => {
  afterEach(() => {
    cleanup();
    getNewReservations.mockReset();
  });

  it('lists only what the new-reservations endpoint returns', async () => {
    getNewReservations.mockResolvedValue({
      visible_from: '14:00',
      reservations: [
        {
          id: 9,
          guest_name: 'Aisha Rahman',
          room_number: '1204',
          check_in_date: '2026-10-04',
          check_out_date: '2026-10-06',
          status: 'confirmed',
        },
      ],
    });

    render(<NewReservationsStrip />);

    expect(await screen.findByText(/Aisha Rahman/)).toBeTruthy();
    expect(screen.getByText(/14:00/)).toBeTruthy();
    expect(screen.getByRole('link').getAttribute('href')).toBe('/bookings/9');
  });

  it('says when nothing has appeared yet', async () => {
    getNewReservations.mockResolvedValue({ visible_from: '14:00', reservations: [] });

    render(<NewReservationsStrip />);

    expect(await screen.findByText('No new reservations to show yet.')).toBeTruthy();
  });
});

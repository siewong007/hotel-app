import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderPage } from '../../../test/renderPage';
import { expectNoAxeViolations } from '../../../test/axe';

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  setBookingAccessToken: vi.fn(),
}));

vi.mock('../../../api', () => ({
  GuestPortalService: {
    verify: (...args: unknown[]) => mocks.verify(...args),
  },
}));

vi.mock('../../guestPortal/api/bookingAccessTokenStore', () => ({
  setBookingAccessToken: (...args: unknown[]) => mocks.setBookingAccessToken(...args),
}));

import GuestCheckInLanding from './GuestCheckInLanding';

describe('GuestCheckInLanding', () => {
  it('renders the check-in form with its heading and fields', async () => {
    renderPage(<GuestCheckInLanding />, { route: '/guest-checkin' });
    expect(await screen.findByRole('heading', { level: 1 })).toBeTruthy();
    expect(screen.getAllByRole('textbox').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('button')).toBeTruthy();
  });

  it('rejects an empty submission with an inline error', async () => {
    renderPage(<GuestCheckInLanding />, { route: '/guest-checkin' });
    fireEvent.submit(await screen.findByRole('button'));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it('verifies the booking and stores the booking access token', async () => {
    mocks.verify.mockResolvedValue({ token: 'booking-token' });
    renderPage(<GuestCheckInLanding />, { route: '/guest-checkin' });
    const [bookingField, nameField] = await screen.findAllByRole('textbox');
    fireEvent.change(bookingField, { target: { value: 'BK-1001' } });
    fireEvent.change(nameField, { target: { value: 'Aminah' } });
    fireEvent.submit(screen.getByRole('button'));
    await waitFor(() =>
      expect(mocks.verify).toHaveBeenCalledWith({ booking_number: 'BK-1001', name: 'Aminah' }),
    );
    await waitFor(() => expect(mocks.setBookingAccessToken).toHaveBeenCalledWith('booking-token'));
  });

  it('reports no axe violations', async () => {
    const { container } = renderPage(<GuestCheckInLanding />, { route: '/guest-checkin' });
    await screen.findByRole('heading', { level: 1 });
    await expectNoAxeViolations(container);
  });
});

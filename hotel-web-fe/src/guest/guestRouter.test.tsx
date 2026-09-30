import { cleanup, render, screen, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';

// Stub the lazy portal pages: this suite only asserts which surface
// GuestPortalRoute selects for a given ?view= value.
vi.mock('../features/guestPortal/components/PortalDashboardPage', () => ({
  default: () => <div data-testid="dashboard-page" />,
}));
vi.mock('../features/guestPortal/booking/PortalBookingPage', () => ({
  default: () => <div data-testid="booking-page" />,
}));

import { GuestPortalRoute } from './guestRouter';

function buildRouter(initial: string) {
  const rootRoute = createRootRoute({});
  const route = createRoute({
    getParentRoute: () => rootRoute,
    path: 'guest-portal',
    component: GuestPortalRoute,
  });
  return createRouter({
    routeTree: rootRoute.addChildren([route]),
    history: createMemoryHistory({ initialEntries: [initial] }),
  });
}

afterEach(cleanup);

describe('GuestPortalRoute', () => {
  it('renders the dashboard for /guest-portal without a view param', async () => {
    const router = buildRouter('/guest-portal');
    render(<RouterProvider router={router} />);

    expect(await screen.findByTestId('dashboard-page')).toBeTruthy();
    expect(screen.queryByTestId('booking-page')).toBeNull();
  });

  it('renders the booking surface for /guest-portal?view=booking', async () => {
    const router = buildRouter('/guest-portal?view=booking');
    render(<RouterProvider router={router} />);

    expect(await screen.findByTestId('booking-page')).toBeTruthy();
    expect(screen.queryByTestId('dashboard-page')).toBeNull();
  });

  it('switches to the booking surface when view=booking arrives via in-app navigation', async () => {
    const router = buildRouter('/guest-portal');
    render(<RouterProvider router={router} />);
    expect(await screen.findByTestId('dashboard-page')).toBeTruthy();

    // Mirror the shell CTA: <Link to="/guest-portal?view=booking"> — a raw
    // string `to` is what the compat Link actually passes to router.navigate.
    await act(() => router.navigate({ to: '/guest-portal?view=booking' as never }));

    expect(await screen.findByTestId('booking-page')).toBeTruthy();
    expect(screen.queryByTestId('dashboard-page')).toBeNull();
  });

  it('switches back to the dashboard when the view param is removed', async () => {
    const router = buildRouter('/guest-portal?view=booking');
    render(<RouterProvider router={router} />);
    expect(await screen.findByTestId('booking-page')).toBeTruthy();

    await act(() => router.navigate({ to: '/guest-portal' }));

    expect(await screen.findByTestId('dashboard-page')).toBeTruthy();
    expect(screen.queryByTestId('booking-page')).toBeNull();
  });
});

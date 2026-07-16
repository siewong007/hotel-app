import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  userType: 'guest' as 'admin' | 'guest',
}));

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { user_type: mocks.userType },
  }),
}));

vi.mock('../router', () => ({
  Navigate: ({ to }: { to: string }) => <div>Redirect to {to}</div>,
}));

vi.mock('../router/renderRouteFromRegistry', () => ({
  RouteById: ({ id }: { id: string }) => <div>Route {id}</div>,
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (definition: unknown) => definition,
}));

import { MyBookingsRoute } from '../features/bookings/components/MyBookingsRoute';

describe('MyBookingsRoute', () => {
  beforeEach(() => {
    mocks.userType = 'guest';
  });

  afterEach(cleanup);

  it('sends guest accounts to the guest portal', () => {
    render(<MyBookingsRoute />);
    expect(screen.getByText('Redirect to /guest-portal')).toBeTruthy();
  });

  it('keeps the legacy page available to non-guest accounts', () => {
    mocks.userType = 'admin';
    render(<MyBookingsRoute />);
    expect(screen.getByText('Route my-bookings')).toBeTruthy();
  });
});

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  isAuthenticated: false,
  isLoading: true,
  user: null as { user_type?: string } | null,
}));

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => auth,
}));

vi.mock('@tanstack/react-router', () => ({
  Navigate: ({ to }: { to: string }) => <div>redirect:{to}</div>,
}));

import { UnauthOnlyRoute } from './RouteGuards';

afterEach(() => {
  cleanup();
  auth.isAuthenticated = false;
  auth.isLoading = true;
  auth.user = null;
});

describe('UnauthOnlyRoute', () => {
  it('renders the public screen while session restore is still in flight', () => {
    auth.isLoading = true;
    render(
      <UnauthOnlyRoute>
        <div>complete payment</div>
      </UnauthOnlyRoute>,
    );
    expect(screen.getByText('complete payment')).toBeTruthy();
    expect(screen.queryByText(/redirect:/)).toBeNull();
  });
});

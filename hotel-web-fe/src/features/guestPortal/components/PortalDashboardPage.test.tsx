import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  restartSignIn: vi.fn(),
  retry: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('../../../router', () => ({
  Navigate: () => null,
  useNavigate: () => mocks.navigate,
}));

vi.mock('../hooks/usePortalSessionBootstrap', () => ({
  usePortalSessionBootstrap: () => ({
    token: null,
    status: 'error',
    error: 'We could not open your guest portal. Please try again.',
    canRetry: true,
    needsLogin: false,
    retry: mocks.retry,
    restartSignIn: mocks.restartSignIn,
    signOut: mocks.signOut,
  }),
}));

import { PortalDashboardPage } from './PortalDashboardPage';

describe('PortalDashboardPage session bootstrap', () => {
  beforeEach(() => {
    mocks.navigate.mockReset();
    mocks.restartSignIn.mockReset();
    mocks.retry.mockReset();
    mocks.signOut.mockReset();
  });

  afterEach(cleanup);

  it('offers a retry when a portal session cannot be opened', () => {
    render(<PortalDashboardPage />);

    expect(screen.getByText('We could not open your guest portal. Please try again.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(mocks.retry).toHaveBeenCalledTimes(1);
  });
});

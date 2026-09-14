import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  verifyEmail: vi.fn(),
  searchParams: new URLSearchParams('token=tok_123'),
  navigate: vi.fn(),
}));

vi.mock('../../../router', () => ({
  useNavigate: () => mocks.navigate,
  useSearchParams: () => [mocks.searchParams, vi.fn()],
}));

vi.mock('../../../api', () => ({
  AuthService: { verifyEmail: mocks.verifyEmail },
}));

import EmailVerificationPage from './EmailVerificationPage';
import { expectNoCriticalAxeViolations } from '../../../test/axe';
import { buildKyHttpError } from '../../../api/testSupport/httpError';

describe('EmailVerificationPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchParams = new URLSearchParams('token=tok_123');
    mocks.verifyEmail.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it('shows an error immediately when the link has no token', async () => {
    mocks.searchParams = new URLSearchParams();
    render(<EmailVerificationPage />);
    await waitFor(() =>
      expect(screen.getByText(/No token provided/)).toBeTruthy(),
    );
    expect(mocks.verifyEmail).not.toHaveBeenCalled();
  });

  it('verifies the token and shows success', async () => {
    render(<EmailVerificationPage />);
    await waitFor(() => expect(mocks.verifyEmail).toHaveBeenCalledWith('tok_123'));
    await waitFor(() =>
      expect(screen.getByText(/verified successfully/i)).toBeTruthy(),
    );
  });

  it('surfaces a failure when verification rejects', async () => {
    // The page reads the server's {"error"} body via guestErrorMessage — a
    // plain Error would only ever exercise the friendly fallback.
    mocks.verifyEmail.mockRejectedValue(
      buildKyHttpError(400, { error: 'This verification link has expired.' })
    );
    render(<EmailVerificationPage />);
    await waitFor(() =>
      expect(screen.getByText('This verification link has expired.')).toBeTruthy(),
    );
  });

  it('points a failed verification at sign-in instead of a dead end', async () => {
    mocks.verifyEmail.mockRejectedValue(
      buildKyHttpError(400, { error: 'expired' })
    );
    render(<EmailVerificationPage />);

    const backToLogin = await screen.findByRole('button', { name: /back to login/i });
    expect(screen.queryByText(/contact support/i)).toBeNull();

    fireEvent.click(backToLogin);
    expect(mocks.navigate).toHaveBeenCalledWith('/login');
  });

  it('reports no critical axe violations', async () => {
    const { container } = render(<EmailVerificationPage />);
    await waitFor(() => expect(mocks.verifyEmail).toHaveBeenCalled());
    await expectNoCriticalAxeViolations(container);
  });
});

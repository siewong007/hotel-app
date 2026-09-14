import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
    mocks.verifyEmail.mockRejectedValue(new Error('expired'));
    render(<EmailVerificationPage />);
    await waitFor(() => expect(screen.getByText(/expired/i)).toBeTruthy());
  });

  it('reports no critical axe violations', async () => {
    const { container } = render(<EmailVerificationPage />);
    await waitFor(() => expect(mocks.verifyEmail).toHaveBeenCalled());
    await expectNoCriticalAxeViolations(container);
  });
});

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isAuthenticated: true,
  isLoading: false,
  searchParams: new URLSearchParams(),
}));

vi.mock('../../../router', () => ({
  useNavigate: () => vi.fn(),
  useSearchParams: () => [mocks.searchParams, vi.fn()],
  Navigate: ({ to }: { to: string }) => <div data-testid="navigate" data-to={to} />,
}));

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: mocks.isAuthenticated, isLoading: mocks.isLoading }),
}));

vi.mock('./TwoFactorSetup', () => ({
  default: () => <div data-testid="twofactor-setup" />,
}));

import EnrollTwoFactorPage from './EnrollTwoFactorPage';
import { expectNoCriticalAxeViolations } from '../../../test/axe';

describe('EnrollTwoFactorPage', () => {
  beforeEach(() => {
    mocks.isAuthenticated = true;
    mocks.isLoading = false;
    mocks.searchParams = new URLSearchParams();
  });

  afterEach(cleanup);

  it('renders the enrolment card for a signed-in user', () => {
    render(<EnrollTwoFactorPage />);
    expect(screen.getByTestId('twofactor-setup')).toBeTruthy();
  });

  it('redirects to login when unauthenticated', () => {
    mocks.isAuthenticated = false;
    render(<EnrollTwoFactorPage />);
    expect(screen.getByTestId('navigate').getAttribute('data-to')).toBe('/login');
  });

  it('renders nothing while auth state resolves', () => {
    mocks.isLoading = true;
    const { container } = render(<EnrollTwoFactorPage />);
    expect(container.firstChild).toBeNull();
  });

  it('reports no critical axe violations', async () => {
    const { container } = render(<EnrollTwoFactorPage />);
    await expectNoCriticalAxeViolations(container);
  });
});

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SESSION_ERROR = 'We could not open your guest portal. Please try again.';

const FAILED_SESSION = {
  token: null,
  status: 'error',
  error: SESSION_ERROR,
  canRetry: true,
  needsLogin: false,
};

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  restartSignIn: vi.fn(),
  retry: vi.fn(),
  signOut: vi.fn(),
  session: {
    token: null,
    status: 'error',
    error: 'We could not open your guest portal. Please try again.',
    canRetry: true,
    needsLogin: false,
  } as {
    token: string | null;
    status: string;
    error: string | null;
    canRetry: boolean;
    needsLogin: boolean;
  },
  search: '',
}));

vi.mock('../../../router', () => ({
  Navigate: () => null,
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ search: mocks.search }),
}));

vi.mock('../hooks/usePortalSessionBootstrap', () => ({
  usePortalSessionBootstrap: () => ({
    ...mocks.session,
    retry: mocks.retry,
    restartSignIn: mocks.restartSignIn,
    signOut: mocks.signOut,
  }),
}));

// The sections fetch portal data of their own; this suite only covers the page
// shell around them.
vi.mock('./dashboard/PortalDashboardSections', () => ({
  OverviewSection: () => <div data-testid="overview-section" />,
  BookingsSection: () => <div data-testid="bookings-section" />,
  PointsHistorySection: () => <div data-testid="points-history-section" />,
  EmbeddedSection: () => <div data-testid="embedded-section" />,
}));

vi.mock('./dashboard/IdentitySection', () => ({
  IdentitySection: () => <div data-testid="identity-section" />,
}));

import { PortalDashboardPage } from './PortalDashboardPage';
import { expectNoAxeViolations } from '../../../test/axe';

describe('PortalDashboardPage session bootstrap', () => {
  beforeEach(() => {
    mocks.navigate.mockReset();
    mocks.restartSignIn.mockReset();
    mocks.retry.mockReset();
    mocks.signOut.mockReset();
    mocks.session = { ...FAILED_SESSION };
    mocks.search = '';
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('offers a retry when a portal session cannot be opened', () => {
    render(<PortalDashboardPage />);

    expect(screen.getByText('We could not open your guest portal. Please try again.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(mocks.retry).toHaveBeenCalledTimes(1);
  });
});

describe('PortalDashboardPage section dispatch', () => {
  beforeEach(() => {
    mocks.navigate.mockReset();
    mocks.signOut.mockReset();
    mocks.session = { token: 'portal-token', status: 'ready', error: null, canRetry: false, needsLogin: false };
    mocks.search = '';
  });

  afterEach(cleanup);

  it('renders the overview for the default section', () => {
    render(<PortalDashboardPage />);

    expect(screen.getByTestId('overview-section')).toBeTruthy();
  });

  it('keeps the rendered section in step with ?section', () => {
    mocks.search = '?section=stays';
    render(<PortalDashboardPage />);

    expect(screen.getByTestId('bookings-section')).toBeTruthy();
    expect(screen.queryByTestId('overview-section')).toBeNull();
  });

  // The section dispatch is an if-chain with no exhaustiveness check: a section
  // registered in PORTAL_SECTIONS but missing a branch here renders a blank
  // card instead of failing the build. This asserts the branch exists.
  it('renders the identity section for ?section=identity', () => {
    mocks.search = '?section=identity';
    render(<PortalDashboardPage />);

    expect(screen.getByTestId('identity-section')).toBeTruthy();
  });

  // Sign out lives in GuestPortalShell's account menu — one control, not one
  // per section header.
  it('leaves account chrome to the shell (no in-page sign out)', () => {
    render(<PortalDashboardPage />);

    expect(screen.queryByRole('button', { name: 'Sign Out' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
  });

  it('has no axe violations in the portal shell', async () => {
    const { container } = render(<PortalDashboardPage />);

    expect(screen.getByTestId('overview-section')).toBeTruthy();
    await expectNoAxeViolations(container);
  });
});

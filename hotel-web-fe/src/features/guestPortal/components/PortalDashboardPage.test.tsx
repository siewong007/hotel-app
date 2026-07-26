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

import { PortalDashboardPage } from './PortalDashboardPage';

// A name that only this test could produce, so an assertion that it is ABSENT
// actually proves the page does not render the configured hotel name.
const STUB_HOTEL_NAME = 'Wordmark Regency';

const stubHotelSettings = () => {
  vi.stubGlobal('localStorage', {
    getItem: (key: string) =>
      key === 'hotelSettings' ? JSON.stringify({ hotel_name: STUB_HOTEL_NAME }) : null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
    key: () => null,
    length: 0,
  });
};

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

describe('PortalDashboardPage header', () => {
  beforeEach(() => {
    mocks.navigate.mockReset();
    mocks.signOut.mockReset();
    mocks.session = { token: 'portal-token', status: 'ready', error: null, canRetry: false, needsLogin: false };
    mocks.search = '';
    stubHotelSettings();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('heads the card with the section title alone', () => {
    render(<PortalDashboardPage />);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('My stay');
    expect(screen.getByTestId('overview-section')).toBeTruthy();
  });

  // GuestPortalShell's sticky header already shows the hotel name as the logo
  // wordmark; repeating it in the card below was a visible duplicate.
  it('does not repeat the hotel name below the shell logo', () => {
    render(<PortalDashboardPage />);

    expect(screen.queryByText(STUB_HOTEL_NAME)).toBeNull();
  });

  it('keeps the section title in step with ?section', () => {
    mocks.search = '?section=stays';
    render(<PortalDashboardPage />);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('My stays');
    expect(screen.getByTestId('bookings-section')).toBeTruthy();
    expect(screen.queryByText(STUB_HOTEL_NAME)).toBeNull();
  });
});

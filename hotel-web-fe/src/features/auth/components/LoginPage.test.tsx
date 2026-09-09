import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  search: 'account=admin',
  setSearchParams: vi.fn(),
  lookupLoginIdentifier: vi.fn(),
  login: vi.fn(),
  loginWithPasskey: vi.fn(),
  registerPasskey: vi.fn(),
  loginWithGoogle: vi.fn(),
}));

function createLocalStorageStub() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
}

vi.mock('../../../router', () => ({
  useNavigate: () => mocks.navigate,
  useSearchParams: () => [new URLSearchParams(mocks.search), mocks.setSearchParams],
}));

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({
    login: (...args: unknown[]) => mocks.login(...args),
    loginWithPasskey: (...args: unknown[]) => mocks.loginWithPasskey(...args),
    registerPasskey: (...args: unknown[]) => mocks.registerPasskey(...args),
    loginWithGoogle: (...args: unknown[]) => mocks.loginWithGoogle(...args),
  }),
}));

vi.mock('../../../api', () => ({
  AuthService: {
    lookupLoginIdentifier: (...args: unknown[]) => mocks.lookupLoginIdentifier(...args),
  },
}));

vi.mock('../../../utils/hotelSettings', () => ({
  getHotelSettings: () => ({ hotel_name: 'Salim Inn' }),
}));

vi.mock('./GoogleSignInButton', () => ({
  GoogleSignInButton: () => null,
}));

vi.mock('./FirstLoginPasskeyPrompt', () => ({
  default: () => null,
}));

vi.mock('../../guestPortal/api/guestPortalDashboard.service', () => ({
  GuestPortalDashboardService: {
    createSession: vi.fn(),
  },
}));

vi.mock('../../guestPortal/api/portalTokenStore', () => ({
  setPortalToken: vi.fn(),
}));

import LoginPage from './LoginPage';

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <LoginPage />
    </QueryClientProvider>
  );
}

describe('LoginPage username lookup gate', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createLocalStorageStub());
    mocks.navigate.mockReset();
    mocks.lookupLoginIdentifier.mockReset();
    mocks.login.mockReset();
    mocks.loginWithPasskey.mockReset();
    mocks.registerPasskey.mockReset();
    mocks.loginWithGoogle.mockReset();
    // Keep passkey from "succeeding" and navigating away after a valid lookup.
    mocks.loginWithPasskey.mockImplementation(() =>
      Promise.reject(new Error('no credentials available'))
    );
    mocks.search = 'account=admin';
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('advances past the username step only after lookup confirms the account exists', async () => {
    mocks.lookupLoginIdentifier.mockResolvedValue({ exists: true });
    renderPage();

    fireEvent.change(screen.getByLabelText(/Username or Email/i), {
      target: { value: 'admin' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => {
      expect(mocks.lookupLoginIdentifier).toHaveBeenCalledWith('admin');
    });
    // Gate passed: username step is replaced by the account chip.
    expect(await screen.findByText('admin')).toBeTruthy();
    expect(screen.getByText('Change')).toBeTruthy();
    expect(screen.queryByLabelText(/Username or Email/i)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
  });

  it('keeps the password field hidden when the username or email is unknown', async () => {
    mocks.lookupLoginIdentifier.mockResolvedValue({ exists: false });
    renderPage();

    fireEvent.change(screen.getByLabelText(/Username or Email/i), {
      target: { value: 'nobody' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(
      await screen.findByText('No account found with that username or email')
    ).toBeTruthy();
    expect(screen.queryByLabelText(/^Password$/i)).toBeNull();
    expect(screen.getByRole('button', { name: 'Next' })).toBeTruthy();
    expect(mocks.loginWithPasskey).not.toHaveBeenCalled();
  });
});

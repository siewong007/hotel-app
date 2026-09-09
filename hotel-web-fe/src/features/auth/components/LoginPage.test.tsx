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
    // Default: passkey attempt fails so the page can fall through to password.
    mocks.loginWithPasskey.mockImplementation(() =>
      Promise.reject(new Error('no credentials available'))
    );
    mocks.search = 'account=admin';
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows the password step only after lookup confirms the account exists', async () => {
    mocks.lookupLoginIdentifier.mockResolvedValue({ exists: true });
    // Disable WebAuthn so Next skips passkey and opens the password field.
    Object.defineProperty(window, 'PublicKeyCredential', {
      configurable: true,
      writable: true,
      value: undefined,
    });
    renderPage();

    const userField = screen.getByLabelText(/Username or Email/i);
    fireEvent.change(userField, { target: { value: 'admin' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => {
      expect(mocks.lookupLoginIdentifier).toHaveBeenCalledWith('admin');
    });
    // Username step should advance.
    expect(await screen.findByText('admin')).toBeTruthy();
    expect(screen.getByText('Change')).toBeTruthy();
    // Password field appears when WebAuthn is unavailable.
    expect(
      await screen.findByLabelText(/^Password$/i, {}, { timeout: 3000 })
    ).toBeTruthy();
    expect(mocks.loginWithPasskey).not.toHaveBeenCalled();
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
    expect(mocks.loginWithPasskey).not.toHaveBeenCalled();
  });
});

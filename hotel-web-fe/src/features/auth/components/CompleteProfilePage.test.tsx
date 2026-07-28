import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  search: '',
  authState: {
    isAuthenticated: true,
    isLoading: false,
    user: {
      id: 1,
      username: 'guest1',
      email: 'guest1@example.com',
      full_name: 'Jane Doe',
      user_type: 'guest' as const,
      is_active: true,
      profile_complete: false,
      missing_profile_fields: ['first_name', 'last_name', 'phone'] as const,
    },
  },
  profile: {
    id: 1,
    username: 'guest1',
    email: 'guest1@example.com',
    email_configured: true,
    is_verified: true,
    user_type: 'guest' as const,
    full_name: 'Jane Doe',
    phone: undefined as string | undefined,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  completeGuestProfile: vi.fn(),
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
  Navigate: ({ to }: { to: string }) => <div data-testid="navigate" data-to={to} />,
  useNavigate: () => mocks.navigate,
  useSearchParams: () => [new URLSearchParams(mocks.search), vi.fn()],
}));

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => mocks.authState,
}));

vi.mock('../../../api/auth.service', () => ({
  AuthService: {
    completeGuestProfile: (...args: unknown[]) => mocks.completeGuestProfile(...args),
  },
}));

vi.mock('../../user/hooks/useProfileQueries', () => ({
  useProfileQuery: () => ({ data: mocks.profile }),
}));

import CompleteProfilePage from './CompleteProfilePage';

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <CompleteProfilePage />
    </QueryClientProvider>
  );
}

describe('CompleteProfilePage', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createLocalStorageStub());
    mocks.navigate.mockReset();
    mocks.completeGuestProfile.mockReset();
    mocks.search = '';
    mocks.authState.isAuthenticated = true;
    mocks.authState.isLoading = false;
    mocks.authState.user = {
      id: 1,
      username: 'guest1',
      email: 'guest1@example.com',
      full_name: 'Jane Doe',
      user_type: 'guest',
      is_active: true,
      profile_complete: false,
      missing_profile_fields: ['first_name', 'last_name', 'phone'],
    };
    mocks.profile.full_name = 'Jane Doe';
    mocks.profile.phone = undefined;
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('prefills the first and last name from the Google-supplied profile name', async () => {
    renderPage();

    await waitFor(() => {
      expect((screen.getByLabelText(/First Name/) as HTMLInputElement).value).toBe('Jane');
      expect((screen.getByLabelText(/Last Name/) as HTMLInputElement).value).toBe('Doe');
    });
  });

  it('rejects submission when the phone number is missing', async () => {
    renderPage();

    await waitFor(() =>
      expect((screen.getByLabelText(/First Name/) as HTMLInputElement).value).toBe('Jane')
    );

    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    await waitFor(() => {
      expect(screen.getByText('Phone number is required')).toBeDefined();
    });
    expect(mocks.completeGuestProfile).not.toHaveBeenCalled();
  });

  it('allows submission with an empty address', async () => {
    mocks.completeGuestProfile.mockResolvedValue({
      ...mocks.profile,
      phone: '0123456789',
      profile_complete: true,
      missing_profile_fields: [],
    });

    renderPage();

    await waitFor(() =>
      expect((screen.getByLabelText(/First Name/) as HTMLInputElement).value).toBe('Jane')
    );
    fireEvent.change(screen.getByLabelText(/Phone Number/), { target: { value: '0123456789' } });

    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    await waitFor(() => {
      expect(mocks.completeGuestProfile).toHaveBeenCalledWith({
        first_name: 'Jane',
        last_name: 'Doe',
        phone: '0123456789',
        address_line1: undefined,
      });
    });
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/guest-portal', { replace: true }));
  });

  it('redirects unauthenticated visitors to the guest login', () => {
    mocks.authState.isAuthenticated = false;
    renderPage();

    expect(screen.getByTestId('navigate').getAttribute('data-to')).toBe('/login?account=guest');
  });

  it('redirects a guest whose profile is already complete straight to the portal', () => {
    mocks.authState.user = { ...mocks.authState.user, profile_complete: true };
    renderPage();

    expect(screen.getByTestId('navigate').getAttribute('data-to')).toBe('/guest-portal');
  });
});

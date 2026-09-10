import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONSENT_DOCUMENT_VERSIONS } from '../../legal/content';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  search: 'account=admin',
  setSearchParams: vi.fn(),
  lookupLoginIdentifier: vi.fn(),
  login: vi.fn(),
  registerPasskey: vi.fn(),
  loginWithGoogle: vi.fn(),
  googleAvailable: true,
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
    registerPasskey: (...args: unknown[]) => mocks.registerPasskey(...args),
    loginWithGoogle: (...args: unknown[]) => mocks.loginWithGoogle(...args),
  }),
}));

vi.mock('../../../api', () => ({
  AuthService: {
    lookupLoginIdentifier: (...args: unknown[]) => mocks.lookupLoginIdentifier(...args),
  },
}));

vi.mock('./GoogleSignInButton', () => ({
  isGoogleSignInAvailable: () => mocks.googleAvailable,
  GoogleSignInButton: ({ onCredential }: { onCredential: (credential: string) => void }) => (
    <button type="button" onClick={() => onCredential('google-id-token')}>
      Continue with Google
    </button>
  ),
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

const fillCredentials = (identifier = 'admin', secret = 'hunter2!') => {
  fireEvent.change(screen.getByLabelText(/Username or Email/i), {
    target: { value: identifier },
  });
  fireEvent.change(screen.getByLabelText(/^Password/i), { target: { value: secret } });
};

describe('LoginPage single-step form', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createLocalStorageStub());
    mocks.navigate.mockReset();
    mocks.lookupLoginIdentifier.mockReset();
    mocks.login.mockReset();
    mocks.registerPasskey.mockReset();
    mocks.loginWithGoogle.mockReset();
    mocks.googleAvailable = true;
    mocks.search = 'account=admin';
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows the password field straight away, with no step to get past first', () => {
    renderPage();

    expect(screen.getByLabelText(/Username or Email/i)).toBeTruthy();
    expect(screen.getByLabelText(/^Password/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Login' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
  });

  it('offers no passkey sign-in on the form', () => {
    renderPage();

    expect(screen.queryByRole('button', { name: /passkey/i })).toBeNull();
  });

  it('signs in with both fields in one submit, once lookup confirms the account', async () => {
    mocks.lookupLoginIdentifier.mockResolvedValue({ exists: true });
    mocks.login.mockResolvedValue({ isFirstLogin: false });
    renderPage();

    fillCredentials();
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));

    await waitFor(() => {
      expect(mocks.lookupLoginIdentifier).toHaveBeenCalledWith('admin');
    });
    await waitFor(() => {
      expect(mocks.login).toHaveBeenCalledWith('admin', 'hunter2!', undefined, undefined);
    });
    expect(mocks.navigate).toHaveBeenCalledWith('/admin-portal', { replace: true });
  });

  it('never sends the password when the username or email is unknown', async () => {
    mocks.lookupLoginIdentifier.mockResolvedValue({ exists: false });
    renderPage();

    fillCredentials('nobody');
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));

    expect(
      await screen.findByText('No account found with that username or email')
    ).toBeTruthy();
    expect(mocks.login).not.toHaveBeenCalled();
    // The form stays put -- nothing to navigate back from.
    expect(screen.getByLabelText(/^Password/i)).toBeTruthy();
  });

  it('holds the button until both fields carry something usable', () => {
    renderPage();

    const submit = () => screen.getByRole('button', { name: 'Login' }) as HTMLButtonElement;
    expect(submit().disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/Username or Email/i), {
      target: { value: 'admin' },
    });
    expect(submit().disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/^Password/i), { target: { value: 'hunter2!' } });
    expect(submit().disabled).toBe(false);
  });
});

describe('LoginPage two-factor method choice', () => {
  const TWO_FACTOR_REQUIRED = '2FA required. Please provide a TOTP code or recovery code.';

  beforeEach(() => {
    vi.stubGlobal('localStorage', createLocalStorageStub());
    mocks.navigate.mockReset();
    mocks.lookupLoginIdentifier.mockReset();
    mocks.login.mockReset();
    mocks.loginWithGoogle.mockReset();
    mocks.googleAvailable = false;
    mocks.search = '';
    mocks.lookupLoginIdentifier.mockResolvedValue({ exists: true });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  /** Sign in far enough that the backend asks for a second factor. */
  const reachTwoFactorStep = async () => {
    mocks.login.mockRejectedValueOnce(new Error(TWO_FACTOR_REQUIRED));
    renderPage();
    fillCredentials();
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));
    expect(await screen.findByText('Choose how you want to finish signing in:')).toBeTruthy();
  };

  it('asks which second factor to use instead of assuming an authenticator app', async () => {
    await reachTwoFactorStep();

    expect(screen.getByRole('button', { name: /Use your authenticator app/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Use a recovery code/ })).toBeTruthy();
    // No code box until a method is picked.
    expect(screen.queryByLabelText('6-digit code')).toBeNull();
    expect(screen.queryByLabelText('Recovery code')).toBeNull();
  });

  it('verifies an authenticator code against the credentials already entered', async () => {
    await reachTwoFactorStep();
    mocks.login.mockResolvedValue({ isFirstLogin: false });

    fireEvent.click(screen.getByRole('button', { name: /Use your authenticator app/ }));
    fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));

    await waitFor(() => {
      expect(mocks.login).toHaveBeenLastCalledWith('admin', 'hunter2!', '123456', undefined);
    });
  });

  it('takes a full recovery code on the recovery path, and only a full one', async () => {
    await reachTwoFactorStep();
    mocks.login.mockResolvedValue({ isFirstLogin: false });

    fireEvent.click(screen.getByRole('button', { name: /Use a recovery code/ }));
    const field = screen.getByLabelText('Recovery code');
    const verify = () => screen.getByRole('button', { name: 'Verify' }) as HTMLButtonElement;

    // Six digits satisfy the authenticator step but are not a recovery code.
    fireEvent.change(field, { target: { value: '123456' } });
    expect(verify().disabled).toBe(true);

    fireEvent.change(field, { target: { value: 'a1b2c-3d4e5-f6a7b-8c9d0' } });
    expect(verify().disabled).toBe(false);
    fireEvent.click(verify());

    await waitFor(() => {
      expect(mocks.login).toHaveBeenLastCalledWith(
        'admin',
        'hunter2!',
        'A1B2C-3D4E5-F6A7B-8C9D0',
        undefined
      );
    });
  });

  it('lets the user go back and pick the other method', async () => {
    await reachTwoFactorStep();

    fireEvent.click(screen.getByRole('button', { name: /Use your authenticator app/ }));
    expect(screen.getByLabelText('6-digit code')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Choose another way' }));

    expect(screen.getByRole('button', { name: /Use a recovery code/ })).toBeTruthy();
    expect(screen.queryByLabelText('6-digit code')).toBeNull();
  });

  it('returns to the sign-in form when the second factor is cancelled', async () => {
    await reachTwoFactorStep();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByLabelText(/^Password/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Login' })).toBeTruthy();
  });
});

describe('LoginPage unified sign-in', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createLocalStorageStub());
    mocks.navigate.mockReset();
    mocks.lookupLoginIdentifier.mockReset();
    mocks.login.mockReset();
    mocks.registerPasskey.mockReset();
    mocks.loginWithGoogle.mockReset();
    mocks.googleAvailable = true;
    mocks.search = '';
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows the shared username form without a guest vs staff chooser', () => {
    renderPage();

    expect(screen.getByLabelText(/Username or Email/i)).toBeTruthy();
    expect(screen.queryByText('Guest stay')).toBeNull();
    expect(screen.queryByText('Hotel staff')).toBeNull();
    expect(screen.queryByLabelText('Back to account type')).toBeNull();
  });

  it('offers Google sign-in on the shared form even when a staff login link is used', () => {
    mocks.search = 'account=admin';
    renderPage();

    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeTruthy();
    expect(screen.queryByText('Staff account')).toBeNull();
    expect(screen.queryByText('Guest account')).toBeNull();
  });

  it('keeps a sign-up path on the shared form', () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Sign up' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/register');
  });

  it('sends the consent payload with every Google attempt, so this door can also create the account', async () => {
    // The options argument is optional on loginWithGoogle, so nothing but this
    // test stops the single Google door from quietly reverting to sign-in-only
    // -- which would 400 for every first-time Google guest.
    mocks.loginWithGoogle.mockResolvedValue({});
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));

    await waitFor(() => {
      expect(mocks.loginWithGoogle).toHaveBeenCalledWith('google-id-token', {
        consents: [
          {
            document: 'terms_of_service',
            version: CONSENT_DOCUMENT_VERSIONS.terms_of_service,
            granted: true,
            locale: 'en',
          },
          {
            document: 'privacy_notice',
            version: CONSENT_DOCUMENT_VERSIONS.privacy_notice,
            granted: true,
            locale: 'en',
          },
        ],
        marketing_opt_in: false,
      });
    });
  });

  it('shows the notice that governs account creation against the button', () => {
    // No checkbox stands between the guest and the account, so the sentence is
    // the whole record of what they were shown. It has to be on this page.
    renderPage();

    expect(
      screen.getByText(/By creating an account and using this service, you agree to the/)
    ).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Booking Terms and Conditions' }).getAttribute('href')
    ).toBe('/legal/terms');
    expect(screen.getByRole('link', { name: 'Privacy Notice' }).getAttribute('href')).toBe(
      '/legal/privacy'
    );
  });

  it('steers a 400-consent back to this page rather than to a sign-up that has no Google door', async () => {
    // Unreachable from this button now that it always sends consents; it is One
    // Tap and automatic sign-in that produce this 400, because neither can show
    // the notice. The message must therefore point here, not at /register.
    const err = Object.assign(
      new Error(
        'Consent to the Booking Terms and Conditions is required before this request can be accepted'
      ),
      { statusCode: 400 }
    );
    mocks.loginWithGoogle.mockRejectedValue(err);
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));

    expect(
      await screen.findByText(
        'To use this Google account for the first time, open the sign-in page and continue with Google there.'
      )
    ).toBeTruthy();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});

describe('LoginPage Google availability', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createLocalStorageStub());
    mocks.navigate.mockReset();
    mocks.googleAvailable = true;
    mocks.search = '';
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('drops the "or" divider along with the button when Google is not configured', () => {
    // Production ships without a client id, so this is the state real users
    // see. The divider used to stay behind, labelling nothing.
    mocks.googleAvailable = false;
    renderPage();

    expect(screen.queryByRole('button', { name: 'Continue with Google' })).toBeNull();
    expect(screen.queryByText('or')).toBeNull();
  });

  it('shows the divider when the button is there to introduce', () => {
    renderPage();

    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeTruthy();
    expect(screen.getByText('or')).toBeTruthy();
  });

  it('tells a staff member to use their password when Google rejects the account', async () => {
    mocks.loginWithGoogle.mockRejectedValue(
      Object.assign(new Error('Google sign-in is available only for active guest accounts.'), {
        statusCode: 409,
      })
    );
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));

    expect(
      await screen.findByText(
        'Google sign-in is for guest accounts. Staff should sign in with a username and password.'
      )
    ).toBeTruthy();
  });
});

describe('LoginPage return control', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createLocalStorageStub());
    mocks.navigate.mockReset();
    mocks.googleAvailable = true;
    mocks.search = '';
    vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Object.defineProperty(document, 'referrer', { configurable: true, value: '' });
  });

  it('returns a guest to the booking flow they signed in from', () => {
    mocks.search = 'redirect=%2Fguest-portal%3Fview%3Dbooking';
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(mocks.navigate).toHaveBeenCalledWith('/guest-portal?view=booking');
    expect(window.history.back).not.toHaveBeenCalled();
  });

  it('ignores a redirect that is not on the allowlist', () => {
    // Same open-redirect guard the post-sign-in path uses; a crafted value must
    // not become a navigation target just because it arrived in the URL.
    mocks.search = 'redirect=https%3A%2F%2Felsewhere.example%2Fphish';
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(mocks.navigate).toHaveBeenCalledWith('/');
  });

  it('goes back through history when the reader came from inside the app', () => {
    Object.defineProperty(document, 'referrer', {
      configurable: true,
      value: `${window.location.origin}/offers`,
    });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(window.history.back).toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('falls back to the hotel home when sign-in was opened directly', () => {
    // A session-expiry redirect replaces the history entry, and an emailed link
    // has no in-app history at all.
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(window.history.back).not.toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledWith('/');
  });
});

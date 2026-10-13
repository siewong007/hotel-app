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
  completeTwoFactorWithPasskey: vi.fn(),
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
    completeTwoFactorWithPasskey: (...args: unknown[]) =>
      mocks.completeTwoFactorWithPasskey(...args),
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
import { expectNoCriticalAxeViolations } from '../../../test/axe';

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

  it('reports no critical axe violations', async () => {
    const { container } = renderPage();
    await expectNoCriticalAxeViolations(container);
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

/** A failed `/auth/login` as AuthContext rethrows it: the server message plus
 *  the parsed body on `details`. */
const apiError = (message: string, details: Record<string, unknown>) =>
  Object.assign(new Error(message), { statusCode: 401, details });

const twoFactorRequired = (methods: string[], mfaToken = 'mfa-token-1') =>
  apiError('2FA required. Please provide a TOTP code or recovery code.', {
    code: 'two_factor_required',
    mfa_token: mfaToken,
    available_methods: methods,
  });

describe('LoginPage second factor', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createLocalStorageStub());
    mocks.navigate.mockReset();
    mocks.setSearchParams.mockReset();
    mocks.lookupLoginIdentifier.mockReset();
    mocks.login.mockReset();
    mocks.loginWithGoogle.mockReset();
    mocks.completeTwoFactorWithPasskey.mockReset();
    mocks.googleAvailable = false;
    mocks.search = '';
    mocks.lookupLoginIdentifier.mockResolvedValue({ exists: true });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  /** Sign in far enough that the backend asks for a second factor. */
  const reachTwoFactorStep = async (error: Error = twoFactorRequired(['totp', 'backup_code'])) => {
    mocks.login.mockRejectedValueOnce(error);
    renderPage();
    fillCredentials();
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));
    expect(await screen.findByRole('heading', { name: 'Two-factor authentication' })).toBeTruthy();
  };

  it('leads with the authenticator code and keeps backup codes off the method list', async () => {
    await reachTwoFactorStep();

    const code = screen.getByLabelText('6-digit code') as HTMLInputElement;
    expect(code.getAttribute('autocomplete')).toBe('one-time-code');
    expect(code.getAttribute('inputmode')).toBe('numeric');
    expect(document.activeElement).toBe(code);
    // No passkey on this account, and backup codes are a link, not a method.
    expect(screen.queryByRole('button', { name: /passkey/i })).toBeNull();
    expect(screen.queryByLabelText('Backup code')).toBeNull();
    expect(
      screen.getByRole('button', { name: /Lost access to your authenticator app\? Use a backup code/ })
    ).toBeTruthy();
  });

  it('submits on the sixth digit without a click, with the credentials already entered', async () => {
    await reachTwoFactorStep();
    mocks.login.mockResolvedValue({ isFirstLogin: false });

    // A paste or one-time-code autofill lands all six digits at once.
    fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '12 34-56' } });

    await waitFor(() => {
      expect(mocks.login).toHaveBeenLastCalledWith('admin', 'hunter2!', '123456', undefined);
    });
    expect(mocks.login).toHaveBeenCalledTimes(2);
    await waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith('/admin-portal', { replace: true });
    });
  });

  it('says how many attempts are left after a wrong code, and clears the boxes', async () => {
    await reachTwoFactorStep();
    mocks.login.mockRejectedValueOnce(
      apiError('Invalid 2FA code. 3 attempt(s) remaining before account lockout.', {
        code: 'two_factor_invalid',
        attempts_remaining: 3,
      })
    );

    const code = screen.getByLabelText('6-digit code') as HTMLInputElement;
    fireEvent.change(code, { target: { value: '000000' } });

    expect(
      await screen.findByText("That code didn't work. 3 attempts left before your account is locked.")
    ).toBeTruthy();
    await waitFor(() => {
      expect((screen.getByLabelText('6-digit code') as HTMLInputElement).value).toBe('');
    });
    expect(screen.getByLabelText('6-digit code').getAttribute('aria-invalid')).toBe('true');
  });

  it('offers the passkey alongside the code when the account has both', async () => {
    await reachTwoFactorStep(twoFactorRequired(['totp', 'passkey', 'backup_code'], 'tok-both'));
    mocks.completeTwoFactorWithPasskey.mockResolvedValue({ isFirstLogin: false });

    expect(screen.getByLabelText('6-digit code')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /Lost access to your authenticator app or passkey\?/ })
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Use a passkey instead' }));

    await waitFor(() => {
      expect(mocks.completeTwoFactorWithPasskey).toHaveBeenCalledWith('tok-both');
    });
    await waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith('/admin-portal', { replace: true });
    });
    // The passkey leg never resends the password.
    expect(mocks.login).toHaveBeenCalledTimes(1);
  });

  it('makes the passkey the primary action for a passkey-only account', async () => {
    await reachTwoFactorStep(twoFactorRequired(['passkey'], 'tok-pk'));

    expect(screen.queryByLabelText('6-digit code')).toBeNull();
    expect(screen.getByRole('button', { name: 'Use a passkey' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Lost access to your passkey\?/ })).toBeTruthy();
  });

  it('sends the reader back to the password when the passkey step has expired', async () => {
    await reachTwoFactorStep(twoFactorRequired(['passkey'], 'tok-old'));
    mocks.completeTwoFactorWithPasskey.mockRejectedValue(
      apiError('Your sign-in took too long. Enter your password again.', {
        code: 'two_factor_expired',
      })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Use a passkey' }));

    expect(
      await screen.findByText('Your sign-in took too long. Enter your password again.')
    ).toBeTruthy();
    expect(screen.getByLabelText(/^Password/i)).toBeTruthy();
  });

  it('opens the backup-code page from the link, as its own history entry', async () => {
    await reachTwoFactorStep();

    fireEvent.click(screen.getByRole('button', { name: /Use a backup code/ }));

    expect(screen.getByRole('heading', { name: 'Use a backup code' })).toBeTruthy();
    expect(screen.getByText('No backup codes? Contact your hotel administrator.')).toBeTruthy();
    expect(screen.queryByLabelText('6-digit code')).toBeNull();
    const [params, options] = mocks.setSearchParams.mock.calls.at(-1) as [
      URLSearchParams,
      { replace?: boolean },
    ];
    expect(params.get('two_factor')).toBe('backup');
    expect(options.replace).toBe(false);
  });

  it('takes a full backup code, formatted as typed, and never auto-submits it', async () => {
    await reachTwoFactorStep();
    mocks.login.mockResolvedValue({ isFirstLogin: false, recoveryCodesRemaining: 4 });
    fireEvent.click(screen.getByRole('button', { name: /Use a backup code/ }));

    const field = screen.getByLabelText('Backup code') as HTMLInputElement;
    const verify = () => screen.getByRole('button', { name: 'Verify' }) as HTMLButtonElement;
    expect(field.getAttribute('autocomplete')).toBe('off');

    // Six digits are an authenticator code, not a backup code.
    fireEvent.change(field, { target: { value: '123456' } });
    expect(verify().disabled).toBe(true);

    fireEvent.change(field, { target: { value: 'a1b2c3d4e5f6a7b8c9d0' } });
    expect(field.value).toBe('A1B2C-3D4E5-F6A7B-8C9D0');
    expect(mocks.login).toHaveBeenCalledTimes(1);

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

  it('returns from the backup page to the sign-in options', async () => {
    await reachTwoFactorStep(twoFactorRequired(['totp', 'passkey', 'backup_code']));
    fireEvent.click(screen.getByRole('button', { name: /Use a backup code/ }));

    fireEvent.click(screen.getByRole('button', { name: 'Back to sign-in options' }));

    expect(screen.getByLabelText('6-digit code')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Use a passkey instead' })).toBeTruthy();
  });

  it('explains when the account has no backup codes left', async () => {
    await reachTwoFactorStep(twoFactorRequired(['totp']));
    fireEvent.click(screen.getByRole('button', { name: /Use a backup code/ }));

    expect(screen.getByText('This account has no backup codes left.')).toBeTruthy();
    expect(screen.queryByLabelText('Backup code')).toBeNull();
  });

  it('still reads a challenge from an older backend that only sends the message', async () => {
    await reachTwoFactorStep(new Error('2FA required. Please provide a TOTP code or recovery code.'));

    expect(screen.getByLabelText('6-digit code')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /passkey/i })).toBeNull();
  });

  it('returns to the sign-in form from Back', async () => {
    await reachTwoFactorStep();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(screen.getByLabelText(/^Password/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Login' })).toBeTruthy();
  });

  it('reports no critical axe violations on the code step', async () => {
    await reachTwoFactorStep(twoFactorRequired(['totp', 'passkey', 'backup_code']));
    await expectNoCriticalAxeViolations(document.body);
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
    window.history.replaceState({ __TSR_index: 0 }, '');
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.history.replaceState(null, '');
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
    // A pushed in-app entry: the router stamped the previous page's index
    // above 0, so there is a real screen of this document behind this one.
    window.history.replaceState({ __TSR_index: 1 }, '');
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(window.history.back).toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('does not trust a same-origin referrer left by a replace-bounce', () => {
    // ProtectedRoute bounces a signed-out reader with location.replace: the
    // guarded page's entry is gone, so back() would find nothing and the
    // control would look dead. The fallback must take over instead.
    Object.defineProperty(document, 'referrer', {
      configurable: true,
      value: `${window.location.origin}/admin-portal`,
    });
    window.history.replaceState({ __TSR_index: 0 }, '');
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(window.history.back).not.toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledWith('/');
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

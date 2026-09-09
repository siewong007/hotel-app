import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONSENT_DOCUMENT_VERSIONS } from '../../legal/content';
import { resetLocaleStoreForTests } from '../../../i18n/localeStore';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  search: '',
  setSearchParams: vi.fn(),
  register: vi.fn(),
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
    register: (...args: unknown[]) => mocks.register(...args),
    loginWithGoogle: (...args: unknown[]) => mocks.loginWithGoogle(...args),
  }),
}));

vi.mock('./GoogleSignInButton', () => ({
  GoogleSignInButton: ({ onCredential }: { onCredential: (credential: string) => void }) => (
    <button type="button" onClick={() => onCredential('google-id-token')}>
      Continue with Google
    </button>
  ),
}));

import RegisterPage from './RegisterPage';

describe('RegisterPage Google registration', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createLocalStorageStub());
    mocks.navigate.mockReset();
    mocks.register.mockReset();
    mocks.loginWithGoogle.mockReset();
    mocks.search = '';
    resetLocaleStoreForTests();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('offers Google as a way to create an account', () => {
    render(<RegisterPage />);

    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeTruthy();
  });

  it('does not register with Google until Booking Terms and Privacy Notice are accepted', async () => {
    render(<RegisterPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));

    expect(
      await screen.findByText(
        'Please read and accept the Booking Terms and the Privacy Notice before continuing with Google.'
      )
    ).toBeTruthy();
    expect(mocks.loginWithGoogle).not.toHaveBeenCalled();
  });

  it('creates the guest account with Google after the required consents are accepted', async () => {
    mocks.loginWithGoogle.mockResolvedValue({});
    render(<RegisterPage />);

    fireEvent.click(screen.getByRole('checkbox', { name: /Booking Terms and Conditions/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Privacy Notice/ }));
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
});

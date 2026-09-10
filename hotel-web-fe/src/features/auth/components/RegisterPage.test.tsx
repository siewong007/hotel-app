import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetLocaleStoreForTests } from '../../../i18n/localeStore';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  search: '',
  setSearchParams: vi.fn(),
  register: vi.fn(),
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
  }),
}));

import RegisterPage from './RegisterPage';

describe('RegisterPage consent notice', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createLocalStorageStub());
    mocks.navigate.mockReset();
    mocks.register.mockReset();
    mocks.search = '';
    resetLocaleStoreForTests();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('states which documents signing up agrees to, with both linked', () => {
    // There is no tick to point at afterwards, so this sentence is the entire
    // record of what the guest was shown before the account was created.
    render(<RegisterPage />);

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

  it('asks for no consent tick, and does not smuggle marketing into the notice', () => {
    render(<RegisterPage />);

    expect(screen.queryAllByRole('checkbox')).toEqual([]);
    // Marketing is a separate purpose asked for after sign-in: a guest must be
    // able to decline it without declining an account, so it cannot ride along
    // inside a notice covering the act of signing up.
    expect(screen.queryByText(/offers, news and birthday rewards/)).toBeNull();
  });

  it('no longer offers a second Google door of its own', () => {
    // Google account creation happens on the sign-in page, which is where the
    // notice governing it is rendered.
    render(<RegisterPage />);

    expect(screen.queryByRole('button', { name: 'Continue with Google' })).toBeNull();
  });
});

describe('RegisterPage return control', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createLocalStorageStub());
    mocks.navigate.mockReset();
    mocks.search = '';
    resetLocaleStoreForTests();
    vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Object.defineProperty(document, 'referrer', { configurable: true, value: '' });
  });

  it('returns a guest to the booking flow they came from', () => {
    mocks.search = 'redirect=%2Fguest-portal%3Fview%3Dbooking';
    render(<RegisterPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(mocks.navigate).toHaveBeenCalledWith('/guest-portal?view=booking');
  });

  it('falls back to the hotel home when opened directly', () => {
    render(<RegisterPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(mocks.navigate).toHaveBeenCalledWith('/');
  });
});

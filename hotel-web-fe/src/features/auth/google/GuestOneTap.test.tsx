import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  loginWithGoogle: vi.fn(),
  isAuthenticated: false,
  isLoading: false,
  storedUser: null as { profile_complete?: boolean } | null,
  notifications: [] as { message: string; severity: string }[],
}));

vi.mock('../../../router', () => ({ useNavigate: () => mocks.navigate }));

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({
    isAuthenticated: mocks.isAuthenticated,
    isLoading: mocks.isLoading,
    loginWithGoogle: (...args: unknown[]) => mocks.loginWithGoogle(...args),
  }),
}));

vi.mock('../../../i18n', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  // ConsentNotice reads the shared legal locale, which is the interface locale.
  useLocale: () => 'en',
}));

vi.mock('../../../utils/storage', () => ({
  storage: { getItem: () => mocks.storedUser },
}));

vi.mock('../../../utils/apiNotifications', () => ({
  emitApiNotification: (detail: { message: string; severity: string }) => {
    mocks.notifications.push(detail);
  },
}));

import { GuestOneTap } from './GuestOneTap';
import {
  googleInitializeConfig,
  installGoogleIdentityStub,
} from './testSupport/googleIdentityStub';

const GSI_SCRIPT_ID = 'google-identity-services-script';

type Initialize = ReturnType<typeof installGoogleIdentityStub>['initialize'];

/** Fires the callback GSI would call with a returned credential. */
function deliverCredential(initialize: Initialize, selectBy?: string) {
  googleInitializeConfig(initialize).callback({
    credential: 'google-id-token',
    select_by: selectBy,
  });
}

beforeEach(() => {
  vi.stubEnv('VITE_APP_TARGET', 'web');
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');
  mocks.navigate.mockReset();
  mocks.loginWithGoogle.mockReset().mockResolvedValue(undefined);
  mocks.isAuthenticated = false;
  mocks.isLoading = false;
  mocks.storedUser = { profile_complete: true };
  mocks.notifications = [];
});

afterEach(() => {
  cleanup();
  document.getElementById(GSI_SCRIPT_ID)?.remove();
  delete (window as { google?: unknown }).google;
  vi.unstubAllEnvs();
});

describe('GuestOneTap', () => {
  it('prompts with automatic sign-in enabled on an allowlisted page', async () => {
    const { initialize, prompt } = installGoogleIdentityStub();

    render(<GuestOneTap pathname="/offers" search="" />);

    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        client_id: 'test-client-id',
        auto_select: true,
        use_fedcm_for_prompt: true,
      })
    );
  });

  it('never prompts on a page outside the allowlist', () => {
    const { prompt } = installGoogleIdentityStub();

    render(<GuestOneTap pathname="/login" search="" />);

    expect(prompt).not.toHaveBeenCalled();
    expect(document.getElementById(GSI_SCRIPT_ID)).toBeNull();
  });

  it('never prompts someone who is already signed in', () => {
    mocks.isAuthenticated = true;
    const { prompt } = installGoogleIdentityStub();

    render(<GuestOneTap pathname="/offers" search="" />);

    expect(prompt).not.toHaveBeenCalled();
  });

  it('waits for the session check rather than prompting over it', () => {
    mocks.isLoading = true;
    const { prompt } = installGoogleIdentityStub();

    render(<GuestOneTap pathname="/offers" search="" />);

    expect(prompt).not.toHaveBeenCalled();
  });

  it('does not load Google at all when the build has no client id', () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '');

    render(<GuestOneTap pathname="/offers" search="" />);

    expect(document.getElementById(GSI_SCRIPT_ID)).toBeNull();
  });

  it('never prompts in a desktop build', () => {
    vi.stubEnv('VITE_APP_TARGET', 'tauri');
    const { prompt } = installGoogleIdentityStub();

    render(<GuestOneTap pathname="/offers" search="" />);

    expect(prompt).not.toHaveBeenCalled();
  });

  it('signs the guest in without moving them off the page', async () => {
    const { initialize } = installGoogleIdentityStub();
    render(<GuestOneTap pathname="/offers" search="" />);
    await waitFor(() => expect(initialize).toHaveBeenCalled());

    deliverCredential(initialize, 'user');

    await waitFor(() => expect(mocks.loginWithGoogle).toHaveBeenCalledWith('google-id-token'));
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.notifications).toEqual([]);
  });

  it('announces an automatic sign-in, which shows nothing of its own', async () => {
    const { initialize } = installGoogleIdentityStub();
    render(<GuestOneTap pathname="/offers" search="" />);
    await waitFor(() => expect(initialize).toHaveBeenCalled());

    deliverCredential(initialize, 'auto');

    await waitFor(() =>
      expect(mocks.notifications).toEqual([
        { message: 'login.googleAutoSignedIn', severity: 'success' },
      ])
    );
  });

  it('sends a guest with an incomplete profile back to the booking flow', async () => {
    mocks.storedUser = { profile_complete: false };
    const { initialize } = installGoogleIdentityStub();
    render(<GuestOneTap pathname="/guest-portal" search="?view=booking" />);
    await waitFor(() => expect(initialize).toHaveBeenCalled());

    deliverCredential(initialize, 'user');

    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith(
        `/complete-profile?redirect=${encodeURIComponent('/guest-portal?view=booking')}`,
        { replace: true }
      )
    );
  });

  it('sends an incomplete profile to the dashboard when there is no booking to resume', async () => {
    mocks.storedUser = { profile_complete: false };
    const { initialize } = installGoogleIdentityStub();
    render(<GuestOneTap pathname="/offers" search="" />);
    await waitFor(() => expect(initialize).toHaveBeenCalled());

    deliverCredential(initialize, 'user');

    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith('/complete-profile', { replace: true })
    );
  });

  it('offers the notice instead of a dead end when the Google identity is new', async () => {
    // The first attempt sends no consents by design, so a first-time identity
    // always 400s here. Reporting that as a failure is what made One Tap
    // useless for exactly the visitors it is best at catching.
    mocks.loginWithGoogle.mockRejectedValueOnce(
      Object.assign(
        new Error(
          'Consent to the Booking Terms and Conditions is required before this request can be accepted'
        ),
        { statusCode: 400 }
      )
    );
    const { initialize } = installGoogleIdentityStub();
    render(<GuestOneTap pathname="/offers" search="" />);
    await waitFor(() => expect(initialize).toHaveBeenCalled());

    deliverCredential(initialize, 'user');

    expect(
      await screen.findByText(/By creating an account and using this service, you agree to the/)
    ).toBeTruthy();
    // Not reported as an error: it is a step, not a failure.
    expect(mocks.notifications).toEqual([]);
  });

  it('creates the account once the notice has been shown and accepted', async () => {
    mocks.loginWithGoogle
      .mockRejectedValueOnce(
        Object.assign(new Error('Consent is required'), { statusCode: 400 })
      )
      .mockResolvedValueOnce(undefined);
    const { initialize } = installGoogleIdentityStub();
    render(<GuestOneTap pathname="/offers" search="" />);
    await waitFor(() => expect(initialize).toHaveBeenCalled());
    deliverCredential(initialize, 'user');
    await screen.findByRole('button', { name: 'login.googleFirstTimeConfirm' });

    fireEvent.click(screen.getByRole('button', { name: 'login.googleFirstTimeConfirm' }));

    await waitFor(() =>
      expect(mocks.loginWithGoogle).toHaveBeenLastCalledWith('google-id-token', {
        consents: [
          { document: 'terms_of_service', version: expect.any(String), granted: true, locale: 'en' },
          { document: 'privacy_notice', version: expect.any(String), granted: true, locale: 'en' },
        ],
        marketing_opt_in: false,
      })
    );
  });

  it('creates nothing when the notice is declined', async () => {
    mocks.loginWithGoogle.mockRejectedValueOnce(
      Object.assign(new Error('Consent is required'), { statusCode: 400 })
    );
    const { initialize } = installGoogleIdentityStub();
    render(<GuestOneTap pathname="/offers" search="" />);
    await waitFor(() => expect(initialize).toHaveBeenCalled());
    deliverCredential(initialize, 'user');
    await screen.findByRole('button', { name: 'login.googleFirstTimeCancel' });

    fireEvent.click(screen.getByRole('button', { name: 'login.googleFirstTimeCancel' }));

    await waitFor(() =>
      expect(
        screen.queryByText(/By creating an account and using this service/)
      ).toBeNull()
    );
    expect(mocks.loginWithGoogle).toHaveBeenCalledTimes(1);
  });

  it('does not announce an automatic sign-in that has not happened yet', async () => {
    // select_by 'auto' plus a pending notice is not a completed sign-in.
    mocks.loginWithGoogle.mockRejectedValueOnce(
      Object.assign(new Error('Consent is required'), { statusCode: 400 })
    );
    const { initialize } = installGoogleIdentityStub();
    render(<GuestOneTap pathname="/offers" search="" />);
    await waitFor(() => expect(initialize).toHaveBeenCalled());

    deliverCredential(initialize, 'auto');

    await screen.findByRole('button', { name: 'login.googleFirstTimeConfirm' });
    expect(mocks.notifications).toEqual([]);
  });

  it('reports a staff account through the global notification host', async () => {
    mocks.loginWithGoogle.mockRejectedValue(Object.assign(new Error('nope'), { statusCode: 409 }));
    const { initialize } = installGoogleIdentityStub();
    render(<GuestOneTap pathname="/offers" search="" />);
    await waitFor(() => expect(initialize).toHaveBeenCalled());

    deliverCredential(initialize, 'user');

    await waitFor(() =>
      expect(mocks.notifications).toEqual([
        { message: 'login.googleStaffOnly', severity: 'warning' },
      ])
    );
  });

  it('closes an open prompt when the reader leaves an allowlisted page', async () => {
    const { prompt, cancel } = installGoogleIdentityStub();
    const { rerender } = render(<GuestOneTap pathname="/offers" search="" />);
    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));

    rerender(<GuestOneTap pathname="/legal/terms" search="" />);

    expect(cancel).toHaveBeenCalled();
  });

  it('prompts once per visit, not again as a booking progresses', async () => {
    const { prompt } = installGoogleIdentityStub();
    const { rerender } = render(<GuestOneTap pathname="/guest-portal" search="?view=booking" />);
    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));

    rerender(<GuestOneTap pathname="/guest-portal" search="?view=booking" />);
    rerender(<GuestOneTap pathname="/guest-portal" search="?view=booking" />);

    expect(prompt).toHaveBeenCalledTimes(1);
  });
});

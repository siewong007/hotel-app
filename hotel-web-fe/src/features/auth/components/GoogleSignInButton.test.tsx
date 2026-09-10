import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoogleSignInButton, disableGoogleAutoSelect } from './GoogleSignInButton';
import { installGoogleIdentityStub } from '../google/testSupport/googleIdentityStub';

const GSI_SCRIPT_ID = 'google-identity-services-script';

afterEach(() => {
  cleanup();
  document.getElementById(GSI_SCRIPT_ID)?.remove();
  delete (window as { google?: unknown }).google;
  vi.unstubAllEnvs();
});

describe('GoogleSignInButton', () => {
  it('injects the GSI script and renders the Google button for a configured web build', async () => {
    vi.stubEnv('VITE_APP_TARGET', 'web');
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');

    render(<GoogleSignInButton onCredential={vi.fn()} />);

    const script = document.getElementById(GSI_SCRIPT_ID) as HTMLScriptElement | null;
    expect(script).toBeTruthy();
    expect(script?.src).toBe('https://accounts.google.com/gsi/client');

    const { initialize, renderButton } = installGoogleIdentityStub();
    script?.dispatchEvent(new Event('load'));

    await waitFor(() => expect(renderButton).toHaveBeenCalledTimes(1));
    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({ client_id: 'test-client-id' })
    );
  });

  it('never adds the GSI script for a Tauri build', () => {
    vi.stubEnv('VITE_APP_TARGET', 'tauri');
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');

    const { container } = render(<GoogleSignInButton onCredential={vi.fn()} />);

    expect(document.getElementById(GSI_SCRIPT_ID)).toBeNull();
    expect(container.firstChild).toBeNull();
  });

  it('reuses a single script tag across multiple mounted instances', () => {
    vi.stubEnv('VITE_APP_TARGET', 'web');
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');

    render(<GoogleSignInButton onCredential={vi.fn()} />);
    render(<GoogleSignInButton onCredential={vi.fn()} />);

    expect(document.querySelectorAll(`#${GSI_SCRIPT_ID}`).length).toBe(1);
  });
});

describe('sign-up vs sign-in framing', () => {
  const mountAndLoad = async (props: { context?: 'signin' | 'signup' }) => {
    vi.stubEnv('VITE_APP_TARGET', 'web');
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');
    render(<GoogleSignInButton onCredential={vi.fn()} {...props} />);
    const script = document.getElementById(GSI_SCRIPT_ID) as HTMLScriptElement | null;
    const { initialize, renderButton } = installGoogleIdentityStub();
    script?.dispatchEvent(new Event('load'));
    await waitFor(() => expect(renderButton).toHaveBeenCalledTimes(1));
    return { initialize, renderButton };
  };

  it('asks Google for sign-UP wording on the registration page', async () => {
    // Without this the registration page renders "Sign in with Google", or
    // worse "Sign in as <name>", on a page whose only purpose is creating an
    // account.
    const { initialize, renderButton } = await mountAndLoad({ context: 'signup' });
    expect(initialize).toHaveBeenCalledWith(expect.objectContaining({ context: 'signup' }));
    expect(renderButton).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ text: 'signup_with' })
    );
  });

  it('defaults to sign-in wording everywhere else', async () => {
    const { initialize, renderButton } = await mountAndLoad({});
    expect(initialize).toHaveBeenCalledWith(expect.objectContaining({ context: 'signin' }));
    expect(renderButton).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ text: 'signin_with' })
    );
  });
});

describe('disableGoogleAutoSelect', () => {
  it('tells Google to forget the bound account', () => {
    const { disableAutoSelect } = installGoogleIdentityStub();

    disableGoogleAutoSelect();

    expect(disableAutoSelect).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when the GSI script never loaded', () => {
    // A guest whose network or extensions blocked Google must still be able to
    // sign out of our app.
    delete (window as { google?: unknown }).google;
    expect(() => disableGoogleAutoSelect()).not.toThrow();
  });

  it('swallows a throwing Google SDK rather than breaking sign-out', () => {
    installGoogleIdentityStub({
      disableAutoSelect: () => {
        throw new Error('gsi exploded');
      },
    });
    expect(() => disableGoogleAutoSelect()).not.toThrow();
  });
});

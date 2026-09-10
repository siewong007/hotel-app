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

describe('one door, one label', () => {
  const mountAndLoad = async () => {
    vi.stubEnv('VITE_APP_TARGET', 'web');
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');
    render(<GoogleSignInButton onCredential={vi.fn()} />);
    const script = document.getElementById(GSI_SCRIPT_ID) as HTMLScriptElement | null;
    const { initialize, renderButton } = installGoogleIdentityStub();
    script?.dispatchEvent(new Event('load'));
    await waitFor(() => expect(renderButton).toHaveBeenCalledTimes(1));
    return { initialize, renderButton };
  };

  it('says "Continue with Google", because the same button signs in and signs up', async () => {
    // The credential is identical either way and the backend decides which it
    // is, so a signin_with/signup_with split would label half the visitors
    // wrongly -- and this button is now the only Google door.
    const { initialize, renderButton } = await mountAndLoad();

    expect(renderButton).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ text: 'continue_with', type: 'standard' })
    );
    expect(initialize).toHaveBeenCalledWith(expect.objectContaining({ context: 'use' }));
  });

  it('draws the icon variant square, without the container width', async () => {
    vi.stubEnv('VITE_APP_TARGET', 'web');
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');
    render(<GoogleSignInButton onCredential={vi.fn()} type="icon" />);
    const script = document.getElementById(GSI_SCRIPT_ID) as HTMLScriptElement | null;
    const { renderButton } = installGoogleIdentityStub();
    script?.dispatchEvent(new Event('load'));

    await waitFor(() => expect(renderButton).toHaveBeenCalledTimes(1));
    const options = renderButton.mock.calls[0][1] as { type?: string; width?: unknown };
    expect(options.type).toBe('icon');
    // Stretching a square button to the container is what draws a G logo in a
    // wide empty box.
    expect('width' in options).toBe(false);
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

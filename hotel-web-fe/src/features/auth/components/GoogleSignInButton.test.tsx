import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoogleSignInButton } from './GoogleSignInButton';

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

    const initialize = vi.fn();
    const renderButton = vi.fn();
    window.google = { accounts: { id: { initialize, renderButton } } };
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

import { cleanup, renderHook, act, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTurnstile, isTurnstileEnabled } from './useTurnstile';
import { turnstileErrorMessage } from './turnstileError';

const SCRIPT_ID = 'cloudflare-turnstile-script';
const CONTAINER_ID = 'cloudflare-turnstile-container';

type RenderOptions = {
  callback?: (token: string) => void;
  'error-callback'?: (code?: string) => void;
  'expired-callback'?: () => void;
  'before-interactive-callback'?: () => void;
  'after-interactive-callback'?: () => void;
};

/** A stand-in for Cloudflare's global, capturing what the hook asks it to do. */
function installTurnstileStub() {
  const state = {
    options: null as RenderOptions | null,
    resets: 0,
    executes: 0,
    removed: [] as string[],
  };
  (window as { turnstile?: unknown }).turnstile = {
    render: (_el: HTMLElement, options: RenderOptions) => {
      state.options = options;
      return 'widget-1';
    },
    execute: () => {
      state.executes += 1;
    },
    reset: () => {
      state.resets += 1;
    },
    remove: (id: string) => {
      state.removed.push(id);
    },
  };
  return state;
}

afterEach(() => {
  cleanup();
  document.getElementById(SCRIPT_ID)?.remove();
  document.getElementById(CONTAINER_ID)?.remove();
  delete (window as { turnstile?: unknown }).turnstile;
  vi.unstubAllEnvs();
});

describe('isTurnstileEnabled', () => {
  it('is off when the build has no site key', () => {
    vi.stubEnv('VITE_APP_TARGET', 'web');
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '');
    expect(isTurnstileEnabled()).toBe(false);
  });

  it('is on for a web build with a site key', () => {
    vi.stubEnv('VITE_APP_TARGET', 'web');
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'site-key');
    expect(isTurnstileEnabled()).toBe(true);
  });
});

describe('useTurnstile when the build does not challenge', () => {
  it('resolves undefined so callers can pass the result straight through', async () => {
    vi.stubEnv('VITE_APP_TARGET', 'web');
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '');

    const { result } = renderHook(() => useTurnstile());

    expect(result.current.enabled).toBe(false);
    await expect(result.current.getToken()).resolves.toBeUndefined();
    expect(document.getElementById(SCRIPT_ID)).toBeNull();
  });
});

describe('useTurnstile when the build challenges', () => {
  it('injects the Cloudflare script once and renders in execute mode', async () => {
    vi.stubEnv('VITE_APP_TARGET', 'web');
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'site-key');

    const stub = installTurnstileStub();
    renderHook(() => useTurnstile());

    await waitFor(() => expect(stub.options).not.toBeNull());
    // execute mode is what makes the token single-use-per-submit rather than
    // minted at page load and stale by the time the form is sent.
    expect(stub.options?.['callback']).toBeTypeOf('function');
    expect((stub.options as unknown as { execution: string }).execution).toBe('execute');
    expect((stub.options as unknown as { sitekey: string }).sitekey).toBe('site-key');
  });

  it('resets before executing so each attempt gets a FRESH token', async () => {
    vi.stubEnv('VITE_APP_TARGET', 'web');
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'site-key');

    const stub = installTurnstileStub();
    const { result } = renderHook(() => useTurnstile());
    await waitFor(() => expect(stub.options).not.toBeNull());

    const first = result.current.getToken();
    act(() => stub.options?.callback?.('token-one'));
    await expect(first).resolves.toBe('token-one');

    const second = result.current.getToken();
    act(() => stub.options?.callback?.('token-two'));
    await expect(second).resolves.toBe('token-two');

    // Two attempts, two resets: a replayed token is rejected by Cloudflare as
    // timeout-or-duplicate, so skipping the reset would break the 2FA leg.
    expect(stub.resets).toBe(2);
    expect(stub.executes).toBe(2);
  });

  it('rejects rather than silently passing when the script never loads', async () => {
    vi.stubEnv('VITE_APP_TARGET', 'web');
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'site-key');
    // No stub installed: this is the ad-blocker / offline / CSP case.

    const { result } = renderHook(() => useTurnstile());

    await expect(result.current.getToken()).rejects.toThrow('turnstile-unavailable');
  });

  it('surfaces a Cloudflare error instead of resolving', async () => {
    vi.stubEnv('VITE_APP_TARGET', 'web');
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'site-key');

    const stub = installTurnstileStub();
    const { result } = renderHook(() => useTurnstile());
    await waitFor(() => expect(stub.options).not.toBeNull());

    const pending = result.current.getToken();
    act(() => stub.options?.['error-callback']?.());
    await expect(pending).rejects.toThrow('turnstile-error');
  });

  it('shows the overlay only while an interactive challenge is up', async () => {
    vi.stubEnv('VITE_APP_TARGET', 'web');
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'site-key');

    const stub = installTurnstileStub();
    const { result } = renderHook(() => useTurnstile());
    await waitFor(() => expect(stub.options).not.toBeNull());

    const container = document.getElementById(CONTAINER_ID) as HTMLElement;
    expect(container.style.display).toBe('none');

    const pending = result.current.getToken();
    // A silent pass must never flash a full-screen scrim.
    expect(container.style.display).toBe('none');

    act(() => stub.options?.['before-interactive-callback']?.());
    expect(container.style.display).toBe('flex');

    act(() => stub.options?.callback?.('token'));
    await expect(pending).resolves.toBe('token');
    expect(container.style.display).toBe('none');
  });
});

describe('turnstileErrorMessage', () => {
  const t = (key: string) => key;

  it('names the ad blocker for the unavailable case', () => {
    expect(turnstileErrorMessage(new Error('turnstile-unavailable'), t)).toBe(
      'turnstile.unavailable',
    );
  });

  it('maps a timeout to its own message', () => {
    expect(turnstileErrorMessage(new Error('turnstile-timeout'), t)).toBe('turnstile.timeout');
  });

  it('falls back to the generic failure for anything else', () => {
    expect(turnstileErrorMessage(new Error('turnstile-error'), t)).toBe('turnstile.failed');
    expect(turnstileErrorMessage('not an error', t)).toBe('turnstile.failed');
  });
});

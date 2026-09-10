import { cleanup, renderHook, act, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTurnstile, isTurnstileEnabled } from './useTurnstile';
import { turnstileErrorMessage } from './turnstileError';

const SCRIPT_ID = 'cloudflare-turnstile-script';

type RenderOptions = {
  sitekey: string;
  callback?: (token: string) => void;
  'error-callback'?: (code?: string) => void;
  'expired-callback'?: () => void;
  'refresh-expired'?: string;
};

/** Stand-in for Cloudflare's global, recording what the hook asks of it. */
function installTurnstileStub() {
  const state = {
    options: null as RenderOptions | null,
    renderedInto: [] as HTMLElement[],
    resets: 0,
    removed: [] as string[],
    nextId: 0,
  };
  (window as { turnstile?: unknown }).turnstile = {
    render: (el: HTMLElement, options: RenderOptions) => {
      state.options = options;
      state.renderedInto.push(el);
      state.nextId += 1;
      return `widget-${state.nextId}`;
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
  delete (window as { turnstile?: unknown }).turnstile;
  vi.unstubAllEnvs();
});

const enable = () => {
  vi.stubEnv('VITE_APP_TARGET', 'web');
  vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'site-key');
};

describe('isTurnstileEnabled', () => {
  it('is off when the build has no site key', () => {
    vi.stubEnv('VITE_APP_TARGET', 'web');
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '');
    expect(isTurnstileEnabled()).toBe(false);
  });

  it('is on for a web build with a site key', () => {
    enable();
    expect(isTurnstileEnabled()).toBe(true);
  });
});

describe('useTurnstile when the build does not challenge', () => {
  it('reports disabled and never loads the script', () => {
    vi.stubEnv('VITE_APP_TARGET', 'web');
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '');

    const { result } = renderHook(() => useTurnstile());

    expect(result.current.enabled).toBe(false);
    expect(result.current.token).toBeUndefined();
    expect(document.getElementById(SCRIPT_ID)).toBeNull();
  });
});

describe('useTurnstile inline widget', () => {
  it('renders into the node it is given and exposes the solved token', async () => {
    enable();
    const stub = installTurnstileStub();
    const { result } = renderHook(() => useTurnstile());

    const node = document.createElement('div');
    act(() => result.current.setContainer(node));

    await waitFor(() => expect(stub.options).not.toBeNull());
    expect(stub.renderedInto[0]).toBe(node);
    // Inline widget: solves on its own, and re-solves when a token expires
    // while the form sits open.
    expect(stub.options?.['refresh-expired']).toBe('auto');

    act(() => stub.options?.callback?.('token-one'));
    await waitFor(() => expect(result.current.token).toBe('token-one'));
    expect(result.current.error).toBeUndefined();
  });

  it('re-renders into a NEW node when the form changes step', async () => {
    // LoginPage returns early for its 2FA step, so the form holding the widget
    // is unmounted. A widget left pointing at the discarded node never calls
    // back, which would hang the 2FA leg.
    enable();
    const stub = installTurnstileStub();
    const { result } = renderHook(() => useTurnstile());

    const first = document.createElement('div');
    act(() => result.current.setContainer(first));
    await waitFor(() => expect(stub.renderedInto).toHaveLength(1));

    // React hands the outgoing node null, then the incoming node.
    const second = document.createElement('div');
    act(() => result.current.setContainer(null));
    act(() => result.current.setContainer(second));

    await waitFor(() => expect(stub.renderedInto).toHaveLength(2));
    expect(stub.renderedInto[1]).toBe(second);
    expect(stub.removed).toContain('widget-1');
  });

  it('drops the token on teardown so a stale one cannot be submitted', async () => {
    enable();
    const stub = installTurnstileStub();
    const { result } = renderHook(() => useTurnstile());

    const node = document.createElement('div');
    act(() => result.current.setContainer(node));
    await waitFor(() => expect(stub.options).not.toBeNull());
    act(() => stub.options?.callback?.('token-one'));
    await waitFor(() => expect(result.current.token).toBe('token-one'));

    act(() => result.current.setContainer(null));
    await waitFor(() => expect(result.current.token).toBeUndefined());
  });

  it('reset() clears the spent token and re-runs the challenge', async () => {
    enable();
    const stub = installTurnstileStub();
    const { result } = renderHook(() => useTurnstile());

    const node = document.createElement('div');
    act(() => result.current.setContainer(node));
    await waitFor(() => expect(stub.options).not.toBeNull());
    act(() => stub.options?.callback?.('token-one'));
    await waitFor(() => expect(result.current.token).toBe('token-one'));

    act(() => result.current.reset());

    // Without this the next attempt replays a spent token and Cloudflare
    // rejects it as timeout-or-duplicate.
    expect(stub.resets).toBe(1);
    expect(result.current.token).toBeUndefined();
  });

  it('surfaces a widget error and withholds the token', async () => {
    enable();
    const stub = installTurnstileStub();
    const { result } = renderHook(() => useTurnstile());

    const node = document.createElement('div');
    act(() => result.current.setContainer(node));
    await waitFor(() => expect(stub.options).not.toBeNull());

    act(() => stub.options?.['error-callback']?.());

    await waitFor(() => expect(result.current.error).toBe('turnstile-error'));
    expect(result.current.token).toBeUndefined();
  });

  it('clears the token when it expires, without alarming the guest', async () => {
    enable();
    const stub = installTurnstileStub();
    const { result } = renderHook(() => useTurnstile());

    const node = document.createElement('div');
    act(() => result.current.setContainer(node));
    await waitFor(() => expect(stub.options).not.toBeNull());
    act(() => stub.options?.callback?.('token-one'));
    await waitFor(() => expect(result.current.token).toBe('token-one'));

    act(() => stub.options?.['expired-callback']?.());

    await waitFor(() => expect(result.current.token).toBeUndefined());
    // refresh-expired: auto re-solves; this is not a failure to report.
    expect(result.current.error).toBeUndefined();
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

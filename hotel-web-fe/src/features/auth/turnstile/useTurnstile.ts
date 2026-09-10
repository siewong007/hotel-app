import { useCallback, useEffect, useRef, useState } from 'react';
import { shouldUseDesktopRuntime } from '../../../desktop/runtimeApi';

/**
 * Cloudflare Turnstile, guarding `POST /auth/login` and `POST /auth/register`.
 *
 * The widget renders **inline**, in the form, below the submit button: guests
 * get the familiar "Verify you are human" box rather than something that takes
 * over the screen. It solves on mount, so by the time a visitor has finished
 * typing there is normally already a token waiting and submitting costs them
 * nothing extra.
 *
 * Two details carry the design:
 *
 * * **The container is a callback ref, not a stable node.** `LoginPage` returns
 *   early for its 2FA step and its first-login prompt, so the form holding the
 *   widget is unmounted whenever the flow changes step. A widget rendered into
 *   a node React has since discarded is dead — Cloudflare still holds an id
 *   pointing at detached DOM, and no token ever arrives. Re-rendering whenever
 *   the node changes is what makes the 2FA leg work.
 * * **Tokens are single-use.** `reset()` must be called after every submit that
 *   actually reached the network, or the next attempt replays a spent token and
 *   Cloudflare rejects it as `timeout-or-duplicate`. Wrong password, the 2FA
 *   leg, and a resubmit after a server error all depend on this.
 */

interface TurnstileRenderOptions {
  sitekey: string;
  callback?: (token: string) => void;
  'error-callback'?: (code?: string) => void;
  'expired-callback'?: () => void;
  'timeout-callback'?: () => void;
  /** Re-solve automatically when a token expires while the form sits open. */
  'refresh-expired'?: 'auto' | 'manual' | 'never';
  theme?: 'auto' | 'light' | 'dark';
  size?: 'normal' | 'flexible' | 'compact';
}

interface TurnstileApi {
  render: (element: HTMLElement, options: TurnstileRenderOptions) => string | undefined;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const TURNSTILE_SCRIPT_SRC =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const TURNSTILE_SCRIPT_ID = 'cloudflare-turnstile-script';

/** Stable codes rather than English, so the caller translates them. */
export type TurnstileFailure = 'turnstile-error' | 'turnstile-expired' | 'turnstile-timeout';

/**
 * Whether this build challenges at all.
 *
 * Mirrors `isGoogleSignInAvailable`: desktop builds never challenge (the app
 * runs on the hotel's own machine against a local sidecar, and the packaged CSP
 * does not allow Cloudflare), and a build with no site key treats the feature
 * as absent rather than broken.
 */
export const isTurnstileEnabled = (): boolean =>
  !shouldUseDesktopRuntime() && Boolean(import.meta.env.VITE_TURNSTILE_SITE_KEY);

export interface UseTurnstileResult {
  /** False when this build does not challenge; callers should skip the box. */
  enabled: boolean;
  /** Attach to the element the inline widget should occupy. */
  setContainer: (node: HTMLDivElement | null) => void;
  /** The current unspent token, once the visitor has been verified. */
  token: string | undefined;
  /** Set when the widget could not verify; translate via `turnstileErrorMessage`. */
  error: TurnstileFailure | undefined;
  /** Discard the spent token and re-run. Call after every submit that hit the network. */
  reset: () => void;
}

export const useTurnstile = (): UseTurnstileResult => {
  const widgetIdRef = useRef<string | null>(null);
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const [token, setToken] = useState<string | undefined>(undefined);
  const [error, setError] = useState<TurnstileFailure | undefined>(undefined);
  const [scriptReady, setScriptReady] = useState<boolean>(
    typeof window !== 'undefined' && Boolean(window.turnstile),
  );

  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
  const enabled = isTurnstileEnabled();

  /** Puts a widget into `node`, replacing any previous one. */
  const renderInto = useCallback(
    (node: HTMLDivElement) => {
      if (!window.turnstile || !siteKey || widgetIdRef.current !== null) {
        return;
      }
      const id = window.turnstile.render(node, {
        sitekey: siteKey,
        'refresh-expired': 'auto',
        callback: (value: string) => {
          setToken(value);
          setError(undefined);
        },
        'error-callback': () => {
          setToken(undefined);
          setError('turnstile-error');
        },
        'expired-callback': () => {
          // Not an error the guest needs to see: refresh-expired re-solves.
          setToken(undefined);
        },
        'timeout-callback': () => {
          setToken(undefined);
          setError('turnstile-timeout');
        },
      });
      if (id !== undefined && id !== null) {
        widgetIdRef.current = id;
      }
    },
    [siteKey],
  );

  const teardown = useCallback(() => {
    const id = widgetIdRef.current;
    widgetIdRef.current = null;
    setToken(undefined);
    if (id !== null && window.turnstile) {
      window.turnstile.remove(id);
    }
  }, []);

  /**
   * Callback ref. React hands us `null` for the outgoing node and then the new
   * one, so a step change tears the old widget down and builds a fresh one —
   * which also mints the fresh token that leg needs.
   */
  const setContainer = useCallback(
    (node: HTMLDivElement | null) => {
      if (node === nodeRef.current) {
        return;
      }
      teardown();
      nodeRef.current = node;
      if (node && scriptReady) {
        renderInto(node);
      }
    },
    [renderInto, teardown, scriptReady],
  );

  // Load Cloudflare's script once per document.
  useEffect(() => {
    if (!enabled || !siteKey || scriptReady) {
      return;
    }
    if (window.turnstile) {
      setScriptReady(true);
      return;
    }
    let cancelled = false;
    const onLoad = () => {
      if (!cancelled) {
        setScriptReady(true);
      }
    };
    let script = document.getElementById(TURNSTILE_SCRIPT_ID) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement('script');
      script.id = TURNSTILE_SCRIPT_ID;
      script.src = TURNSTILE_SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
    script.addEventListener('load', onLoad);
    return () => {
      cancelled = true;
      script?.removeEventListener('load', onLoad);
    };
  }, [enabled, siteKey, scriptReady]);

  // The node can be attached before the script finishes loading; render then.
  useEffect(() => {
    if (scriptReady && nodeRef.current && widgetIdRef.current === null) {
      renderInto(nodeRef.current);
    }
  }, [scriptReady, renderInto]);

  // Remove the widget when the owning component goes away.
  useEffect(() => () => teardown(), [teardown]);

  const reset = useCallback(() => {
    setToken(undefined);
    setError(undefined);
    const id = widgetIdRef.current;
    if (id !== null && window.turnstile) {
      window.turnstile.reset(id);
    }
  }, []);

  return { enabled, setContainer, token, error, reset };
};

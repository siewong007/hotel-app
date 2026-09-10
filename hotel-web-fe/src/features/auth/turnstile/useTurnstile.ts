import { useCallback, useEffect, useRef } from 'react';
import { shouldUseDesktopRuntime } from '../../../desktop/runtimeApi';

/**
 * Cloudflare Turnstile, guarding `POST /auth/login` and `POST /auth/register`.
 *
 * The widget runs in **execute mode**: nothing is challenged on page load, and
 * a token is minted at the moment of submit. That matters because Turnstile
 * tokens are single-use and expire after ~5 minutes — a token issued when the
 * login page painted would routinely be dead by the time a user finished
 * typing, and would be *definitely* dead on the second `/auth/login` call that
 * carries the 2FA code. Minting per attempt makes every retry path correct:
 * wrong password, the 2FA leg, and a resubmit after a server error.
 *
 * The widget mounts into a container this hook attaches to `document.body`,
 * NOT into the React tree. The login page returns early for its 2FA step and
 * its first-login prompt, so a container rendered inside that tree would be
 * torn out of the DOM on a step change while Cloudflare still held a widget id
 * pointing at the removed node — `execute()` would then never call back, and
 * the 2FA leg would hang until the timeout. Owning the node sidesteps that
 * entire class of bug and keeps callers down to `const { getToken } = ...`.
 */

interface TurnstileRenderOptions {
  sitekey: string;
  execution?: 'render' | 'execute';
  appearance?: 'always' | 'execute' | 'interaction-only';
  callback?: (token: string) => void;
  'error-callback'?: (code?: string) => void;
  'expired-callback'?: () => void;
  'timeout-callback'?: () => void;
  'before-interactive-callback'?: () => void;
  'after-interactive-callback'?: () => void;
}

interface TurnstileApi {
  render: (element: HTMLElement, options: TurnstileRenderOptions) => string | undefined;
  execute: (widgetId: string) => void;
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
const TURNSTILE_CONTAINER_ID = 'cloudflare-turnstile-container';

/** How long to wait for Cloudflare to hand back a token before giving up. */
export const TURNSTILE_TOKEN_TIMEOUT_MS = 30_000;

/**
 * Reasons `getToken` can reject, as stable codes rather than English text so
 * the caller translates them. Every one of them is a "we could not verify you"
 * outcome — none of them should be treated as a pass.
 */
export type TurnstileFailure =
  | 'turnstile-unavailable'
  | 'turnstile-error'
  | 'turnstile-expired'
  | 'turnstile-timeout';

/**
 * Whether this build can challenge at all.
 *
 * Mirrors `isGoogleSignInAvailable`: desktop builds never challenge (the app
 * runs on a hotel's own machine against a local sidecar, and the packaged CSP
 * does not allow Cloudflare), and a build with no site key treats the feature
 * as absent rather than broken.
 */
export const isTurnstileEnabled = (): boolean =>
  !shouldUseDesktopRuntime() && Boolean(import.meta.env.VITE_TURNSTILE_SITE_KEY);

export interface UseTurnstileResult {
  /** False when this build does not challenge. */
  enabled: boolean;
  /**
   * Mints a FRESH token for one request. Resolves `undefined` when Turnstile is
   * disabled, so callers can pass the result straight through unconditionally.
   * Rejects with a `TurnstileFailure` code as the message when it cannot.
   */
  getToken: () => Promise<string | undefined>;
}

/** The always-present, normally-hidden host node for the invisible widget. */
const ensureContainer = (): HTMLElement => {
  const existing = document.getElementById(TURNSTILE_CONTAINER_ID);
  if (existing) {
    return existing;
  }
  const container = document.createElement('div');
  container.id = TURNSTILE_CONTAINER_ID;
  // Hidden until an interactive challenge actually needs to be shown, and
  // never able to swallow a click while hidden.
  container.style.position = 'fixed';
  container.style.inset = '0';
  container.style.display = 'none';
  container.style.alignItems = 'center';
  container.style.justifyContent = 'center';
  container.style.zIndex = '2000';
  container.style.background = 'rgba(0, 0, 0, 0.4)';
  document.body.appendChild(container);
  return container;
};

const setContainerVisible = (visible: boolean): void => {
  const container = document.getElementById(TURNSTILE_CONTAINER_ID);
  if (container) {
    container.style.display = visible ? 'flex' : 'none';
  }
};

export const useTurnstile = (): UseTurnstileResult => {
  const widgetIdRef = useRef<string | null>(null);
  const pendingRef = useRef<{
    resolve: (token: string) => void;
    reject: (error: Error) => void;
  } | null>(null);

  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
  const enabled = isTurnstileEnabled();

  const settle = useCallback((outcome: { token: string } | { failure: string }) => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    setContainerVisible(false);
    if (!pending) {
      return;
    }
    if ('token' in outcome) {
      pending.resolve(outcome.token);
    } else {
      pending.reject(new Error(outcome.failure));
    }
  }, []);

  useEffect(() => {
    if (!enabled || !siteKey) {
      return;
    }

    let cancelled = false;

    const renderWidget = () => {
      // StrictMode double-invokes effects; a second render() would leave an
      // orphaned widget whose callbacks still fire into this hook.
      if (cancelled || widgetIdRef.current !== null || !window.turnstile) {
        return;
      }
      const widgetId = window.turnstile.render(ensureContainer(), {
        sitekey: siteKey,
        execution: 'execute',
        appearance: 'interaction-only',
        callback: (token: string) => settle({ token }),
        'error-callback': () => settle({ failure: 'turnstile-error' }),
        'expired-callback': () => settle({ failure: 'turnstile-expired' }),
        'timeout-callback': () => settle({ failure: 'turnstile-timeout' }),
        // The overlay appears ONLY when Cloudflare decides this visitor has to
        // interact. The common case resolves silently in well under a second,
        // and flashing a full-screen scrim on every login would be worse than
        // no challenge at all.
        'before-interactive-callback': () => setContainerVisible(true),
        'after-interactive-callback': () => setContainerVisible(false),
      });
      if (widgetId !== undefined && widgetId !== null) {
        widgetIdRef.current = widgetId;
      }
    };

    if (window.turnstile) {
      renderWidget();
      return () => {
        cancelled = true;
      };
    }

    let script = document.getElementById(TURNSTILE_SCRIPT_ID) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement('script');
      script.id = TURNSTILE_SCRIPT_ID;
      script.src = TURNSTILE_SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
    script.addEventListener('load', renderWidget);

    return () => {
      cancelled = true;
      script?.removeEventListener('load', renderWidget);
      const widgetId = widgetIdRef.current;
      widgetIdRef.current = null;
      settle({ failure: 'turnstile-unavailable' });
      if (widgetId !== null && window.turnstile) {
        window.turnstile.remove(widgetId);
      }
    };
  }, [enabled, siteKey, settle]);

  const getToken = useCallback((): Promise<string | undefined> => {
    if (!enabled) {
      return Promise.resolve(undefined);
    }
    const widgetId = widgetIdRef.current;
    if (widgetId === null || !window.turnstile) {
      // The script is blocked (ad blocker, offline, CSP) or still loading.
      // Fail closed and say so — the backend would reject the request anyway,
      // and "verification unavailable" beats an unexplained 400.
      return Promise.reject(new Error('turnstile-unavailable'));
    }

    // Abandon any attempt still in flight so its callback cannot resolve this one.
    settle({ failure: 'turnstile-unavailable' });

    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => settle({ failure: 'turnstile-timeout' }),
        TURNSTILE_TOKEN_TIMEOUT_MS,
      );

      pendingRef.current = {
        resolve: (token: string) => {
          clearTimeout(timer);
          resolve(token);
        },
        reject: (error: Error) => {
          clearTimeout(timer);
          reject(error);
        },
      };

      // reset() discards the previous single-use token, so execute() always
      // produces a new one rather than replaying a spent challenge.
      window.turnstile?.reset(widgetId);
      window.turnstile?.execute(widgetId);
    });
  }, [enabled, settle]);

  return { enabled, getToken };
};

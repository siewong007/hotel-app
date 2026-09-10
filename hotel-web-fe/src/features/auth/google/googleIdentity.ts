/**
 * Shared plumbing for Google Identity Services (GSI).
 *
 * Both doors into a Google session — the rendered button and the One Tap
 * prompt — need the same script tag, the same availability rule, and the same
 * sign-out counterpart. Keeping one copy is not tidiness: the script must be
 * injected exactly once per document, and `initialize()` is a global whose last
 * call wins, so two modules each carrying their own loader would race.
 */

import { shouldUseDesktopRuntime } from '../../../desktop/runtimeApi';

/**
 * Minimal shape of the GSI global — only the members this codebase calls.
 * Declared once here; the button and the One Tap hook both borrow it.
 */
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: {
              credential: string;
              /**
               * How the credential was obtained. `auto` means automatic
               * sign-in: nothing was shown and nothing was clicked, so the
               * guest needs telling that they are now signed in. Everything
               * else was a deliberate tap on the prompt or the button.
               */
              select_by?: string;
            }) => void;
            /** Drives Google's own wording: "Sign in as" vs "Sign up as". */
            context?: 'signin' | 'signup' | 'use';
            /**
             * Automatic sign-in. When Google holds exactly one session that has
             * already consented to this client, the callback fires with no UI
             * at all. `disableAutoSelect()` is what switches it back off, which
             * is why signing out of our app must call it.
             */
            auto_select?: boolean;
            /**
             * One Tap runs on FedCM (the browser's own identity UI) now that
             * third-party cookies are going away. Passing it explicitly keeps
             * the behaviour readable rather than depending on the SDK default
             * of the day.
             */
            use_fedcm_for_prompt?: boolean;
          }) => void;
          renderButton: (
            parent: HTMLElement,
            options: {
              theme?: string;
              size?: string;
              width?: number | string;
              text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
              /** `standard` carries a label; `icon` is the G logo alone. */
              type?: 'standard' | 'icon';
              shape?: 'rectangular' | 'pill' | 'circle' | 'square';
            }
          ) => void;
          /** Shows the One Tap prompt. No-op while one is already open. */
          prompt: () => void;
          /** Closes an open One Tap prompt. */
          cancel: () => void;
          /**
           * Clears the account Google has bound to this client. Google's
           * guidance is to call this on sign-out; until it is called Google
           * keeps rendering the personalised "Sign in as <name>" button and may
           * auto-select that account on the next visit.
           */
          disableAutoSelect: () => void;
        };
      };
    };
  }
}

export const GSI_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';
export const GSI_SCRIPT_ID = 'google-identity-services-script';

/** The configured OAuth client id, or undefined when this build has none. */
export const googleClientId = (): string | undefined =>
  import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

/**
 * Whether this build can offer Google sign-in at all.
 *
 * The button hides itself when it cannot render, but a caller that frames it —
 * an "or" divider, a heading, a surrounding section — has to make the same
 * decision or it is left pointing at nothing. That is exactly what shipped:
 * production has no client id, so both auth pages drew a bare "or" rule with
 * empty space beneath it.
 */
export const isGoogleSignInAvailable = (): boolean =>
  !shouldUseDesktopRuntime() && Boolean(googleClientId());

/**
 * Runs `onReady` once the GSI script has loaded, injecting it if needed.
 *
 * Returns a cancel function. Calling it stops a load that is still in flight
 * from firing `onReady` after the caller has gone away — a React effect that
 * unmounts mid-load must not initialise against a detached container.
 *
 * The script tag is reused across callers (StrictMode double-invoke, the button
 * and One Tap on the same document, a remount during navigation) because a
 * second copy would re-run the SDK's own bootstrap.
 */
export function whenGoogleIdentityReady(onReady: () => void): () => void {
  let cancelled = false;
  const run = () => {
    if (!cancelled) onReady();
  };

  if (window.google) {
    run();
    return () => {
      cancelled = true;
    };
  }

  let script = document.getElementById(GSI_SCRIPT_ID) as HTMLScriptElement | null;
  if (!script) {
    script = document.createElement('script');
    script.id = GSI_SCRIPT_ID;
    script.src = GSI_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
  }
  script.addEventListener('load', run);

  return () => {
    cancelled = true;
    script?.removeEventListener('load', run);
  };
}

/**
 * Tells Google to forget the account bound to this client.
 *
 * Without this, signing out of the hotel app leaves Google's own session
 * association intact: the next visitor to the sign-in OR registration page is
 * shown a personalised "Sign in as <previous person>" button, which on a shared
 * or public machine surfaces the last guest's name and email to a stranger. It
 * is also what stops One Tap and automatic sign-in from re-signing in someone
 * who has just deliberately signed out. Google documents this call as the
 * sign-out counterpart to `initialize`.
 *
 * Safe to call when the script never loaded — a signed-out user whose network
 * blocked Google must not have logout throw.
 */
export const disableGoogleAutoSelect = (): void => {
  try {
    window.google?.accounts.id.disableAutoSelect();
  } catch {
    // Never let a Google-side failure break signing out of our own app.
  }
};

/** Closes an open One Tap prompt, tolerating a missing or throwing SDK. */
export const cancelGoogleOneTap = (): void => {
  try {
    window.google?.accounts.id.cancel();
  } catch {
    // A prompt we cannot close must not break navigation away from the page.
  }
};

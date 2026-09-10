import React, { useEffect, useRef } from 'react';
import { Box } from '@mui/material';
import { shouldUseDesktopRuntime } from '../../../desktop/runtimeApi';

// Minimal shape of the Google Identity Services global — only the members
// this component actually calls.
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
            /** Drives Google's own wording: "Sign in as" vs "Sign up as". */
            context?: 'signin' | 'signup' | 'use';
          }) => void;
          renderButton: (
            parent: HTMLElement,
            options: {
              theme?: string;
              size?: string;
              width?: number | string;
              text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
            }
          ) => void;
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

const GSI_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';
const GSI_SCRIPT_ID = 'google-identity-services-script';

export interface GoogleSignInButtonProps {
  onCredential: (credential: string) => void | Promise<void>;
  /**
   * Which journey this button belongs to. Registration must pass 'signup', or
   * Google labels it "Sign in with Google" / "Sign in as <name>" on a page
   * whose whole purpose is creating an account.
   */
  context?: 'signin' | 'signup';
}

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
  !shouldUseDesktopRuntime() && Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID);

/**
 * Renders Google's own "Sign in with Google" button via the Google Identity
 * Services (GSI) script. Never rendered for desktop builds — Google sign-in
 * is a web-only, guest-facing feature — and a no-op when the backend hasn't
 * configured a client id (treat as "feature unavailable", not an error).
 */
export const GoogleSignInButton: React.FC<GoogleSignInButtonProps> = ({
  onCredential,
  context = 'signin',
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onCredentialRef = useRef(onCredential);
  onCredentialRef.current = onCredential;

  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
  const disabled = !isGoogleSignInAvailable();

  useEffect(() => {
    if (disabled || !clientId) {
      return;
    }

    let cancelled = false;

    const renderGoogleButton = () => {
      if (cancelled || !containerRef.current || !window.google) {
        return;
      }
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: ({ credential }) => void onCredentialRef.current(credential),
        context,
      });
      window.google.accounts.id.renderButton(containerRef.current, {
        theme: 'outline',
        size: 'large',
        width: containerRef.current.clientWidth,
        text: context === 'signup' ? 'signup_with' : 'signin_with',
      });
    };

    if (window.google) {
      renderGoogleButton();
      return () => {
        cancelled = true;
      };
    }

    // Guard against injecting the script more than once across mounts
    // (StrictMode double-invoke, or the button appearing on both the login
    // and register pages within the same session).
    let script = document.getElementById(GSI_SCRIPT_ID) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement('script');
      script.id = GSI_SCRIPT_ID;
      script.src = GSI_SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
    script.addEventListener('load', renderGoogleButton);

    return () => {
      cancelled = true;
      script?.removeEventListener('load', renderGoogleButton);
    };
  }, [clientId, disabled, context]);

  if (disabled) {
    return null;
  }

  return <Box ref={containerRef} sx={{ display: 'flex', justifyContent: 'center', width: '100%' }} />;
};

/**
 * Tells Google to forget the account bound to this client.
 *
 * Without this, signing out of the hotel app leaves Google's own session
 * association intact: the next visitor to the sign-in OR registration page is
 * shown a personalised "Sign in as <previous person>" button, which on a shared
 * or public machine surfaces the last guest's name and email to a stranger.
 * Google documents this call as the sign-out counterpart to `initialize`.
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

export default GoogleSignInButton;

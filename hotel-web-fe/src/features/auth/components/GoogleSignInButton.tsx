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
          }) => void;
          renderButton: (
            parent: HTMLElement,
            options: { theme?: string; size?: string; width?: number | string }
          ) => void;
        };
      };
    };
  }
}

const GSI_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';
const GSI_SCRIPT_ID = 'google-identity-services-script';

export interface GoogleSignInButtonProps {
  onCredential: (credential: string) => void | Promise<void>;
}

/**
 * Renders Google's own "Sign in with Google" button via the Google Identity
 * Services (GSI) script. Never rendered for desktop builds — Google sign-in
 * is a web-only, guest-facing feature — and a no-op when the backend hasn't
 * configured a client id (treat as "feature unavailable", not an error).
 */
export const GoogleSignInButton: React.FC<GoogleSignInButtonProps> = ({ onCredential }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onCredentialRef = useRef(onCredential);
  onCredentialRef.current = onCredential;

  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
  const disabled = shouldUseDesktopRuntime() || !clientId;

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
      });
      window.google.accounts.id.renderButton(containerRef.current, {
        theme: 'outline',
        size: 'large',
        width: containerRef.current.clientWidth,
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
  }, [clientId, disabled]);

  if (disabled) {
    return null;
  }

  return <Box ref={containerRef} sx={{ display: 'flex', justifyContent: 'center', width: '100%' }} />;
};

export default GoogleSignInButton;

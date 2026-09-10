import React, { useEffect, useRef } from 'react';
import { Box } from '@mui/material';
import {
  googleClientId,
  isGoogleSignInAvailable,
  whenGoogleIdentityReady,
} from '../google/googleIdentity';

// The GSI global's type, the script loader, the availability rule and the
// sign-out counterpart are shared with the One Tap prompt — see
// ../google/googleIdentity.ts. Re-exported here because every existing caller
// imports them from this module.
export { isGoogleSignInAvailable, disableGoogleAutoSelect } from '../google/googleIdentity';

export interface GoogleSignInButtonProps {
  onCredential: (credential: string) => void | Promise<void>;
  /**
   * Google's button type. `standard` is the labelled button, and at this size
   * it is the one that becomes the personalised "Sign in as <name>" variant
   * once Google holds an approved session. `icon` is the G logo alone — no
   * name, no email — for places too tight for a full-width button.
   */
  type?: 'standard' | 'icon';
}

/**
 * Renders Google's own "Continue with Google" button via the Google Identity
 * Services (GSI) script. Never rendered for desktop builds — Google sign-in
 * is a web-only, guest-facing feature — and a no-op when the backend hasn't
 * configured a client id (treat as "feature unavailable", not an error).
 */
export const GoogleSignInButton: React.FC<GoogleSignInButtonProps> = ({
  onCredential,
  type = 'standard',
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onCredentialRef = useRef(onCredential);
  onCredentialRef.current = onCredential;

  const clientId = googleClientId();
  const disabled = !isGoogleSignInAvailable();

  useEffect(() => {
    if (disabled || !clientId) {
      return;
    }

    return whenGoogleIdentityReady(() => {
      if (!containerRef.current || !window.google) {
        return;
      }
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: ({ credential }) => void onCredentialRef.current(credential),
        // 'use' rather than 'signin'/'signup': there is one Google door now, and
        // it both signs in and creates the account. Asking Google to pick a side
        // would have it label half its visitors wrongly.
        context: 'use',
      });
      window.google.accounts.id.renderButton(containerRef.current, {
        theme: 'outline',
        size: 'large',
        type,
        // An icon button is square by definition; stretching it to the
        // container's width is what draws a G logo in a wide empty box.
        ...(type === 'icon'
          ? {}
          : { width: containerRef.current.clientWidth }),
        // "Continue with Google" — the same credential signs in an existing
        // guest and creates a new one, so a sign-in/sign-up split would be a
        // distinction the flow no longer makes.
        text: 'continue_with',
      });
    });
  }, [clientId, disabled, type]);

  if (disabled) {
    return null;
  }

  return <Box ref={containerRef} sx={{ display: 'flex', justifyContent: 'center', width: '100%' }} />;
};

export default GoogleSignInButton;

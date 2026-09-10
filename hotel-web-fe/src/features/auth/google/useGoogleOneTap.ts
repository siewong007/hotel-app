/**
 * One Tap and automatic sign-in for the public guest pages.
 *
 * Two Google mechanisms, one `initialize()` call:
 *
 * - **One Tap** is the "Continue as <name>" prompt Google raises without the
 *   visitor clicking anything. It is what `prompt()` requests.
 * - **Automatic sign-in** is `auto_select: true`: when Google holds exactly one
 *   session that has already consented to this client, the callback fires with
 *   no UI at all and the guest is simply signed in.
 *
 * Both are switched off for anyone who has deliberately signed out, because
 * `logout()` calls `disableAutoSelect()` — that is the same call that stops the
 * button rendering the previous guest's name, and it governs these two as well.
 *
 * This door signs in EXISTING guests only, and deliberately sends no consent
 * payload. Account creation is governed by a notice that has to be visible at
 * the moment of the act, and neither of these mechanisms has a surface to show
 * it on: One Tap's confirmation happens inside Google's own UI, and automatic
 * sign-in shows nothing at all. So a first-time Google identity gets the
 * backend's 400 and a message pointing at the sign-in page, where the notice
 * sits under the button. Anything else would be recording an agreement to text
 * the guest was never shown.
 *
 * Deliberately prompts **once per mount**. A visitor lands on the booking page
 * with an empty form, which is the moment where signing in costs them nothing;
 * re-prompting as they move through the steps would interrupt a booking that is
 * already under way. `enabled` going false (they signed in, or navigated to a
 * page off the allowlist) closes an open prompt rather than leaving it floating
 * over the next screen.
 */

import { useEffect, useRef } from 'react';
import { useNavigate } from '../../../router';
import { useAuth } from '../../../auth/AuthContext';
import { useTranslation } from '../../../i18n';
import { storage } from '../../../utils/storage';
import { emitApiNotification } from '../../../utils/apiNotifications';
import {
  cancelGoogleOneTap,
  googleClientId,
  isGoogleSignInAvailable,
  whenGoogleIdentityReady,
} from './googleIdentity';
import { googleSignInErrorMessage } from './googleSignInError';

export interface UseGoogleOneTapOptions {
  /** False on any page that must not raise the prompt. */
  enabled: boolean;
  /**
   * Where to send a guest whose profile is still incomplete, as a `redirect`
   * value for `/complete-profile`. Only the allowlisted booking destination is
   * ever passed; anything else falls back to the portal dashboard.
   */
  completeProfileRedirect?: string | null;
}

export function useGoogleOneTap({
  enabled,
  completeProfileRedirect = null,
}: UseGoogleOneTapOptions): void {
  const { isAuthenticated, isLoading, loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation('auth');

  // Kept in refs so a re-render caused by any of them cannot re-fire the
  // prompt: the effect below depends only on whether prompting is allowed.
  const loginWithGoogleRef = useRef(loginWithGoogle);
  loginWithGoogleRef.current = loginWithGoogle;
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const translateRef = useRef(t);
  translateRef.current = t;
  const redirectRef = useRef(completeProfileRedirect);
  redirectRef.current = completeProfileRedirect;

  const promptedRef = useRef(false);

  const allowed =
    enabled && !isLoading && !isAuthenticated && isGoogleSignInAvailable();

  useEffect(() => {
    if (!allowed) {
      // Covers both "signed in via this very prompt" and "navigated away".
      cancelGoogleOneTap();
      return;
    }
    if (promptedRef.current) return;

    const clientId = googleClientId();
    if (!clientId) return;
    promptedRef.current = true;

    const cancelLoad = whenGoogleIdentityReady(() => {
      window.google?.accounts.id.initialize({
        client_id: clientId,
        context: 'signin',
        auto_select: true,
        use_fedcm_for_prompt: true,
        callback: ({ credential, select_by: selectBy }) => {
          void (async () => {
            try {
              await loginWithGoogleRef.current(credential);

              // Automatic sign-in shows nothing at all, so without this the
              // guest's name simply appears in the header with no explanation
              // of what just happened. One Tap needs no such note — they
              // clicked "Continue as", so they know.
              if (selectBy === 'auto') {
                emitApiNotification({
                  message: translateRef.current('login.googleAutoSignedIn'),
                  severity: 'success',
                });
              }

              // Route by the freshly-stored account, same as the sign-in page
              // does — a guest whose profile is still missing required fields
              // must finish that step before anything else. Otherwise stay
              // exactly where they were: not moving the reader is the whole
              // point of signing in without leaving the page.
              const storedUser = storage.getItem<{ profile_complete?: boolean }>('user');
              if (storedUser?.profile_complete === false) {
                const redirect = redirectRef.current;
                navigateRef.current(
                  redirect
                    ? `/complete-profile?redirect=${encodeURIComponent(redirect)}`
                    : '/complete-profile',
                  { replace: true }
                );
              }
            } catch (error) {
              // A first-time Google identity lands here, on the 400 the missing
              // consent payload produces — googleSignInErrorMessage turns that
              // into the "continue on the sign-in page" sentence.
              emitApiNotification({
                message: googleSignInErrorMessage(error, translateRef.current),
                severity: 'warning',
              });
            }
          })();
        },
      });
      window.google?.accounts.id.prompt();
    });

    return () => {
      cancelLoad();
      cancelGoogleOneTap();
    };
  }, [allowed]);
}

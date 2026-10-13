import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from '../../../router';
import { returnFromAuthPage, safeGuestRedirect, safeStaffRedirect } from '../guestRedirect';
import { isGoogleSignInOnly } from '../googleSignInOnly';
import {
  Box,
  Container,
  Paper,
  TextField,
  Button,
  Typography,
  Alert,
  Fade,
  IconButton,
  InputAdornment,
  Collapse,
  CircularProgress,
  Divider,
} from '@mui/material';
import {
  ArrowBack as ArrowBackIcon,
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
} from '@mui/icons-material';
import { useAuth } from '../../../auth/AuthContext';
import { storage } from '../../../utils/storage';
import FirstLoginPasskeyPrompt from './FirstLoginPasskeyPrompt';
import { GuestPortalDashboardService } from '../../guestPortal/api/guestPortalDashboard.service';
import { setPortalToken } from '../../guestPortal/api/portalTokenStore';
import { GoogleSignInButton, isGoogleSignInAvailable } from './GoogleSignInButton';
import { googleSignInErrorMessage } from '../google/googleSignInError';
import { ConsentNotice } from '../../legal/components/ConsentNotice';
import { REGISTRATION_NOTICE } from '../../legal/content';
import { buildNoticeConsentPayload } from '../../legal/noticeConsent';
import { useLegalLocale } from '../../legal/LegalLocaleContext';
import { notifyBackupCodeUsed } from '../utils/twoFactorCode';
import {
  isTwoFactorExpired,
  isTwoFactorInvalid,
  readTwoFactorAttemptsRemaining,
  readTwoFactorChallenge,
  type TwoFactorChallenge as SecondFactorChallenge,
} from '../twoFactorChallenge';
import type { TwoFactorView } from './twoFactor/TwoFactorChallenge';
import { AuthService } from '../../../api';
import type { LoginResult } from '../../../auth/AuthContext';
import { guestErrorMessage } from '../../guestPortal/utils/feedback';
import {
  isTwoFactorEnrollmentRequired,
  TWO_FACTOR_ENROLLMENT_PATH,
} from '../twoFactorEnrollment';
import { LanguageSwitcher } from '../../../components/common/LanguageSwitcher';
import { useTranslation } from '../../../i18n';
import { useTurnstile } from '../turnstile/useTurnstile';
import { turnstileErrorMessage } from '../turnstile/turnstileError';
import { useAutoFocusError } from '../../../hooks/useAutoFocusError';

/** The second-factor step is only ever seen by accounts that have one, so it
 *  ships as its own chunk; `preloadTwoFactorStep` warms it while the password
 *  request is in flight. */
const loadTwoFactorStep = () => import('./twoFactor/TwoFactorChallenge');
const TwoFactorChallenge = lazy(loadTwoFactorStep);
const preloadTwoFactorStep = () => {
  void loadTwoFactorStep().catch(() => {
    // The lazy() render retries the import and surfaces a real failure.
  });
};

/** `?two_factor=backup` is the backup-code page of the second-factor step: it
 *  has its own history entry, so the browser Back button returns to the
 *  sign-in options instead of leaving the sign-in altogether. */
const TWO_FACTOR_PARAM = 'two_factor';
const BACKUP_VIEW = 'backup';

const LoginPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  // Where the reader was headed before auth interrupted them — drives the
  // "sign in to continue" notice and the post-login restore.
  const interruptedDestination =
    safeGuestRedirect(searchParams.get('redirect')) ??
    safeStaffRedirect(searchParams.get('redirect'));
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showFirstLoginPrompt, setShowFirstLoginPrompt] = useState(false);
  // Set once the password was accepted and the account still owes a second
  // factor: which methods it has, and the token binding a passkey to it.
  const [challenge, setChallenge] = useState<SecondFactorChallenge | null>(null);
  const [twoFactorView, setTwoFactorView] = useState<TwoFactorView>('methods');
  // Bumped after a rejected code so the step clears and refocuses its input.
  const [codeResetKey, setCodeResetKey] = useState(0);
  const { login, loginWithGoogle, completeTwoFactorWithPasskey } = useAuth();
  const { t } = useTranslation('auth');
  const { locale: legalLocale } = useLegalLocale();
  const turnstile = useTurnstile();
  // The inline widget solves on mount, but a guest can still out-run it -- most
  // easily on the 2FA step, where it remounts and the code is only six digits.
  // Holding the button beats rejecting a submit the guest cannot yet fix; an
  // outright widget failure leaves it enabled so the error explains itself.
  const awaitingTurnstile = turnstile.enabled && !turnstile.token && !turnstile.error;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // Shared by the sign-in and 2FA renders — they are mutually exclusive, so the
  // ref always lands on whichever alert is mounted.
  const errorRef = useAutoFocusError(error);

  const twoFactorParam = searchParams.get(TWO_FACTOR_PARAM);
  const previousTwoFactorParam = useRef(twoFactorParam);
  useEffect(() => {
    const previous = previousTwoFactorParam.current;
    previousTwoFactorParam.current = twoFactorParam;
    // Browser Back from the backup-code page: the param went away.
    if (previous === BACKUP_VIEW && twoFactorParam !== BACKUP_VIEW) {
      setTwoFactorView('methods');
      setError('');
    }
    // Forward again onto the backup page while the challenge is still live.
    if (previous !== BACKUP_VIEW && twoFactorParam === BACKUP_VIEW && challenge) {
      setTwoFactorView('backup');
    }
  }, [twoFactorParam, challenge]);

  /** Write (or drop) the backup-page marker, keeping `?redirect=` and the rest. */
  const writeTwoFactorParam = useCallback(
    (value: string | null, replace: boolean) => {
      const next = new URLSearchParams(searchParams);
      if (value) {
        next.set(TWO_FACTOR_PARAM, value);
      } else {
        next.delete(TWO_FACTOR_PARAM);
      }
      previousTwoFactorParam.current = value;
      setSearchParams(next, { replace });
    },
    [searchParams, setSearchParams]
  );

  // A reload or shared link onto the backup page has no password-verified
  // challenge behind it: drop the marker and show the plain sign-in.
  useEffect(() => {
    if (!challenge && twoFactorParam) {
      writeTwoFactorParam(null, true);
    }
  }, [challenge, twoFactorParam, writeTwoFactorParam]);

  const completeSignIn = () => {
    // Route by the authenticated account's actual type. Guest and staff share
    // this form; a guest must still land on the guest portal, and staff on
    // the admin workspace.
    const account = storage.getItem<{ user_type?: 'admin' | 'guest' }>('user')?.user_type;

    if (account === 'guest') {
      // Pre-warm the portal session so the landing page's guest links open
      // instantly. This must remain fully best-effort: Safari can leave this
      // follow-up request pending while it settles the new auth cookie, and a
      // pending pre-warm must never make a successful sign-in appear frozen.
      // Portal entry bootstraps its own session when this request fails or has
      // not completed yet.
      void GuestPortalDashboardService.createSession()
        .then((portalSession) => {
          queryClient.removeQueries({ queryKey: ['promotions', 'portal'] });
          setPortalToken(portalSession.token, portalSession.expires_at);
        })
        .catch(() => {
          // usePortalSessionBootstrap re-creates the session on portal entry.
        });
    }

    // Enter the authenticated shell directly. Routing staff through the public
    // model page discards the in-memory access token and can also revive a
    // stale lazy-route module when they return to the app.
    //
    // A guest who came here from the booking flow goes back to it. Without
    // this, signing in mid-booking silently dropped the booking and landed on
    // the dashboard instead.
    const guestDestination =
      safeGuestRedirect(searchParams.get('redirect')) ?? '/guest-portal';
    // Staff bounced by a ProtectedRoute go back to the screen they asked for
    // (validated against the route registry — never an arbitrary URL).
    const staffDestination =
      safeStaffRedirect(searchParams.get('redirect')) ?? '/admin-portal';
    navigate(account === 'guest' ? guestDestination : staffDestination, { replace: true });
  };

  const handleBack = () => returnFromAuthPage(navigate, searchParams.get('redirect'));

  const handleFirstLoginPromptClose = () => {
    setShowFirstLoginPrompt(false);
    completeSignIn();
  };

  /** The one call that actually signs in. `code` is set only on the second
   *  leg, once the user has picked a method and entered it. */
  const submitCredentials = async (identifier: string, code?: string) => {
    // The inline widget normally solves while the guest is still typing, so a
    // missing token means it either failed or has not finished. Say which,
    // rather than sending a request the backend rejects with a 400 that reads
    // like the password was wrong.
    if (turnstile.enabled && !turnstile.token) {
      setError(
        turnstile.error
          ? turnstileErrorMessage(new Error(turnstile.error), t)
          : t('turnstile.incomplete')
      );
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      if (!code) {
        preloadTwoFactorStep();
      }
      const result = await login(identifier, password, code || undefined, turnstile.token);
      // The token was spent the moment that request went out. Re-solve now so a
      // 2FA leg, or a retry after a wrong password, never replays it --
      // Cloudflare rejects a replay as timeout-or-duplicate.
      turnstile.reset();
      finishSignIn(result);
    } catch (err) {
      // Spent on the way out regardless of the outcome.
      turnstile.reset();

      // Enrolment is overdue, so the backend refused this sign-in outright.
      // Matched on the stable body code, never the message: that copy is
      // user-facing prose and is translated.
      if (isTwoFactorEnrollmentRequired(err)) {
        setError(t('twoFactorEnrollment.blocked'));
        setLoading(false);
        return;
      }

      // The password was right and this account carries a second factor.
      const nextChallenge = readTwoFactorChallenge(err);
      if (nextChallenge) {
        setChallenge(nextChallenge);
        if (!code) {
          setTwoFactorView('methods');
        }
        setError('');
        setLoading(false);
        return;
      }

      // A wrong authenticator or backup code. It cost a sign-in attempt, so
      // say how many are left before the account locks.
      if (isTwoFactorInvalid(err)) {
        const remaining = readTwoFactorAttemptsRemaining(err);
        setError(
          remaining === null
            ? t('twoFactor.invalidCodeGeneric')
            : t('twoFactor.invalidCode', { count: remaining })
        );
        setCodeResetKey((key) => key + 1);
        setLoading(false);
        return;
      }

      // Anything else on the code leg (most often the lockout itself) ends the
      // second-factor step; the reason shows on the sign-in form.
      if (code) {
        leaveTwoFactor();
      }
      // A Google-created account has no password: point at the Google button.
      if (isGoogleSignInOnly(err)) {
        setError(t('login.googleSignInOnly'));
        setLoading(false);
        return;
      }
      setError(guestErrorMessage(err, t('login.failed')));
      setLoading(false);
    }
  };

  /** A signed-in result, from the password leg, a code, or a passkey. */
  const finishSignIn = (result: LoginResult) => {
    const {
      isFirstLogin,
      recoveryCodesRemaining,
      twoFactorEnrollmentRequired,
      twoFactorEnrollmentDeadline,
    } = result;
    if (recoveryCodesRemaining !== undefined) {
      const account = storage.getItem<{ user_type?: 'admin' | 'guest' }>('user')?.user_type;
      notifyBackupCodeUsed(recoveryCodesRemaining, account === 'guest');
    }
    // The session is valid, but this account's role requires a second factor
    // and the grace window is running. Enrolment comes before the workspace;
    // once that window closes the backend refuses the sign-in outright.
    if (twoFactorEnrollmentRequired) {
      navigate(
        twoFactorEnrollmentDeadline
          ? `${TWO_FACTOR_ENROLLMENT_PATH}?deadline=${encodeURIComponent(twoFactorEnrollmentDeadline)}`
          : TWO_FACTOR_ENROLLMENT_PATH,
        { replace: true }
      );
      return;
    }
    if (isFirstLogin) {
      // The prompt stays on this URL; the backup-page marker must not.
      if (twoFactorParam) {
        writeTwoFactorParam(null, true);
      }
      setShowFirstLoginPrompt(true);
      setLoading(false);
    } else {
      completeSignIn();
    }
  };

  /** Single-step sign-in: the account is confirmed to exist, then the password
   *  it was typed with is submitted straight away. */
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const identifier = username.trim();
    if (!identifier || identifier.length < 3) {
      setError(t('login.usernameInvalid'));
      return;
    }

    setLoading(true);

    // The lookup is intentionally non-committal server-side (it returns a
    // constant answer so the endpoint can't be used to enumerate accounts);
    // unknown identifiers proceed to the password step and fail with the
    // generic credential rejection.
    let exists: boolean;
    try {
      ({ exists } = await AuthService.lookupLoginIdentifier(identifier));
    } catch (err) {
      setError(guestErrorMessage(err, t('login.lookupFailed')));
      setLoading(false);
      return;
    }

    if (!exists) {
      setError(t('login.accountNotFound'));
      setLoading(false);
      return;
    }

    if (identifier !== username) {
      setUsername(identifier);
    }

    await submitCredentials(identifier);
  };

  // Authenticator codes auto-submit from the step (backup codes never do);
  // both legs resend the password with the code, as the backend expects.
  const handleSubmitCode = (code: string) => {
    setError('');
    void submitCredentials(username.trim(), code);
  };

  const handleUsePasskey = async () => {
    if (!challenge?.mfaToken) {
      setError(t('twoFactor.expired'));
      leaveTwoFactor();
      return;
    }
    setError('');
    setLoading(true);
    try {
      finishSignIn(await completeTwoFactorWithPasskey(challenge.mfaToken));
    } catch (err) {
      if (isTwoFactorExpired(err)) {
        // The five-minute window closed (or the token was spent): back to
        // the password, which mints a fresh one.
        leaveTwoFactor();
        setError(t('twoFactor.expired'));
      } else {
        setError(guestErrorMessage(err, t('errors.passkeyAuthFailed')));
      }
      setLoading(false);
    }
  };

  const handleShowBackup = () => {
    setError('');
    setTwoFactorView('backup');
    writeTwoFactorParam(BACKUP_VIEW, false);
  };

  const handleShowMethods = () => {
    setError('');
    setTwoFactorView('methods');
    if (twoFactorParam === BACKUP_VIEW) {
      writeTwoFactorParam(null, true);
    }
  };

  /** Back to the password form (Back, an expired token, or a lockout). */
  function leaveTwoFactor() {
    setChallenge(null);
    setTwoFactorView('methods');
    setError('');
    if (twoFactorParam) {
      writeTwoFactorParam(null, true);
    }
  }

  const handleGoogleCredential = async (credential: string) => {
    setError('');
    setLoading(true);

    try {
      // Sends the consent payload on every attempt, which is what makes this
      // the single Google door: the backend only reads it when the identity has
      // no account yet, so an existing guest is unaffected and a first-time one
      // is created here instead of being bounced to a second page. The notice
      // under the button is what the payload records, and it cannot be pressed
      // without that sentence on screen.
      await loginWithGoogle(credential, buildNoticeConsentPayload(REGISTRATION_NOTICE, legalLocale));

      // Route by the freshly-stored account, same as completeSignIn() does —
      // Google sign-in is guest-only, but a guest whose profile is still
      // missing required fields must finish that step first.
      const storedUser = storage.getItem<{ profile_complete?: boolean }>('user');
      if (storedUser?.profile_complete === false) {
        const redirectParam = safeGuestRedirect(searchParams.get('redirect'));
        navigate(
          redirectParam
            ? `/complete-profile?redirect=${encodeURIComponent(redirectParam)}`
            : '/complete-profile',
          { replace: true }
        );
        return;
      }

      completeSignIn();
    } catch (err) {
      // Shared with the One Tap prompt on the public guest pages — same
      // endpoint, same four failure shapes.
      setError(googleSignInErrorMessage(err, t));
      setLoading(false);
    }
  };

  if (showFirstLoginPrompt) {
    return (
      <FirstLoginPasskeyPrompt
        open={true}
        username={username}
        onClose={handleFirstLoginPromptClose}
      />
    );
  }

  const backControl = (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
      <Button
        startIcon={<ArrowBackIcon />}
        onClick={handleBack}
        sx={{ ml: -1, color: 'var(--hotel-text-secondary)' }}
      >
        {t('common.back')}
      </Button>
      {/* The language control lives in the card's header row rather than the
          page's top-right corner: on phones the card fills the viewport and a
          page-corner position left the button straddling the card's edge. */}
      <LanguageSwitcher color="default" size="small" />
    </Box>
  );

  if (challenge) {
    return (
      <Suspense
        fallback={
          <Box className="auth-page auth-page--2fa" sx={{ alignItems: 'center', justifyContent: 'center' }}>
            <CircularProgress aria-label={t('twoFactor.title')} />
          </Box>
        }
      >
        <TwoFactorChallenge
          methods={challenge.mfaToken ? challenge.methods : challenge.methods.filter((m) => m !== 'passkey')}
          view={twoFactorView}
          loading={loading}
          awaitingTurnstile={awaitingTurnstile}
          turnstileEnabled={turnstile.enabled}
          turnstileRef={turnstile.setContainer}
          error={error}
          errorRef={errorRef}
          onDismissError={() => setError('')}
          resetKey={codeResetKey}
          onSubmitCode={handleSubmitCode}
          onUsePasskey={() => void handleUsePasskey()}
          onShowBackup={handleShowBackup}
          onShowMethods={handleShowMethods}
          onCancel={leaveTwoFactor}
        />
      </Suspense>
    );
  }

  return (
    <Box className="auth-page auth-page--signin">
      <Container className="auth-container" maxWidth="sm" sx={{ position: 'relative', zIndex: 1 }}>
        <Fade in timeout={300}>
          <Paper
            className="auth-card"
            sx={{ p: { xs: 4, sm: 6 }, width: '100%', display: 'flex', flexDirection: 'column' }}
          >
            {backControl}

            {/* One heading for the page. The hotel name is already the card's
                eyebrow (.auth-card::before, fed by --auth-brand-eyebrow), and
                the step used to repeat both the title and the subtitle
                immediately beneath them. */}
            <Box className="auth-heading" sx={{ mb: { xs: 3, sm: 4 } }}>
              <Typography variant="h1" sx={{ fontSize: { xs: '2.75rem', sm: '3.5rem' } }}>
                {t('login.title')}
              </Typography>
              <Typography
                variant="body2"
                sx={{ mt: 1, color: 'var(--hotel-text-secondary)' }}
              >
                {t('login.subtitle')}
              </Typography>
            </Box>

            {/* A ProtectedRoute bounced the reader here carrying ?redirect= —
                say why they're signing in, and that they'll land back there. */}
            {interruptedDestination && (
              <Alert severity="info" role="alert" sx={{ mb: 2 }}>
                {t('login.sessionNotice')}
              </Alert>
            )}

            <Collapse in={!!error}>
              <Alert severity="error" role="alert" ref={errorRef} tabIndex={-1} sx={{ mb: 2 }} onClose={() => setError('')}>
                {error}
              </Alert>
            </Collapse>

            {/* Username and password together: one screen, one submit. The
                password box used to appear only after the account had been
                looked up, which cost a round trip before a user could even
                start typing the thing they came here to type. */}
            <form onSubmit={handleLogin}>
              <TextField
                fullWidth
                label={t('login.usernameLabel')}
                name="username"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                margin="normal"
                required
                autoFocus
                slotProps={{
                  // Usernames are lowercase identifiers — stop phone keyboards
                  // from capitalising or "correcting" them.
                  htmlInput: {
                    autoCapitalize: 'none',
                    autoCorrect: 'off',
                    spellCheck: false,
                  },
                }}
              />

              <TextField
                fullWidth
                label={t('login.passwordLabel')}
                type={showPassword ? 'text' : 'password'}
                name="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                margin="normal"
                required
                slotProps={{
                  input: {
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          aria-label={
                            showPassword ? t('login.hidePassword') : t('login.showPassword')
                          }
                          onClick={() => setShowPassword((prev) => !prev)}
                          onMouseDown={(e) => e.preventDefault()}
                          edge="end"
                          size="small"
                        >
                          {showPassword ? <VisibilityOffIcon /> : <VisibilityIcon />}
                        </IconButton>
                      </InputAdornment>
                    ),
                  },
                }}
              />

              <Button
                type="submit"
                fullWidth
                variant="contained"
                sx={{ mt: 2, mb: 1.5, py: 1.5 }}
                disabled={
                  loading || awaitingTurnstile || !username || username.length < 3 || !password
                }
              >
                {loading ? <CircularProgress size={20} color="inherit" /> : t('login.submit')}
              </Button>

              {turnstile.enabled && (
                <Box
                  ref={turnstile.setContainer}
                  sx={{ display: 'flex', justifyContent: 'center', mb: 1.5, minHeight: 65 }}
                />
              )}

              {/* The divider only earns its place when something follows it.
                  Without this the page drew a bare "or" rule over empty
                  space wherever Google sign-in is not configured. */}
              {isGoogleSignInAvailable() && (
                <>
                  <Divider sx={{ my: 2 }}>{t('login.or')}</Divider>
                  <GoogleSignInButton onCredential={handleGoogleCredential} />
                  {/* Continuing with Google creates the account when there is
                      none, so the notice governing that belongs here, against
                      the button, not on a page the guest never reaches. */}
                  <ConsentNotice notice={REGISTRATION_NOTICE} />
                </>
              )}
            </form>

            <Box sx={{ mt: 3, textAlign: 'center' }}>
              <Typography variant="body2" sx={{ color: 'var(--hotel-text-secondary)' }}>
                {t('login.noAccount')}{' '}
                <Button
                  variant="text"
                  sx={{
                    p: 0,
                    minWidth: 'auto',
                    fontSize: 'inherit',
                    textTransform: 'none',
                    fontWeight: 600,
                    color: 'var(--hotel-primary)',
                    '&:hover': { background: 'transparent', textDecoration: 'underline' },
                  }}
                  onClick={() => navigate('/register')}
                >
                  {t('login.signUp')}
                </Button>
              </Typography>
            </Box>
          </Paper>
        </Fade>
      </Container>
    </Box>
  );
};

export default LoginPage;

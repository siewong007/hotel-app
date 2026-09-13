import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from '../../../router';
import { returnFromAuthPage, safeGuestRedirect, safeStaffRedirect } from '../guestRedirect';
import {
  Box,
  ButtonBase,
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
  Divider,
} from '@mui/material';
import {
  ArrowBack as ArrowBackIcon,
  ChevronRight as ChevronRightIcon,
  PhonelinkLock as PhonelinkLockIcon,
  VpnKey as VpnKeyIcon,
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
} from '@mui/icons-material';
import { useAuth } from '../../../auth/AuthContext';
import { storage } from '../../../utils/storage';
import FirstLoginPasskeyPrompt from './FirstLoginPasskeyPrompt';
import { LoadingSpinner } from '../../../components';
import { GuestPortalDashboardService } from '../../guestPortal/api/guestPortalDashboard.service';
import { setPortalToken } from '../../guestPortal/api/portalTokenStore';
import { GoogleSignInButton, isGoogleSignInAvailable } from './GoogleSignInButton';
import { googleSignInErrorMessage } from '../google/googleSignInError';
import { ConsentNotice } from '../../legal/components/ConsentNotice';
import { REGISTRATION_NOTICE } from '../../legal/content';
import { buildNoticeConsentPayload } from '../../legal/noticeConsent';
import { useLegalLocale } from '../../legal/LegalLocaleContext';
import {
  isCompleteTwoFactorCode,
  notifyRecoveryCodeUsed,
  sanitizeTwoFactorCode,
  TOTP_CODE_LENGTH,
  type TwoFactorMethod,
} from '../utils/twoFactorCode';
import { AuthService } from '../../../api';
import { errorMessage } from '../../../utils/errorMessage';
import {
  isTwoFactorEnrollmentRequired,
  TWO_FACTOR_ENROLLMENT_PATH,
} from '../twoFactorEnrollment';
import { LanguageSwitcher } from '../../../components/common/LanguageSwitcher';
import { useTranslation } from '../../../i18n';
import { useTurnstile } from '../turnstile/useTurnstile';
import { turnstileErrorMessage } from '../turnstile/turnstileError';

/** The ways a second factor can be satisfied at sign-in. Both end up in the
 *  same request field — the backend tries TOTP first and falls back to the
 *  recovery codes — but a user holding one of them should not have to work out
 *  that a single box accepts both shapes. */
const TWO_FACTOR_METHODS: ReadonlyArray<{
  method: TwoFactorMethod;
  Icon: typeof PhonelinkLockIcon;
}> = [
  { method: 'totp', Icon: PhonelinkLockIcon },
  { method: 'recovery', Icon: VpnKeyIcon },
];

const LoginPage: React.FC = () => {
  const [searchParams] = useSearchParams();
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
  const [show2FAPrompt, setShow2FAPrompt] = useState(false);
  // null while the user is still choosing how to complete the second factor.
  const [twoFactorMethod, setTwoFactorMethod] = useState<TwoFactorMethod | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const { login, loginWithGoogle } = useAuth();
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
      const {
        isFirstLogin,
        recoveryCodesRemaining,
        twoFactorEnrollmentRequired,
        twoFactorEnrollmentDeadline,
      } = await login(identifier, password, code || undefined, turnstile.token);
      // The token was spent the moment that request went out. Re-solve now so a
      // 2FA leg, or a retry after a wrong password, never replays it --
      // Cloudflare rejects a replay as timeout-or-duplicate.
      turnstile.reset();
      if (recoveryCodesRemaining !== undefined) {
        notifyRecoveryCodeUsed(recoveryCodesRemaining);
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
        setShowFirstLoginPrompt(true);
        setLoading(false);
      } else {
        completeSignIn();
      }
    } catch (err) {
      // Spent on the way out regardless of the outcome.
      turnstile.reset();
      const loginError = errorMessage(err, t('login.failed'));

      // Enrolment is overdue, so the backend refused this sign-in outright.
      // Matched on the stable body code, never the message: that copy is
      // user-facing prose and is translated.
      if (isTwoFactorEnrollmentRequired(err)) {
        setError(t('twoFactorEnrollment.blocked'));
        setLoading(false);
        return;
      }

      // The password was right and this account carries a second factor. Ask
      // how the user wants to satisfy it rather than assuming an authenticator
      // app they may no longer have.
      if (loginError.includes('2FA required') || loginError.includes('TOTP code')) {
        setShow2FAPrompt(true);
        setTwoFactorMethod(null);
        setTotpCode('');
        setError('');
        setLoading(false);
        return;
      }

      setError(loginError);
      setLoading(false);
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
      setError(errorMessage(err, t('login.lookupFailed')));
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

  const handle2FASubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!twoFactorMethod) {
      return;
    }
    if (!isCompleteTwoFactorCode(totpCode, twoFactorMethod)) {
      setError(t(`twoFactor.${twoFactorMethod}Incomplete`));
      return;
    }
    await submitCredentials(username.trim(), totpCode);
  };

  const handleChooseTwoFactorMethod = (method: TwoFactorMethod) => {
    setTwoFactorMethod(method);
    setTotpCode('');
    setError('');
  };

  const handleCancelTwoFactor = () => {
    setShow2FAPrompt(false);
    setTwoFactorMethod(null);
    setTotpCode('');
    setError('');
  };

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
    <Button
      startIcon={<ArrowBackIcon />}
      onClick={handleBack}
      sx={{ mb: 2, ml: -1, alignSelf: 'flex-start', color: 'var(--hotel-text-secondary)' }}
    >
      {t('common.back')}
    </Button>
  );

  if (show2FAPrompt) {
    const isRecovery = twoFactorMethod === 'recovery';

    return (
      <Box className="auth-page auth-page--2fa">
        <Container className="auth-container" maxWidth="sm">
          <Fade in timeout={300}>
            <Paper className="auth-card" sx={{ p: { xs: 4, sm: 6 }, width: '100%' }}>
              <Box className="auth-heading" sx={{ mb: { xs: 2.5, sm: 4 } }}>
                <Typography variant="h1" sx={{ fontSize: { xs: '2rem', sm: '2.5rem' } }}>
                  {t('twoFactor.title')}
                </Typography>
                <Typography variant="body2" sx={{ mt: 1, color: 'var(--hotel-text-secondary)' }}>
                  {twoFactorMethod
                    ? t(`twoFactor.${twoFactorMethod}Subtitle`)
                    : t('twoFactor.chooseSubtitle')}
                </Typography>
              </Box>

              <Collapse in={!!error}>
                <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
                  {error}
                </Alert>
              </Collapse>

              {/* Step 1: pick the second factor. A user who lost their phone
                  needs the recovery path offered, not hidden behind a hint
                  under a box labelled for an authenticator code. */}
              {!twoFactorMethod && (
                <Box>
                  {TWO_FACTOR_METHODS.map(({ method, Icon }, index) => (
                    <React.Fragment key={method}>
                      {index > 0 && <Divider />}
                      <ButtonBase
                        onClick={() => handleChooseTwoFactorMethod(method)}
                        sx={{
                          width: '100%',
                          px: 1,
                          py: 2,
                          gap: 2,
                          justifyContent: 'flex-start',
                          textAlign: 'left',
                          borderRadius: 2,
                        }}
                      >
                        <Icon sx={{ fontSize: 24, color: 'var(--hotel-primary)' }} />
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography sx={{ fontSize: '1rem', fontWeight: 500 }}>
                            {t(`twoFactor.${method}Method`)}
                          </Typography>
                          <Typography
                            variant="caption"
                            sx={{ color: 'var(--hotel-text-secondary)' }}
                          >
                            {t(`twoFactor.${method}MethodDescription`)}
                          </Typography>
                        </Box>
                        <ChevronRightIcon
                          sx={{ fontSize: 20, color: 'var(--hotel-text-secondary)' }}
                        />
                      </ButtonBase>
                    </React.Fragment>
                  ))}

                  <Button
                    fullWidth
                    variant="text"
                    sx={{ mt: 3 }}
                    onClick={handleCancelTwoFactor}
                  >
                    {t('twoFactor.cancel')}
                  </Button>
                </Box>
              )}

              {/* Step 2: enter the code for the method that was picked. */}
              {twoFactorMethod && (
                <form onSubmit={handle2FASubmit}>
                  <TextField
                    fullWidth
                    label={t(`twoFactor.${twoFactorMethod}Label`)}
                    value={totpCode}
                    onChange={(e) =>
                      setTotpCode(sanitizeTwoFactorCode(e.target.value, twoFactorMethod))
                    }
                    placeholder={isRecovery ? 'XXXXX-XXXXX-XXXXX-XXXXX' : '000000'}
                    helperText={t(`twoFactor.${twoFactorMethod}Help`)}
                    sx={{ mb: 3 }}
                    autoFocus
                    slotProps={{
                      htmlInput: {
                        maxLength: isRecovery ? 23 : TOTP_CODE_LENGTH,
                        inputMode: isRecovery ? 'text' : 'numeric',
                        // Recovery codes are nearly four times as long as a TOTP
                        // code, so the wide-tracked display used for six digits
                        // overflows.
                        style: isRecovery
                          ? { textAlign: 'center', fontSize: '18px', letterSpacing: '2px' }
                          : { textAlign: 'center', fontSize: '24px', letterSpacing: '8px' },
                      },
                    }}
                  />

                  <Button
                    fullWidth
                    type="submit"
                    variant="contained"
                    size="large"
                    disabled={
                      loading ||
                      awaitingTurnstile ||
                      !isCompleteTwoFactorCode(totpCode, twoFactorMethod)
                    }
                    sx={{ mb: 1.5, py: 1.5 }}
                  >
                    {loading ? <LoadingSpinner size={24} /> : t('twoFactor.verify')}
                  </Button>

                  {turnstile.enabled && (
                    <Box
                      ref={turnstile.setContainer}
                      sx={{ display: 'flex', justifyContent: 'center', mb: 1.5, minHeight: 65 }}
                    />
                  )}

                  <Button
                    fullWidth
                    variant="text"
                    onClick={() => {
                      setTwoFactorMethod(null);
                      setTotpCode('');
                      setError('');
                    }}
                  >
                    {t('twoFactor.chooseAnother')}
                  </Button>

                  <Button fullWidth variant="text" onClick={handleCancelTwoFactor}>
                    {t('twoFactor.cancel')}
                  </Button>
                </form>
              )}
            </Paper>
          </Fade>
        </Container>
      </Box>
    );
  }

  return (
    <Box className="auth-page auth-page--signin">
      <Box sx={{ position: 'absolute', top: 16, right: 16, zIndex: 2 }}>
        <LanguageSwitcher color="default" size="small" />
      </Box>
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
              <Alert severity="info" sx={{ mb: 2 }}>
                {t('login.sessionNotice')}
              </Alert>
            )}

            <Collapse in={!!error}>
              <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
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
                margin="dense"
                required
                autoFocus
              />

              <TextField
                fullWidth
                label={t('login.passwordLabel')}
                type={showPassword ? 'text' : 'password'}
                name="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                margin="dense"
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
                {loading ? <LoadingSpinner size={24} color="inherit" /> : t('login.submit')}
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

import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from '../../../router';
import { returnFromAuthPage, safeGuestRedirect } from '../guestRedirect';
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
  Fingerprint as FingerprintIcon,
  Person as PersonIcon,
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
import {
  isCompleteTwoFactorCode,
  notifyRecoveryCodeUsed,
  sanitizeTwoFactorCode,
  TOTP_CODE_LENGTH,
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

const isAppleWebKitBrowser = () =>
  typeof navigator !== 'undefined' && navigator.vendor === 'Apple Computer, Inc.';

const LoginPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showFirstLoginPrompt, setShowFirstLoginPrompt] = useState(false);
  const [show2FAPrompt, setShow2FAPrompt] = useState(false);
  const [totpCode, setTotpCode] = useState('');
  const [passkeyAttempted, setPasskeyAttempted] = useState(false);
  const [showPasswordField, setShowPasswordField] = useState(false);
  const [passkeyCheckInProgress, setPasskeyCheckInProgress] = useState(false);
  const [usernameSubmitted, setUsernameSubmitted] = useState(false);
  const { login, loginWithPasskey, loginWithGoogle } = useAuth();
  const { t } = useTranslation('auth');
  const { getToken: getTurnstileToken } = useTurnstile();
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
    navigate(account === 'guest' ? guestDestination : '/admin-portal', { replace: true });
  };

  const handleBack = () => returnFromAuthPage(navigate, searchParams.get('redirect'));

  const handleFirstLoginPromptClose = () => {
    setShowFirstLoginPrompt(false);
    completeSignIn();
  };

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    // Minted per attempt, not per page load: Turnstile tokens are single-use,
    // so the 2FA leg (which re-enters this function) needs its own.
    let turnstileToken: string | undefined;
    try {
      turnstileToken = await getTurnstileToken();
    } catch (err) {
      setError(turnstileErrorMessage(err, t));
      setLoading(false);
      return;
    }

    try {
      const {
        isFirstLogin,
        recoveryCodesRemaining,
        twoFactorEnrollmentRequired,
        twoFactorEnrollmentDeadline,
      } = await login(
        username,
        password,
        totpCode || undefined,
        turnstileToken
      );
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
      const loginError = errorMessage(err, t('login.failed'));

      // Enrolment is overdue, so the backend refused this sign-in outright.
      // Matched on the stable body code, never the message: that copy is
      // user-facing prose and is translated.
      if (isTwoFactorEnrollmentRequired(err)) {
        setError(t('twoFactorEnrollment.blocked'));
        setLoading(false);
        return;
      }

      // Check if 2FA is required
      if (loginError.includes('2FA required') || loginError.includes('TOTP code')) {
        setShow2FAPrompt(true);
        setError('');
        setLoading(false);
        return;
      }

      setError(loginError);
      setLoading(false);
    }
  };

  const handle2FASubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isCompleteTwoFactorCode(totpCode)) {
      setError(t('twoFactor.incomplete'));
      return;
    }
    await handlePasswordLogin(e);
  };

  const handlePasskeyLogin = async () => {
    if (!username) {
      setError(t('login.usernameRequired'));
      return;
    }

    setError('');
    setLoading(true);

    try {
      const isFirstLogin = await loginWithPasskey(username);
      if (isFirstLogin) {
        setShowFirstLoginPrompt(true);
        setLoading(false);
      } else {
        completeSignIn();
      }
    } catch (err) {
      setError(errorMessage(err, t('login.passkeyFailed')));
      setLoading(false);
    }
  };

  const handleGoogleCredential = async (credential: string) => {
    setError('');
    setLoading(true);

    try {
      await loginWithGoogle(credential);

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
      const message = errorMessage(err, t('login.googleFailed'));
      // The backend reports a missing/misconfigured client id or a Google API
      // outage as a 503 (see hotel-app-be/src/services/google_identity.rs) —
      // branch on the status AuthContext's loginWithGoogle preserves, not the
      // message text, which can be reworded without breaking this check.
      const googleStatus = (err as { statusCode?: number }).statusCode;
      // First-time Google guests must accept Booking Terms + Privacy Notice on
      // /register. Existing Google sessions do not send consents and still work.
      setError(
        googleStatus === 503
          ? t('login.googleUnavailable')
          // 409 is ensure_active_google_guest rejecting a staff or deactivated
          // account. The raw backend sentence does not say what to do instead.
          : googleStatus === 409
            ? t('login.googleStaffOnly')
            : googleStatus === 400 && /consent/i.test(message)
              ? t('login.googleNeedsAccount')
              : message
      );
      setLoading(false);
    }
  };

  // Handle username submission (Gmail-style): require an active account before password.
  const handleUsernameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const identifier = username.trim();
    if (!identifier || identifier.length < 3) {
      setError(t('login.usernameInvalid'));
      return;
    }

    setLoading(true);
    setError('');

    try {
      const { exists } = await AuthService.lookupLoginIdentifier(identifier);
      if (!exists) {
        setError(t('login.accountNotFound'));
        setUsernameSubmitted(false);
        setShowPasswordField(false);
        return;
      }

      if (identifier !== username) {
        setUsername(identifier);
      }

      setUsernameSubmitted(true);

      // Safari can leave an automatic WebAuthn request pending without showing
      // a usable prompt, trapping password users on "Checking for passkey".
      // Keep the explicit passkey button available, but make Continue reliably
      // open the password step in Apple WebKit browsers. passkeyAttempted stays
      // false here — no WebAuthn call was made, so the password step must still
      // offer the passkey as a choice rather than claiming it is unavailable.
      if (isAppleWebKitBrowser()) {
        setShowPasswordField(true);
        return;
      }

      // Attempt passkey authentication first
      await attemptPasskeyAuth();
    } catch (err) {
      setError(errorMessage(err, t('login.lookupFailed')));
      setUsernameSubmitted(false);
      setShowPasswordField(false);
    } finally {
      setLoading(false);
    }
  };

  const attemptPasskeyAuth = async () => {
    if (!username || passkeyCheckInProgress) {
      return;
    }

    setPasskeyCheckInProgress(true);
    setPasskeyAttempted(false);
    setError('');

    try {
      // Check if WebAuthn is supported
      if (!window.PublicKeyCredential) {
        setShowPasswordField(true);
        setPasskeyAttempted(true);
        setPasskeyCheckInProgress(false);
        return;
      }

      // Attempt passkey login
      const isFirstLogin = await loginWithPasskey(username);
      setPasskeyAttempted(true);

      if (isFirstLogin) {
        setShowFirstLoginPrompt(true);
      } else {
        completeSignIn();
      }
    } catch (err) {
      // Passkey failed or not available - show password field
      setPasskeyAttempted(true);
      setShowPasswordField(true);

      // Don't show error for normal "no passkey" scenarios
      const isNormalFailure =
        err.message?.toLowerCase().includes('no credentials') ||
        err.message?.toLowerCase().includes('not found') ||
        err.message?.toLowerCase().includes('not allowed') ||
        err.message?.toLowerCase().includes('cancelled');

      if (!isNormalFailure) {
        console.error('Unexpected passkey error:', err);
      }
    } finally {
      setPasskeyCheckInProgress(false);
    }
  };

  // Handle going back to edit username
  const handleEditUsername = () => {
    setUsernameSubmitted(false);
    setShowPasswordField(false);
    setShowPassword(false);
    setPasskeyAttempted(false);
    setPassword('');
    setError('');
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
                  {t('twoFactor.subtitle')}
                </Typography>
              </Box>

              <form onSubmit={handle2FASubmit}>
                <TextField
                  fullWidth
                  label={t('twoFactor.codeLabel')}
                  value={totpCode}
                  onChange={(e) => setTotpCode(sanitizeTwoFactorCode(e.target.value))}
                  placeholder="000000"
                  helperText={t('twoFactor.codeHelp')}
                  sx={{ mb: 3 }}
                  autoFocus
                  slotProps={{
                    htmlInput: {
                      maxLength: 25,
                      // Recovery codes are nearly four times as long as a TOTP code,
                      // so the wide-tracked display used for six digits overflows.
                      style:
                        totpCode.length > TOTP_CODE_LENGTH
                          ? { textAlign: 'center', fontSize: '18px', letterSpacing: '2px' }
                          : { textAlign: 'center', fontSize: '24px', letterSpacing: '8px' },
                    }
                  }}
                />

                <Collapse in={!!error}>
                  <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
                    {error}
                  </Alert>
                </Collapse>

                <Button
                  fullWidth
                  type="submit"
                  variant="contained"
                  size="large"
                  disabled={loading || !isCompleteTwoFactorCode(totpCode)}
                  sx={{ mb: 1.5, py: 1.5 }}
                >
                  {loading ? <LoadingSpinner size={24} /> : t('twoFactor.verify')}
                </Button>

                <Button
                  fullWidth
                  variant="text"
                  onClick={() => {
                    setShow2FAPrompt(false);
                    setTotpCode('');
                    setError('');
                  }}
                >
                  {t('twoFactor.cancel')}
                </Button>
              </form>
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

            <Collapse in={!!error}>
              <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
                {error}
              </Alert>
            </Collapse>

            {/* Step 1: identify the account */}
            {!usernameSubmitted && !passkeyCheckInProgress && (
              <form onSubmit={handleUsernameSubmit}>
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

                <Button
                  type="submit"
                  fullWidth
                  variant="contained"
                  sx={{ mt: 2, mb: 1.5, py: 1.5 }}
                  disabled={!username || username.length < 3}
                >
                  {t('login.next')}
                </Button>
                <Button
                  type="button"
                  fullWidth
                  variant="outlined"
                  startIcon={<FingerprintIcon />}
                  onClick={handlePasskeyLogin}
                  disabled={!username || username.length < 3 || loading}
                >
                  {t('login.passkeyButton')}
                </Button>

                {/* The divider only earns its place when something follows it.
                    Without this the page drew a bare "or" rule over empty
                    space wherever Google sign-in is not configured. */}
                {isGoogleSignInAvailable() && (
                  <>
                    <Divider sx={{ my: 2 }}>{t('login.or')}</Divider>
                    <GoogleSignInButton onCredential={handleGoogleCredential} />
                  </>
                )}
              </form>
            )}

            {/* Step 2: passkey check, then password */}
            {(usernameSubmitted || passkeyCheckInProgress) && (
              <Box>
                {/* Account chip — the whole row is the "use a different
                    account" control, so it costs one line instead of a
                    two-line panel plus a separate button. */}
                <ButtonBase
                  onClick={handleEditUsername}
                  disabled={passkeyCheckInProgress}
                  aria-label={t('login.changeAccountAria', { username })}
                  sx={{
                    width: '100%',
                    mb: 2,
                    px: 1.5,
                    py: 1,
                    gap: 1,
                    borderRadius: 2,
                    justifyContent: 'flex-start',
                    textAlign: 'left',
                    background: 'var(--hotel-muted-bg)',
                    border: '1px solid var(--hotel-divider)',
                  }}
                >
                  <PersonIcon sx={{ fontSize: 20, color: 'var(--hotel-text-secondary)' }} />
                  <Typography
                    noWrap
                    sx={{ flex: 1, minWidth: 0, fontSize: '0.95rem' }}
                  >
                    {username}
                  </Typography>
                  {!passkeyCheckInProgress && (
                    <Typography
                      component="span"
                      sx={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--hotel-primary)' }}
                    >
                      {t('login.changeAccount')}
                    </Typography>
                  )}
                </ButtonBase>

                {passkeyCheckInProgress && (
                  <Box sx={{ textAlign: 'center', py: 4 }}>
                    <LoadingSpinner size={40} />
                    <Typography
                      variant="body2"
                      sx={{ mt: 2, color: 'var(--hotel-text-secondary)' }}
                    >
                      {t('login.checkingPasskey')}
                    </Typography>
                    <Typography
                      variant="caption"
                      sx={{ color: 'var(--hotel-text-secondary)' }}
                    >
                      {t('login.passkeyPrompt')}
                    </Typography>
                  </Box>
                )}

                {/* Password form (shown after passkey attempt) */}
                {!passkeyCheckInProgress && showPasswordField && (
                  <form onSubmit={handlePasswordLogin}>
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
                      autoFocus
                      slotProps={{
                        input: {
                          endAdornment: (
                            <InputAdornment position="end">
                              <IconButton
                                aria-label={
                                  showPassword
                                    ? t('login.hidePassword')
                                    : t('login.showPassword')
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
                      disabled={loading}
                    >
                      {loading ? <LoadingSpinner size={24} color="inherit" /> : t('login.submit')}
                    </Button>

                    {/* Apple WebKit skips the automatic passkey attempt, so
                        passkey users land here with their credential unused.
                        Offer it as an action instead of declaring it absent. */}
                    <Box sx={{ textAlign: 'center' }}>
                      {passkeyAttempted ? (
                        <Typography
                          variant="caption"
                          sx={{ color: 'var(--hotel-text-secondary)' }}
                        >
                          {t('login.passkeyUnavailable')}
                        </Typography>
                      ) : (
                        <Button
                          type="button"
                          variant="text"
                          startIcon={<FingerprintIcon />}
                          onClick={handlePasskeyLogin}
                          disabled={loading}
                        >
                          {t('login.usePasskeyInstead')}
                        </Button>
                      )}
                    </Box>
                  </form>
                )}
              </Box>
            )}

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

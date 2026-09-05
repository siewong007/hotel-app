import React, { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from '../../../router';
import { safeGuestRedirect } from '../guestRedirect';
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
  Slide,
  IconButton,
  Collapse,
  Card,
  CardContent,
  Divider,
} from '@mui/material';
import {
  Lock as LockIcon,
  Fingerprint as FingerprintIcon,
  ArrowBack as ArrowBackIcon,
  VpnKey as VpnKeyIcon,
  Person as PersonIcon,
  AdminPanelSettings as AdminIcon,
} from '@mui/icons-material';
import { useAuth } from '../../../auth/AuthContext';
import { storage } from '../../../utils/storage';
import { getHotelSettings } from '../../../utils/hotelSettings';
import FirstLoginPasskeyPrompt from './FirstLoginPasskeyPrompt';
import { LoadingSpinner } from '../../../components';
import { GuestPortalDashboardService } from '../../guestPortal/api/guestPortalDashboard.service';
import { setPortalToken } from '../../guestPortal/api/portalTokenStore';
import { GoogleSignInButton } from './GoogleSignInButton';
import {
  isCompleteTwoFactorCode,
  notifyRecoveryCodeUsed,
  sanitizeTwoFactorCode,
  TOTP_CODE_LENGTH,
} from '../utils/twoFactorCode';
import { errorMessage } from '../../../utils/errorMessage';

type UserType = 'guest' | 'admin' | null;

const isAppleWebKitBrowser = () =>
  typeof navigator !== 'undefined' && navigator.vendor === 'Apple Computer, Inc.';

const LoginPage: React.FC = () => {
  const hotelSettings = getHotelSettings();
  const [searchParams] = useSearchParams();
  const [userType, setUserType] = useState<UserType>(() => {
    const account = searchParams.get('account');
    return account === 'guest' || account === 'admin' ? account : null;
  });
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showFirstLoginPrompt, setShowFirstLoginPrompt] = useState(false);
  const [show2FAPrompt, setShow2FAPrompt] = useState(false);
  const [totpCode, setTotpCode] = useState('');
  const [passkeyAttempted, setPasskeyAttempted] = useState(false);
  const [showPasswordField, setShowPasswordField] = useState(false);
  const [passkeyCheckInProgress, setPasskeyCheckInProgress] = useState(false);
  const [usernameSubmitted, setUsernameSubmitted] = useState(false);
  const { login, loginWithPasskey, registerPasskey, loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    const account = searchParams.get('account');
    setUserType(account === 'guest' || account === 'admin' ? account : null);
  }, [searchParams]);

  const completeSignIn = () => {
    // Route by the authenticated account's actual type, not the login tab the
    // user picked — a guest signing in from the admin tab must still get the
    // guest experience, and vice versa.
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

  const handleFirstLoginPromptClose = () => {
    setShowFirstLoginPrompt(false);
    completeSignIn();
  };

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const { isFirstLogin, recoveryCodesRemaining } = await login(
        username,
        password,
        totpCode || undefined
      );
      if (recoveryCodesRemaining !== undefined) {
        notifyRecoveryCodeUsed(recoveryCodesRemaining);
      }
      if (isFirstLogin) {
        setShowFirstLoginPrompt(true);
        setLoading(false);
      } else {
        completeSignIn();
      }
    } catch (err) {
      const loginError = errorMessage(err, 'Login failed');

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
      setError('Enter the 6-digit code from your authenticator app, or a full recovery code');
      return;
    }
    await handlePasswordLogin(e);
  };

  const handlePasskeyLogin = async () => {
    if (!username) {
      setError('Please enter your username');
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
      setError(errorMessage(err, 'Passkey login failed'));
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
      const message = errorMessage(err, 'Google sign-in failed');
      // The backend reports a missing/misconfigured client id or a Google API
      // outage as a 503 (see hotel-app-be/src/services/google_identity.rs) —
      // branch on the status AuthContext's loginWithGoogle preserves, not the
      // message text, which can be reworded without breaking this check.
      const googleStatus = (err as { statusCode?: number }).statusCode;
      setError(
        googleStatus === 503
          ? 'Google sign-in is unavailable right now. Please sign in with your username instead.'
          : message
      );
      setLoading(false);
    }
  };

  const handlePasskeyRegister = async () => {
    if (!username) {
      setError('Please enter your username');
      return;
    }

    setError('');
    setLoading(true);

    try {
      await registerPasskey(username);
      setError('');
      alert('Passkey registered successfully! You can now use it to log in.');
    } catch (err) {
      setError(errorMessage(err, 'Passkey registration failed'));
    } finally {
      setLoading(false);
    }
  };

  const handleBackToUserType = () => {
    navigate('/login', { replace: true });
    setError('');
    setUsername('');
    setPassword('');
    setPasskeyAttempted(false);
    setShowPasswordField(false);
    setPasskeyCheckInProgress(false);
    setUsernameSubmitted(false);
  };

  // Handle username submission (Gmail-style)
  const handleUsernameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!username || username.length < 3) {
      setError('Please enter a valid username');
      return;
    }

    setUsernameSubmitted(true);
    setError('');

    // Safari can leave an automatic WebAuthn request pending without showing
    // a usable prompt, trapping password users on "Checking for passkey".
    // Keep the explicit passkey button available, but make Next reliably open
    // the password step in Apple WebKit browsers. passkeyAttempted stays false
    // here — no WebAuthn call was made, so the password step must still offer
    // the passkey as a choice rather than claiming it is unavailable.
    if (isAppleWebKitBrowser()) {
      setShowPasswordField(true);
      return;
    }

    // Attempt passkey authentication first
    await attemptPasskeyAuth();
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

  if (show2FAPrompt) {
    return (
      <Box
        className="auth-page auth-page--2fa"
        sx={{
          minHeight: '100vh',
          '@supports (min-height: 100dvh)': { minHeight: '100dvh' },
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--hotel-page-bg)',
        }}
      >
        <Container maxWidth="sm">
          <Fade in timeout={800}>
            <Paper elevation={24} sx={{ p: { xs: 3, sm: 5 }, borderRadius: 3 }}>
              <Box sx={{ textAlign: 'center', mb: { xs: 2.5, sm: 4 } }}>
                <VpnKeyIcon
                  sx={{ fontSize: { xs: 40, sm: 60 }, color: 'var(--hotel-primary)', mb: { xs: 1, sm: 2 } }}
                />
                <Typography
                  variant="h4"
                  gutterBottom
                  sx={{
                    fontWeight: "bold",
                    fontSize: { xs: '1.5rem', sm: '2.125rem' }
                  }}>
                  Two-Factor Authentication
                </Typography>
                <Typography variant="body2" sx={{
                  color: "text.secondary"
                }}>
                  Enter the 6-digit code from your authenticator app, or one of your recovery codes
                  if you no longer have it
                </Typography>
              </Box>

              <form onSubmit={handle2FASubmit}>
                <TextField
                  fullWidth
                  label="Authentication or recovery code"
                  value={totpCode}
                  onChange={(e) => setTotpCode(sanitizeTwoFactorCode(e.target.value))}
                  placeholder="000000"
                  helperText="6-digit authenticator code, or a recovery code (XXXXX-XXXXX-XXXXX-XXXXX). Each recovery code works once."
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

                {error && (
                  <Alert severity="error" sx={{ mb: 2 }}>
                    {error}
                  </Alert>
                )}

                <Button
                  fullWidth
                  type="submit"
                  variant="contained"
                  size="large"
                  disabled={loading || !isCompleteTwoFactorCode(totpCode)}
                  sx={{
                    mb: 2,
                    background: 'var(--hotel-action-gradient)',
                    '&:hover': {
                      background: 'var(--hotel-action-gradient-hover)',
                    },
                  }}
                >
                  {loading ? <LoadingSpinner size={24} /> : 'Verify'}
                </Button>

                <Button
                  fullWidth
                  variant="outlined"
                  onClick={() => {
                    setShow2FAPrompt(false);
                    setTotpCode('');
                    setError('');
                  }}
                  sx={{
                    borderColor: 'var(--hotel-primary)',
                    color: 'var(--hotel-primary)',
                    '&:hover': {
                      borderColor: 'var(--hotel-primary-dark)',
                      backgroundColor: 'var(--hotel-muted-bg)',
                    },
                  }}
                >
                  Cancel
                </Button>
              </form>
            </Paper>
          </Fade>
        </Container>
      </Box>
    );
  }

  return (
    <Box
      className="auth-page auth-page--signin"
      sx={{
        minHeight: '100vh',
        // Mobile browsers count the collapsing URL bar in 100vh, which pushes the
        // sign-in button under the toolbar. dvh tracks the visible viewport.
        '@supports (min-height: 100dvh)': { minHeight: '100dvh' },
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--hotel-page-bg)',
        position: 'relative',
        overflow: 'hidden',
        '&::before': {
          content: '""',
          position: 'absolute',
          top: '-50%',
          left: '-50%',
          width: '200%',
          height: '200%',
          background: 'var(--hotel-soft-glow)',
          animation: 'rotate 20s linear infinite',
        },
        '@keyframes rotate': {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
      }}
    >
      <Container className="auth-container" maxWidth="sm" sx={{ position: 'relative', zIndex: 1 }}>
        <Fade in timeout={800}>
          <Paper
            className="auth-card"
            elevation={12}
            sx={{
              p: { xs: 4, sm: 6 },
              width: '100%',
              borderRadius: 4,
              background: 'var(--hotel-panel-bg)',
              backdropFilter: 'blur(20px)',
              border: '1px solid var(--hotel-divider)',
              overflow: 'hidden',
              boxShadow: '0 20px 60px var(--hotel-shadow-color)',
            }}
          >
            {/* Header - Modern Bold Typography */}
            <Box className="auth-heading" sx={{ textAlign: 'left', mb: { xs: 2.5, sm: 5 } }}>
              <Typography
                variant="h1"
                sx={{
                  fontSize: { xs: '2.75rem', sm: '4rem', md: '5rem' },
                  fontWeight: 900,
                  letterSpacing: '-0.02em',
                  lineHeight: 0.9,
                  mb: { xs: 0.75, sm: 1 },
                  textTransform: 'uppercase',
                  background: 'var(--hotel-action-gradient)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}
              >
                Welcome
              </Typography>
              {/* The hotel name is already the card's eyebrow (.auth-card::before,
                  fed by --auth-brand-eyebrow from the same settings), so it is
                  deliberately not repeated here. */}
              <Box sx={{
                width: '60px',
                height: '4px',
                background: 'var(--hotel-action-gradient)',
                mb: { xs: 1.25, sm: 2 },
              }} />
              <Typography
                variant="body2"
                sx={{
                  color: 'var(--hotel-text-secondary)',
                  fontSize: '0.875rem',
                  letterSpacing: '0.02em',
                }}
              >
                {!userType && `Choose how you use ${hotelSettings.hotel_name}`}
                {userType && `Continue to your ${userType === 'guest' ? 'guest stay' : 'staff workspace'}`}
              </Typography>
            </Box>

            {/* Error Alert */}
            <Collapse in={!!error}>
              <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
                {error}
              </Alert>
            </Collapse>

            {/* Step 1: User Type Selection */}
            {!userType && (
              <Fade in timeout={600}>
                <Box>
                  <Card
                    className="auth-choice-card"
                    onClick={() => navigate('/login?account=guest')}
                    sx={{
                      mb: 3,
                      cursor: 'pointer',
                      transition: 'all 0.3s',
                      border: '2px solid transparent',
                      '&:hover': {
                        transform: 'translateY(-4px)',
                        boxShadow: '0 12px 32px var(--hotel-shadow-color)',
                        border: '2px solid var(--hotel-primary)',
                      },
                    }}
                  >
                    <CardContent sx={{ p: 3 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Box
                          sx={{
                            p: 2,
                            borderRadius: 2,
                            background: 'var(--hotel-action-gradient)',
                          }}
                        >
                          <PersonIcon sx={{ fontSize: 40, color: 'white' }} />
                        </Box>
                        <Box sx={{ flex: 1 }}>
                          <Typography
                            variant="h5"
                            gutterBottom
                            sx={{
                              fontWeight: 700,
                              color: "var(--hotel-accent-text)"
                            }}>
                            Guest stay
                          </Typography>
                          <Typography variant="body2" sx={{
                            color: "text.secondary"
                          }}>
                            View bookings, plan your stay, and access member rewards
                          </Typography>
                        </Box>
                      </Box>
                    </CardContent>
                  </Card>

                  <Card
                    className="auth-choice-card"
                    onClick={() => navigate('/login?account=admin')}
                    sx={{
                      cursor: 'pointer',
                      transition: 'all 0.3s',
                      border: '2px solid transparent',
                      '&:hover': {
                        transform: 'translateY(-4px)',
                        boxShadow: '0 12px 32px var(--hotel-shadow-color)',
                        border: '2px solid var(--hotel-secondary)',
                      },
                    }}
                  >
                    <CardContent sx={{ p: 3 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Box
                          sx={{
                            p: 2,
                            borderRadius: 2,
                            background: 'linear-gradient(135deg, var(--hotel-secondary) 0%, var(--hotel-primary-light) 100%)',
                          }}
                        >
                          <AdminIcon sx={{ fontSize: 40, color: 'white' }} />
                        </Box>
                        <Box sx={{ flex: 1 }}>
                          <Typography
                            variant="h5"
                            gutterBottom
                            sx={{
                              fontWeight: 700,
                              color: "var(--hotel-accent-text)"
                            }}>
                            Hotel staff
                          </Typography>
                          <Typography variant="body2" sx={{
                            color: "text.secondary"
                          }}>
                            Access operations, guest services, and performance insights
                          </Typography>
                        </Box>
                      </Box>
                    </CardContent>
                  </Card>

                  <Box sx={{ mt: 3, textAlign: 'center' }}>
                    <Typography variant="body2" sx={{
                      color: "text.secondary"
                    }}>
                      Don't have an account?{' '}
                      <Button
                        variant="text"
                        sx={{
                          p: 0,
                          minWidth: 'auto',
                          fontSize: 'inherit',
                          textTransform: 'none',
                          fontWeight: 600,
                          color: 'var(--hotel-primary)',
                          '&:hover': {
                            background: 'transparent',
                            textDecoration: 'underline',
                          },
                        }}
                        onClick={() => navigate('/register')}
                      >
                        Sign up
                      </Button>
                    </Typography>
                  </Box>
                </Box>
              </Fade>
            )}

            {/* Shared account login form */}
            {userType && (
              <Slide direction="left" in timeout={400}>
                <Box>
                  {/* Identity row — back control, step icon and step label on a
                      single line so the form stays above the fold on phones. */}
                  <Box sx={{ mb: { xs: 2, sm: 3 }, display: 'flex', alignItems: 'center', gap: 1 }}>
                    <IconButton
                      onClick={handleBackToUserType}
                      aria-label="Back to account type"
                      sx={{
                        ml: -1,
                        color: 'var(--hotel-primary)',
                        transition: 'transform 0.3s',
                        '&:hover': {
                          transform: 'translateX(-4px)',
                          backgroundColor: 'var(--hotel-muted-bg)',
                        },
                      }}
                    >
                      <ArrowBackIcon />
                    </IconButton>
                    <Box
                      sx={{
                        display: { xs: 'none', sm: 'inline-flex' },
                        p: 1,
                        borderRadius: '50%',
                        background: 'var(--hotel-action-gradient)',
                        animation: passkeyCheckInProgress ? 'pulse 1.5s ease-in-out infinite' : 'none',
                        '@keyframes pulse': {
                          '0%, 100%': { transform: 'scale(1)', opacity: 1 },
                          '50%': { transform: 'scale(1.05)', opacity: 0.8 },
                        },
                      }}
                    >
                      {passkeyCheckInProgress ? (
                        <FingerprintIcon sx={{ fontSize: 22, color: 'white' }} />
                      ) : usernameSubmitted ? (
                        <PersonIcon sx={{ fontSize: 22, color: 'white' }} />
                      ) : (
                        <LockIcon sx={{ fontSize: 22, color: 'white' }} />
                      )}
                    </Box>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography
                        variant="h6"
                        sx={{
                          fontWeight: 700,
                          color: "var(--hotel-accent-text)",
                          lineHeight: 1.2,
                          fontSize: { xs: '1.05rem', sm: '1.25rem' }
                        }}>
                        {passkeyCheckInProgress ? 'Authenticating…' : 'Sign in'}
                      </Typography>
                      <Typography
                        variant="body2"
                        sx={{
                          color: "text.secondary",
                          fontSize: '0.8rem'
                        }}>
                        {passkeyCheckInProgress
                          ? 'Checking for a passkey'
                          : userType === 'guest'
                            ? 'Guest account'
                            : 'Staff account'}
                      </Typography>
                    </Box>
                  </Box>

                  {/* Step 1: Username Entry */}
                  {!usernameSubmitted && !passkeyCheckInProgress && (
                    <form onSubmit={handleUsernameSubmit}>
                      <TextField
                        fullWidth
                        label="Username or Email"
                        name="username"
                        autoComplete="username"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        margin="dense"
                        required
                        autoFocus
                        sx={{
                          '& .MuiOutlinedInput-root': {
                            transition: 'all 0.3s',
                            '&:hover': {
                              transform: 'translateY(-2px)',
                            },
                            '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                              borderColor: 'var(--hotel-primary)',
                              borderWidth: '2px',
                            },
                          },
                          '& .MuiInputLabel-root.Mui-focused': {
                            color: 'var(--hotel-primary)',
                          },
                        }}
                      />

                      <Button
                        type="submit"
                        fullWidth
                        variant="contained"
                        sx={{
                          mt: 2,
                          mb: 1.5,
                          py: 1.5,
                          background: 'var(--hotel-action-gradient)',
                          fontWeight: 600,
                          fontSize: '1rem',
                          transition: 'all 0.3s',
                          '&:hover': {
                            background: 'var(--hotel-action-gradient-hover)',
                            transform: 'translateY(-2px)',
                            boxShadow: '0 8px 24px var(--hotel-shadow-color)',
                          },
                          '&:active': {
                            transform: 'translateY(0)',
                          },
                        }}
                        disabled={!username || username.length < 3}
                      >
                        Next
                      </Button>
                      <Button
                        type="button"
                        fullWidth
                        variant="outlined"
                        startIcon={<FingerprintIcon />}
                        onClick={handlePasskeyLogin}
                        disabled={!username || username.length < 3 || loading}
                        sx={{
                          borderColor: 'var(--hotel-primary)',
                          color: 'var(--hotel-primary)',
                          '&:hover': {
                            borderColor: 'var(--hotel-primary-dark)',
                            backgroundColor: 'var(--hotel-muted-bg)',
                          },
                        }}
                      >
                        Sign in with passkey
                      </Button>

                      {userType === 'guest' && (
                        <>
                          <Divider sx={{ my: 2 }}>or</Divider>
                          <GoogleSignInButton onCredential={handleGoogleCredential} />
                        </>
                      )}
                    </form>
                  )}

                  {/* Step 2: Passkey Check or Password Entry */}
                  {(usernameSubmitted || passkeyCheckInProgress) && (
                    <Box>
                      {/* Account chip — the whole row is the "use a different
                          account" control, so it costs one line instead of a
                          two-line panel plus a separate button. */}
                      <ButtonBase
                        onClick={handleEditUsername}
                        disabled={passkeyCheckInProgress}
                        aria-label={`Signed in as ${username}. Change account`}
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
                          '&:hover': { borderColor: 'var(--hotel-primary)' },
                        }}
                      >
                        <PersonIcon sx={{ fontSize: 20, color: 'var(--hotel-primary)' }} />
                        <Typography
                          noWrap
                          sx={{
                            flex: 1,
                            minWidth: 0,
                            fontWeight: 600,
                            fontSize: '0.95rem',
                            color: 'var(--hotel-accent-text)',
                          }}
                        >
                          {username}
                        </Typography>
                        {!passkeyCheckInProgress && (
                          <Typography
                            component="span"
                            sx={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--hotel-primary)' }}
                          >
                            Change
                          </Typography>
                        )}
                      </ButtonBase>

                      {/* Loading state during passkey check */}
                      {passkeyCheckInProgress && (
                        <Box sx={{ textAlign: 'center', py: 4 }}>
                          <LoadingSpinner size={40} />
                          <Typography
                            variant="body2"
                            sx={{
                              color: "text.secondary",
                              mt: 2
                            }}>
                            Checking for passkey...
                          </Typography>
                          <Typography variant="caption" sx={{
                            color: "text.secondary"
                          }}>
                            Please respond to your browser's authentication prompt
                          </Typography>
                        </Box>
                      )}

                      {/* Password form (shown after passkey attempt) */}
                      {!passkeyCheckInProgress && showPasswordField && (
                        <Fade in>
                          <form onSubmit={handlePasswordLogin}>
                            <TextField
                              fullWidth
                              label="Password"
                              type="password"
                              name="password"
                              autoComplete="current-password"
                              value={password}
                              onChange={(e) => setPassword(e.target.value)}
                              margin="dense"
                              required
                              autoFocus
                              sx={{
                                '& .MuiOutlinedInput-root': {
                                  transition: 'all 0.3s',
                                  '&:hover': {
                                    transform: 'translateY(-2px)',
                                  },
                                  '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                                    borderColor: 'var(--hotel-primary)',
                                    borderWidth: '2px',
                                  },
                                },
                                '& .MuiInputLabel-root.Mui-focused': {
                                  color: 'var(--hotel-primary)',
                                },
                              }}
                            />

                            <Button
                              type="submit"
                              fullWidth
                              variant="contained"
                              sx={{
                                mt: 2,
                                mb: 1.5,
                                py: 1.5,
                                background: 'var(--hotel-action-gradient)',
                                fontWeight: 600,
                                fontSize: '1rem',
                                transition: 'all 0.3s',
                                '&:hover': {
                                  background: 'var(--hotel-action-gradient-hover)',
                                  transform: 'translateY(-2px)',
                                  boxShadow: '0 8px 24px var(--hotel-shadow-color)',
                                },
                                '&:active': {
                                  transform: 'translateY(0)',
                                },
                              }}
                              disabled={loading}
                            >
                              {loading ? <LoadingSpinner size={24} color="inherit" /> : 'Sign In'}
                            </Button>

                            {/* Apple WebKit skips the automatic passkey attempt, so
                                passkey users land here with their credential unused.
                                Offer it as an action instead of declaring it absent. */}
                            <Box sx={{ textAlign: 'center' }}>
                              {passkeyAttempted ? (
                                <Typography variant="caption" sx={{
                                  color: "text.secondary"
                                }}>
                                  Passkey not available. Using password instead.
                                </Typography>
                              ) : (
                                <Button
                                  type="button"
                                  variant="text"
                                  startIcon={<FingerprintIcon />}
                                  onClick={handlePasskeyLogin}
                                  disabled={loading}
                                  sx={{
                                    fontSize: '0.85rem',
                                    fontWeight: 600,
                                    color: 'var(--hotel-primary)',
                                    '&:hover': { backgroundColor: 'var(--hotel-muted-bg)' },
                                  }}
                                >
                                  Use a passkey instead
                                </Button>
                              )}
                            </Box>
                          </form>
                        </Fade>
                      )}
                    </Box>
                  )}
                </Box>
              </Slide>
            )}

          </Paper>
        </Fade>
      </Container>
    </Box>
  );
};

export default LoginPage;

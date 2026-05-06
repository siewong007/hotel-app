import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
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
} from '@mui/material';
import {
  Hotel as HotelIcon,
  Lock as LockIcon,
  Fingerprint as FingerprintIcon,
  ArrowBack as ArrowBackIcon,
  VpnKey as VpnKeyIcon,
  Person as PersonIcon,
  AdminPanelSettings as AdminIcon,
} from '@mui/icons-material';
import { useAuth } from '../../../auth/AuthContext';
import { getHotelSettings } from '../../../utils/hotelSettings';
import FirstLoginPasskeyPrompt from './FirstLoginPasskeyPrompt';
import { LoadingSpinner } from '../../../components';

type UserType = 'guest' | 'admin' | null;
type LoginMethod = 'password' | 'passkey' | null;

const LoginPage: React.FC = () => {
  const hotelSettings = getHotelSettings();
  const [userType, setUserType] = useState<UserType>(null);
  const [loginMethod, setLoginMethod] = useState<LoginMethod>(null);
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
  const { login, loginWithPasskey, registerPasskey } = useAuth();
  const navigate = useNavigate();

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const isFirstLogin = await login(username, password, totpCode || undefined);
      if (isFirstLogin) {
        setShowFirstLoginPrompt(true);
        setLoading(false);
      } else {
        navigate('/');
      }
    } catch (err: any) {
      const errorMessage = err.message || 'Login failed';

      // Check if 2FA is required
      if (errorMessage.includes('2FA required') || errorMessage.includes('TOTP code')) {
        setShow2FAPrompt(true);
        setError('');
        setLoading(false);
        return;
      }

      setError(errorMessage);
      setLoading(false);
    }
  };

  const handle2FASubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!totpCode || totpCode.length !== 6) {
      setError('Please enter a valid 6-digit code');
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
        navigate('/');
      }
    } catch (err: any) {
      setError(err.message || 'Passkey login failed');
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
    } catch (err: any) {
      setError(err.message || 'Passkey registration failed');
    } finally {
      setLoading(false);
    }
  };

  const handleBackToUserType = () => {
    setUserType(null);
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
        console.log('WebAuthn not supported, showing password field');
        setShowPasswordField(true);
        setPasskeyAttempted(true);
        setPasskeyCheckInProgress(false);
        return;
      }

      // Attempt passkey login
      console.log('Attempting passkey authentication for:', username);
      const isFirstLogin = await loginWithPasskey(username);
      setPasskeyAttempted(true);

      if (isFirstLogin) {
        setShowFirstLoginPrompt(true);
      } else {
        navigate('/');
      }
    } catch (err: any) {
      // Passkey failed or not available - show password field
      console.log('Passkey authentication failed:', err.message);
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
        onClose={() => navigate('/')}
      />
    );
  }

  if (show2FAPrompt) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--hotel-page-bg)',
        }}
      >
        <Container maxWidth="sm">
          <Fade in timeout={800}>
            <Paper elevation={24} sx={{ p: 5, borderRadius: 3 }}>
              <Box sx={{ textAlign: 'center', mb: 4 }}>
                <VpnKeyIcon sx={{ fontSize: 60, color: 'var(--hotel-primary)', mb: 2 }} />
                <Typography variant="h4" gutterBottom fontWeight="bold">
                  Two-Factor Authentication
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Enter the 6-digit code from your authenticator app
                </Typography>
              </Box>

              <form onSubmit={handle2FASubmit}>
                <TextField
                  fullWidth
                  label="6-Digit Code"
                  value={totpCode}
                  onChange={(e) => {
                    const value = e.target.value.replace(/\D/g, '').slice(0, 6);
                    setTotpCode(value);
                  }}
                  placeholder="000000"
                  inputProps={{
                    maxLength: 6,
                    style: { textAlign: 'center', fontSize: '24px', letterSpacing: '8px' }
                  }}
                  sx={{ mb: 3 }}
                  autoFocus
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
                  disabled={loading || totpCode.length !== 6}
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
      sx={{
        minHeight: '100vh',
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
      <Container maxWidth="sm" sx={{ position: 'relative', zIndex: 1 }}>
        <Fade in timeout={800}>
          <Paper
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
            <Box sx={{ textAlign: 'left', mb: 5 }}>
              <Typography
                variant="h1"
                sx={{
                  fontSize: { xs: '3rem', sm: '4rem', md: '5rem' },
                  fontWeight: 900,
                  letterSpacing: '-0.02em',
                  lineHeight: 0.9,
                  mb: 1,
                  textTransform: 'uppercase',
                  background: 'var(--hotel-action-gradient)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}
              >
                HOTEL
              </Typography>
              <Box sx={{
                width: '60px',
                height: '4px',
                background: 'var(--hotel-action-gradient)',
                mb: 2,
              }} />
              <Typography
                variant="h5"
                sx={{
                  fontWeight: 600,
                  letterSpacing: '0.1em',
                  color: 'var(--hotel-accent-text)',
                  textTransform: 'uppercase',
                  fontSize: '0.9rem',
                  mb: 1,
                }}
              >
                {hotelSettings.hotel_name}
              </Typography>
              <Typography
                variant="body2"
                sx={{
                  color: 'var(--hotel-text-secondary)',
                  fontSize: '0.875rem',
                  letterSpacing: '0.02em',
                }}
              >
                {!userType && 'Select your account type'}
                {userType && `Sign in as ${userType === 'guest' ? 'Guest' : 'Admin'}`}
              </Typography>
            </Box>

            {/* Back Button */}
            {userType && (
              <Fade in>
                <Box sx={{ mb: 2 }}>
                  <IconButton
                    onClick={handleBackToUserType}
                    sx={{
                      color: 'var(--hotel-primary)',
                      transition: 'all 0.3s',
                      '&:hover': {
                        transform: 'translateX(-4px)',
                        backgroundColor: 'var(--hotel-muted-bg)',
                      },
                    }}
                  >
                    <ArrowBackIcon />
                  </IconButton>
                </Box>
              </Fade>
            )}

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
                    onClick={() => setUserType('guest')}
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
                          <Typography variant="h5" fontWeight={700} gutterBottom color="var(--hotel-accent-text)">
                            Guest
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            Book rooms, manage reservations, and enjoy rewards
                          </Typography>
                        </Box>
                      </Box>
                    </CardContent>
                  </Card>

                  <Card
                    onClick={() => setUserType('admin')}
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
                          <Typography variant="h5" fontWeight={700} gutterBottom color="var(--hotel-accent-text)">
                            Admin
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            Manage hotel operations, guests, and analytics
                          </Typography>
                        </Box>
                      </Box>
                    </CardContent>
                  </Card>

                  <Box sx={{ mt: 3, textAlign: 'center' }}>
                    <Typography variant="body2" color="text.secondary">
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

            {/* Gmail-Style Login Form */}
            {userType && (
              <Slide direction="left" in timeout={400}>
                <Box>
                  <Box sx={{ mb: 3, textAlign: 'center' }}>
                    <Box
                      sx={{
                        display: 'inline-flex',
                        p: 2,
                        borderRadius: '50%',
                        background: passkeyCheckInProgress
                          ? 'linear-gradient(135deg, var(--hotel-primary) 0%, var(--hotel-secondary) 100%)'
                          : 'var(--hotel-action-gradient)',
                        mb: 2,
                        animation: passkeyCheckInProgress ? 'pulse 1.5s ease-in-out infinite' : 'none',
                        '@keyframes pulse': {
                          '0%, 100%': { transform: 'scale(1)', opacity: 1 },
                          '50%': { transform: 'scale(1.05)', opacity: 0.8 },
                        },
                      }}
                    >
                      {passkeyCheckInProgress ? (
                        <FingerprintIcon sx={{ fontSize: 32, color: 'white' }} />
                      ) : usernameSubmitted ? (
                        <PersonIcon sx={{ fontSize: 32, color: 'white' }} />
                      ) : (
                        <LockIcon sx={{ fontSize: 32, color: 'white' }} />
                      )}
                    </Box>
                    <Typography variant="h6" fontWeight={600} color="var(--hotel-accent-text)">
                      {passkeyCheckInProgress ? 'Authenticating...' : 'Sign In'}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                      {passkeyCheckInProgress
                        ? 'Checking for passkey'
                        : userType === 'guest' ? 'Guest Account' : 'Admin Account'}
                    </Typography>
                  </Box>

                  {/* Step 1: Username Entry */}
                  {!usernameSubmitted && !passkeyCheckInProgress && (
                    <form onSubmit={handleUsernameSubmit}>
                      <TextField
                        fullWidth
                        label="Username or Email"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        margin="normal"
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
                          mt: 3,
                          mb: 2,
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
                    </form>
                  )}

                  {/* Step 2: Passkey Check or Password Entry */}
                  {(usernameSubmitted || passkeyCheckInProgress) && (
                    <Box>
                      {/* Show username with edit option */}
                      <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Box
                          sx={{
                            flex: 1,
                            p: 2,
                            borderRadius: 2,
                            background: 'var(--hotel-muted-bg)',
                            border: '1px solid var(--hotel-divider)',
                          }}
                        >
                          <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
                            Username
                          </Typography>
                          <Typography variant="body1" fontWeight={600} color="var(--hotel-accent-text)">
                            {username}
                          </Typography>
                        </Box>
                        {!passkeyCheckInProgress && (
                          <Button
                            variant="outlined"
                            size="small"
                            onClick={handleEditUsername}
                            sx={{
                              minWidth: 'auto',
                              px: 2,
                              borderColor: 'var(--hotel-primary)',
                              color: 'var(--hotel-primary)',
                              '&:hover': {
                                borderColor: 'var(--hotel-primary-dark)',
                                backgroundColor: 'var(--hotel-muted-bg)',
                              },
                            }}
                          >
                            Edit
                          </Button>
                        )}
                      </Box>

                      {/* Loading state during passkey check */}
                      {passkeyCheckInProgress && (
                        <Box sx={{ textAlign: 'center', py: 4 }}>
                          <LoadingSpinner size={40} />
                          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                            Checking for passkey...
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
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
                              value={password}
                              onChange={(e) => setPassword(e.target.value)}
                              margin="normal"
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
                                mt: 3,
                                mb: 2,
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

                            <Box sx={{ textAlign: 'center' }}>
                              <Typography variant="caption" color="text.secondary">
                                Passkey not available. Using password instead.
                              </Typography>
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

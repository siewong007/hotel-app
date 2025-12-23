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
import FirstLoginPasskeyPrompt from './FirstLoginPasskeyPrompt';
import { LoadingSpinner } from '../../../components';

type UserType = 'guest' | 'admin' | null;
type LoginMethod = 'password' | 'passkey' | null;

const LoginPage: React.FC = () => {
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
          background: 'linear-gradient(135deg, #26C6DA 0%, #66BB6A 100%)',
        }}
      >
        <Container maxWidth="sm">
          <Fade in timeout={800}>
            <Paper elevation={24} sx={{ p: 5, borderRadius: 3 }}>
              <Box sx={{ textAlign: 'center', mb: 4 }}>
                <VpnKeyIcon sx={{ fontSize: 60, color: '#00ACC1', mb: 2 }} />
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
                    background: 'linear-gradient(135deg, #00BCD4 0%, #26C6DA 100%)',
                    '&:hover': {
                      background: 'linear-gradient(135deg, #00ACC1 0%, #00BCD4 100%)',
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
                    borderColor: '#00BCD4',
                    color: '#00BCD4',
                    '&:hover': {
                      borderColor: '#00ACC1',
                      backgroundColor: 'rgba(0, 188, 212, 0.1)',
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
        background: 'linear-gradient(135deg, #E0F2F1 0%, #B2DFDB 50%, #80CBC4 100%)',
        position: 'relative',
        overflow: 'hidden',
        '&::before': {
          content: '""',
          position: 'absolute',
          top: '-50%',
          left: '-50%',
          width: '200%',
          height: '200%',
          background: 'radial-gradient(circle at 50% 50%, rgba(0, 188, 212, 0.15) 0%, transparent 50%)',
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
              background: 'rgba(255, 255, 255, 0.95)',
              backdropFilter: 'blur(20px)',
              border: '2px solid rgba(0, 188, 212, 0.2)',
              overflow: 'hidden',
              boxShadow: '0 20px 60px rgba(0, 188, 212, 0.3)',
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
                  background: 'linear-gradient(135deg, #00BCD4 0%, #81C784 100%)',
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
                background: 'linear-gradient(90deg, #00BCD4 0%, #66BB6A 100%)',
                mb: 2,
              }} />
              <Typography
                variant="h5"
                sx={{
                  fontWeight: 600,
                  letterSpacing: '0.1em',
                  color: '#00897B',
                  textTransform: 'uppercase',
                  fontSize: '0.9rem',
                  mb: 1,
                }}
              >
                Salim Inn
              </Typography>
              <Typography
                variant="body2"
                sx={{
                  color: 'rgba(0, 137, 123, 0.7)',
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
                      color: '#00BCD4',
                      transition: 'all 0.3s',
                      '&:hover': {
                        transform: 'translateX(-4px)',
                        backgroundColor: 'rgba(0, 188, 212, 0.1)',
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
                        boxShadow: '0 12px 32px rgba(0, 188, 212, 0.3)',
                        border: '2px solid #00BCD4',
                      },
                    }}
                  >
                    <CardContent sx={{ p: 3 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Box
                          sx={{
                            p: 2,
                            borderRadius: 2,
                            background: 'linear-gradient(135deg, #00BCD4 0%, #26C6DA 100%)',
                          }}
                        >
                          <PersonIcon sx={{ fontSize: 40, color: 'white' }} />
                        </Box>
                        <Box sx={{ flex: 1 }}>
                          <Typography variant="h5" fontWeight={700} gutterBottom color="#00897B">
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
                        boxShadow: '0 12px 32px rgba(102, 187, 106, 0.3)',
                        border: '2px solid #66BB6A',
                      },
                    }}
                  >
                    <CardContent sx={{ p: 3 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Box
                          sx={{
                            p: 2,
                            borderRadius: 2,
                            background: 'linear-gradient(135deg, #66BB6A 0%, #81C784 100%)',
                          }}
                        >
                          <AdminIcon sx={{ fontSize: 40, color: 'white' }} />
                        </Box>
                        <Box sx={{ flex: 1 }}>
                          <Typography variant="h5" fontWeight={700} gutterBottom color="#00897B">
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
                          color: '#00BCD4',
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
                          ? 'linear-gradient(135deg, #00BCD4 0%, #26C6DA 100%)'
                          : 'linear-gradient(135deg, #00BCD4 0%, #81C784 100%)',
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
                    <Typography variant="h6" fontWeight={600} color="#00897B">
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
                              borderColor: '#00BCD4',
                              borderWidth: '2px',
                            },
                          },
                          '& .MuiInputLabel-root.Mui-focused': {
                            color: '#00BCD4',
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
                          background: 'linear-gradient(135deg, #00BCD4 0%, #26C6DA 100%)',
                          fontWeight: 600,
                          fontSize: '1rem',
                          transition: 'all 0.3s',
                          '&:hover': {
                            background: 'linear-gradient(135deg, #00ACC1 0%, #00BCD4 100%)',
                            transform: 'translateY(-2px)',
                            boxShadow: '0 8px 24px rgba(0, 188, 212, 0.4)',
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
                            background: 'rgba(0, 188, 212, 0.1)',
                            border: '1px solid rgba(0, 188, 212, 0.3)',
                          }}
                        >
                          <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
                            Username
                          </Typography>
                          <Typography variant="body1" fontWeight={600} color="#00897B">
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
                              borderColor: '#00BCD4',
                              color: '#00BCD4',
                              '&:hover': {
                                borderColor: '#00ACC1',
                                backgroundColor: 'rgba(0, 188, 212, 0.1)',
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
                                    borderColor: '#00BCD4',
                                    borderWidth: '2px',
                                  },
                                },
                                '& .MuiInputLabel-root.Mui-focused': {
                                  color: '#00BCD4',
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
                                background: 'linear-gradient(135deg, #00BCD4 0%, #26C6DA 100%)',
                                fontWeight: 600,
                                fontSize: '1rem',
                                transition: 'all 0.3s',
                                '&:hover': {
                                  background: 'linear-gradient(135deg, #00ACC1 0%, #00BCD4 100%)',
                                  transform: 'translateY(-2px)',
                                  boxShadow: '0 8px 24px rgba(0, 188, 212, 0.4)',
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

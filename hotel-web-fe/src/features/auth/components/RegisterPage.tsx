import React, { useEffect, useState } from 'react';
import { useNavigate } from '../../../router';
import {
  Box,
  Container,
  Paper,
  TextField,
  Button,
  Typography,
  Alert,
  Grid,
  Fade,
  Collapse,
  CircularProgress,
} from '@mui/material';
import { PersonAdd as RegisterIcon } from '@mui/icons-material';
import { useAuth } from '../../../auth/AuthContext';
import { validateEmail, validatePhone } from '../../../utils/validation';
import { getHotelSettings } from '../../../utils/hotelSettings';
import { LoadingSpinner } from '../../../components';

const GUEST_LOGIN_REDIRECT_SECONDS = 5;

const RegisterPage: React.FC = () => {
  const hotelSettings = getHotelSettings();
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
    firstName: '',
    lastName: '',
    phone: '',
    addressLine1: '',
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [redirectCountdown, setRedirectCountdown] = useState<number | null>(null);
  const [emailError, setEmailError] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const { register } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (redirectCountdown === null) {
      return;
    }

    if (redirectCountdown === 0) {
      navigate('/login?account=guest&method=password', { replace: true });
      return;
    }

    const timer = window.setTimeout(() => {
      setRedirectCountdown(current => current === null ? null : current - 1);
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [navigate, redirectCountdown]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value,
    }));

    // Clear field-specific errors
    if (name === 'email') {
      setEmailError('');
    } else if (name === 'phone') {
      setPhoneError('');
    }
  };

  const handleBlur = (field: string) => {
    if (field === 'email') {
      setEmailError(formData.email.trim() ? validateEmail(formData.email) : '');
    } else if (field === 'phone') {
      setPhoneError(validatePhone(formData.phone));
    }
  };

  const validateForm = () => {
    if (!formData.username || !formData.firstName || !formData.lastName || !formData.phone || !formData.password || !formData.confirmPassword) {
      return 'Username, name, phone, and password are required';
    }

    if (formData.email.trim()) {
      const emailValidation = validateEmail(formData.email);
      if (emailValidation) {
        setEmailError(emailValidation);
        return emailValidation;
      }
    }

    const phoneValidation = validatePhone(formData.phone);
    if (phoneValidation) {
      setPhoneError(phoneValidation);
      return phoneValidation;
    }

    if (formData.password !== formData.confirmPassword) {
      return 'Passwords do not match';
    }

    if (formData.password.length < 8) {
      return 'Password must be at least 8 characters long';
    }

    return null;
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setRedirectCountdown(null);

    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);

    try {
      await register({
        username: formData.username,
        email: formData.email.trim() || undefined,
        password: formData.password,
        first_name: formData.firstName,
        last_name: formData.lastName,
        phone: formData.phone,
        address_line1: formData.addressLine1.trim() || undefined,
      });

      const requiresEmailVerification = Boolean(formData.email.trim());
      setSuccess(requiresEmailVerification
        ? 'Registration successful! Please check your email to verify your account before logging in.'
        : 'Registration successful! You can now log in with your username.');

      if (!requiresEmailVerification) {
        setRedirectCountdown(GUEST_LOGIN_REDIRECT_SECONDS);
      }
    } catch (err: any) {
      setError(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

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
            elevation={0}
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
                  color: 'var(--hotel-text-primary)',
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
                Create your account to get started
              </Typography>
            </Box>

            {/* Error Alert */}
            <Collapse in={!!error}>
              <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
                {error}
              </Alert>
            </Collapse>

            {/* Success Alert */}
            <Collapse in={!!success}>
              <Alert
                severity="success"
                sx={{
                  mb: 2,
                  alignItems: 'center',
                  '& .MuiAlert-message': { width: '100%' },
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="body2" fontWeight={600}>
                      {success}
                    </Typography>
                    {redirectCountdown !== null && (
                      <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>
                        Redirecting to the Guest portal in {redirectCountdown}{' '}
                        {redirectCountdown === 1 ? 'second' : 'seconds'}…
                      </Typography>
                    )}
                  </Box>
                  {redirectCountdown !== null && (
                    <Box sx={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
                      <CircularProgress
                        variant="determinate"
                        value={((GUEST_LOGIN_REDIRECT_SECONDS - redirectCountdown) / GUEST_LOGIN_REDIRECT_SECONDS) * 100}
                        size={48}
                        thickness={4}
                        sx={{
                          color: 'success.main',
                          '& .MuiCircularProgress-circle': {
                            transition: 'stroke-dashoffset 1s linear',
                          },
                        }}
                      />
                      <Box
                        sx={{
                          position: 'absolute',
                          inset: 0,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Typography variant="caption" fontWeight={700} color="success.main">
                          {redirectCountdown}
                        </Typography>
                      </Box>
                    </Box>
                  )}
                </Box>
              </Alert>
            </Collapse>

          <form onSubmit={handleRegister}>
            <Grid container spacing={2}>
              <Grid size={12}>
                <TextField
                  fullWidth
                  label="Username"
                  name="username"
                  value={formData.username}
                  onChange={handleInputChange}
                  required
                  autoFocus
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      transition: 'all 0.3s',
                      '&:hover': {
                        transform: 'translateY(-2px)',
                      },
                    },
                  }}
                />
              </Grid>

              <Grid size={12}>
                <TextField
                  fullWidth
                  label="Email (optional)"
                  name="email"
                  type="email"
                  value={formData.email}
                  onChange={handleInputChange}
                  onBlur={() => handleBlur('email')}
                  error={!!emailError}
                  helperText={emailError}
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      transition: 'all 0.3s',
                      '&:hover': {
                        transform: 'translateY(-2px)',
                      },
                    },
                  }}
                />
              </Grid>

              <Grid size={6}>
                <TextField
                  fullWidth
                  label="First Name"
                  name="firstName"
                  value={formData.firstName}
                  onChange={handleInputChange}
                  required
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      transition: 'all 0.3s',
                      '&:hover': {
                        transform: 'translateY(-2px)',
                      },
                    },
                  }}
                />
              </Grid>

              <Grid size={6}>
                <TextField
                  fullWidth
                  label="Last Name"
                  name="lastName"
                  value={formData.lastName}
                  onChange={handleInputChange}
                  required
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      transition: 'all 0.3s',
                      '&:hover': {
                        transform: 'translateY(-2px)',
                      },
                    },
                  }}
                />
              </Grid>

              <Grid size={12}>
                <TextField
                  fullWidth
                  label="Phone"
                  name="phone"
                  value={formData.phone}
                  onChange={handleInputChange}
                  onBlur={() => handleBlur('phone')}
                  error={!!phoneError}
                  helperText={phoneError}
                  required
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      transition: 'all 0.3s',
                      '&:hover': {
                        transform: 'translateY(-2px)',
                      },
                    },
                  }}
                />
              </Grid>

              <Grid size={12}>
                <TextField
                  fullWidth
                  label="Address (optional)"
                  name="addressLine1"
                  value={formData.addressLine1}
                  onChange={handleInputChange}
                  multiline
                  minRows={2}
                  inputProps={{ maxLength: 255 }}
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      transition: 'all 0.3s',
                      '&:hover': {
                        transform: 'translateY(-2px)',
                      },
                    },
                  }}
                />
              </Grid>

              <Grid size={12}>
                <TextField
                  fullWidth
                  label="Password"
                  name="password"
                  type="password"
                  value={formData.password}
                  onChange={handleInputChange}
                  required
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      transition: 'all 0.3s',
                      '&:hover': {
                        transform: 'translateY(-2px)',
                      },
                    },
                  }}
                />
              </Grid>

              <Grid size={12}>
                <TextField
                  fullWidth
                  label="Confirm Password"
                  name="confirmPassword"
                  type="password"
                  value={formData.confirmPassword}
                  onChange={handleInputChange}
                  required
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      transition: 'all 0.3s',
                      '&:hover': {
                        transform: 'translateY(-2px)',
                      },
                    },
                  }}
                />
              </Grid>
            </Grid>

            <Button
              type="submit"
              fullWidth
              variant="contained"
              sx={{
                mt: 3,
                mb: 2,
                py: 1.5,
                background: 'var(--hotel-action-gradient)',
                color: 'var(--hotel-on-accent)',
                fontWeight: 600,
                fontSize: '1rem',
                transition: 'all 0.3s',
                '&:hover': {
                  background: 'var(--hotel-action-gradient-hover)',
                  transform: 'translateY(-2px)',
                  boxShadow: '0 8px 16px var(--hotel-shadow-color)',
                },
                '&:active': {
                  transform: 'translateY(0)',
                },
              }}
              disabled={loading || redirectCountdown !== null}
            >
              {loading ? <LoadingSpinner size={24} /> : 'Create Account'}
            </Button>
          </form>

          <Box sx={{ mt: 3, textAlign: 'center' }}>
            <Typography variant="body2" sx={{ color: 'var(--hotel-text-secondary)' }}>
              Already have an account?{' '}
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
                    color: 'var(--hotel-primary-light)',
                  },
                }}
                onClick={() => navigate('/login')}
              >
                Sign in
              </Button>
            </Typography>
          </Box>
        </Paper>
        </Fade>
      </Container>
    </Box>
  );
};

export default RegisterPage;

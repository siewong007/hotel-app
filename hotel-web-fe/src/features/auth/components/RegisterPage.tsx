import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from '../../../router';
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
  Divider,
  IconButton,
  InputAdornment,
} from '@mui/material';
import {
  ArrowBack as ArrowBackIcon,
  PersonAdd as RegisterIcon,
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
} from '@mui/icons-material';
import { useAuth } from '../../../auth/AuthContext';
import { validateEmail, validatePhone } from '../../../utils/validation';
import { LoadingSpinner } from '../../../components';
import { storage } from '../../../utils/storage';
import { GoogleSignInButton, isGoogleSignInAvailable } from './GoogleSignInButton';
import { errorMessage } from '../../../utils/errorMessage';
import { returnFromAuthPage, safeGuestRedirect } from '../guestRedirect';
import { LanguageSwitcher } from '../../../components/common/LanguageSwitcher';
import { useTranslation } from '../../../i18n';
import { ConsentBlock } from '../../legal/components/ConsentBlock';
import { REGISTRATION_CONSENTS } from '../../legal/content';
import { useLegalLocale } from '../../legal/LegalLocaleContext';
import { useConsent } from '../../legal/useConsent';

const GUEST_LOGIN_REDIRECT_SECONDS = 5;

const RegisterPage: React.FC = () => {
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
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [redirectCountdown, setRedirectCountdown] = useState<number | null>(null);
  const [emailError, setEmailError] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const { register, loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [googleError, setGoogleError] = useState('');
  const consent = useConsent(REGISTRATION_CONSENTS);
  const { locale: legalLocale } = useLegalLocale();
  const { t } = useTranslation('auth');

  useEffect(() => {
    if (redirectCountdown === null) {
      return;
    }

    if (redirectCountdown === 0) {
      // Carry the booking intent through to sign-in. Dropping it here is what
      // made "Book stay" -> register -> login end on the dashboard with the
      // booking abandoned.
      const redirectParam = safeGuestRedirect(searchParams.get('redirect'));
      navigate(
        redirectParam
          ? `/login?redirect=${encodeURIComponent(redirectParam)}`
          : '/login',
        { replace: true }
      );
      return;
    }

    const timer = window.setTimeout(() => {
      setRedirectCountdown(current => current === null ? null : current - 1);
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [navigate, redirectCountdown, searchParams]);

  const handleBack = () => returnFromAuthPage(navigate, searchParams.get('redirect'));

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

    // Consent is checked here as well as on the server. The server is what
    // makes it binding; this is only so the guest sees which box they missed
    // instead of a generic API error.
    if (!consent.allRequiredGranted) {
      consent.setShowErrors(true);
      setError(t('register.consentRequired'));
      return;
    }

    setLoading(true);

    try {
      const consentPayload = consent.buildPayload(legalLocale);
      await register({
        username: formData.username,
        email: formData.email.trim() || undefined,
        password: formData.password,
        first_name: formData.firstName,
        last_name: formData.lastName,
        phone: formData.phone,
        address_line1: formData.addressLine1.trim() || undefined,
        consents: consentPayload.consents,
        marketing_opt_in: consentPayload.marketing_opt_in,
      });

      const requiresEmailVerification = Boolean(formData.email.trim());
      setSuccess(requiresEmailVerification
        ? 'Registration successful! Please check your email to verify your account before logging in.'
        : 'Registration successful! You can now log in with your username.');

      if (!requiresEmailVerification) {
        setRedirectCountdown(GUEST_LOGIN_REDIRECT_SECONDS);
      }
    } catch (err) {
      setError(errorMessage(err, 'Registration failed'));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleCredential = async (credential: string) => {
    setGoogleError('');
    setError('');

    if (!consent.allRequiredGranted) {
      consent.setShowErrors(true);
      setGoogleError(t('register.googleNeedsConsent'));
      return;
    }

    try {
      await loginWithGoogle(credential, consent.buildPayload(legalLocale));

      const storedUser = storage.getItem<{ profile_complete?: boolean }>('user');
      const redirectParam = safeGuestRedirect(searchParams.get('redirect'));
      if (storedUser?.profile_complete === false) {
        navigate(
          redirectParam
            ? `/complete-profile?redirect=${encodeURIComponent(redirectParam)}`
            : '/complete-profile',
          { replace: true }
        );
        return;
      }

      navigate(redirectParam ?? '/guest-portal', { replace: true });
    } catch (err) {
      const message = errorMessage(err, t('login.googleFailed'));
      // Same 503-on-status contract as LoginPage.tsx's Google handler — see
      // hotel-app-be/src/services/google_identity.rs.
      const googleStatus = (err as { statusCode?: number }).statusCode;
      setGoogleError(
        googleStatus === 503
          ? t('login.googleUnavailable')
          : googleStatus === 409
            ? t('login.googleStaffOnly')
            : message
      );
    }
  };

  return (
    <Box className="auth-page auth-page--register">
      <Box sx={{ position: 'absolute', top: 16, right: 16, zIndex: 2 }}>
        <LanguageSwitcher color="default" size="small" />
      </Box>
      <Container className="auth-container" maxWidth="sm" sx={{ position: 'relative', zIndex: 1 }}>
        <Fade in timeout={800}>
          <Paper
            className="auth-card"
            sx={{ p: { xs: 4, sm: 6 }, width: '100%', display: 'flex', flexDirection: 'column' }}
          >
            <Button
              startIcon={<ArrowBackIcon />}
              onClick={handleBack}
              sx={{ mb: 2, ml: -1, alignSelf: 'flex-start', color: 'var(--hotel-text-secondary)' }}
            >
              {t('common.back')}
            </Button>
            {/* Header - Modern Bold Typography */}
            <Box className="auth-heading" sx={{ mb: { xs: 3, sm: 4 } }}>
              <Typography variant="h1" sx={{ fontSize: { xs: '2.75rem', sm: '3.5rem' } }}>
                {t('register.title')}
              </Typography>
              <Typography
                variant="body2"
                sx={{ mt: 1, color: 'var(--hotel-text-secondary)' }}
              >
                {t('register.subtitle')}
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
                    <Typography variant="body2" sx={{
                      fontWeight: 600
                    }}>
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
                        <Typography
                          variant="caption"
                          sx={{
                            fontWeight: 700,
                            color: "success.main"
                          }}>
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
                  slotProps={{
                    htmlInput: { maxLength: 255 }
                  }}
                />
              </Grid>

              <Grid size={12}>
                <TextField
                  fullWidth
                  label="Password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  value={formData.password}
                  onChange={handleInputChange}
                  required
                  slotProps={{
                    input: {
                      endAdornment: (
                        <InputAdornment position="end">
                          <IconButton
                            aria-label={showPassword ? 'Hide password' : 'Show password'}
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
              </Grid>

              <Grid size={12}>
                <TextField
                  fullWidth
                  label="Confirm Password"
                  name="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={formData.confirmPassword}
                  onChange={handleInputChange}
                  required
                  slotProps={{
                    input: {
                      endAdornment: (
                        <InputAdornment position="end">
                          <IconButton
                            aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                            onClick={() => setShowConfirmPassword((prev) => !prev)}
                            onMouseDown={(e) => e.preventDefault()}
                            edge="end"
                            size="small"
                          >
                            {showConfirmPassword ? <VisibilityOffIcon /> : <VisibilityIcon />}
                          </IconButton>
                        </InputAdornment>
                      ),
                    },
                  }}
                />
              </Grid>
            </Grid>

            <ConsentBlock prompts={REGISTRATION_CONSENTS} state={consent} />

            <Button
              type="submit"
              fullWidth
              variant="contained"
              sx={{ mt: 3, mb: 2, py: 1.5 }}
              disabled={loading || redirectCountdown !== null}
            >
              {loading ? <LoadingSpinner size={24} /> : t('register.submit')}
            </Button>
          </form>

          {!success && isGoogleSignInAvailable() && (
            <>
              <Divider sx={{ my: 3 }}>{t('register.orCreate')}</Divider>
              <Collapse in={!!googleError}>
                <Alert severity="error" sx={{ mb: 2 }} onClose={() => setGoogleError('')}>
                  {googleError}
                </Alert>
              </Collapse>
              <GoogleSignInButton onCredential={handleGoogleCredential} />
            </>
          )}

          <Box sx={{ mt: 3, textAlign: 'center' }}>
            <Typography variant="body2" sx={{ color: 'var(--hotel-text-secondary)' }}>
              {t('register.alreadyHaveAccount')}{' '}
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
                {t('register.signIn')}
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

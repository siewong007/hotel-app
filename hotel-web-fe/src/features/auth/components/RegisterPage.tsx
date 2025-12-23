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
  Grid,
  Fade,
  Collapse,
} from '@mui/material';
import { PersonAdd as RegisterIcon } from '@mui/icons-material';
import { useAuth } from '../../../auth/AuthContext';
import { validateEmail, validatePhone } from '../../../utils/validation';
import { LoadingSpinner } from '../../../components';

const RegisterPage: React.FC = () => {
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
    firstName: '',
    lastName: '',
    phone: '',
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const { register } = useAuth();
  const navigate = useNavigate();

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
      setEmailError(validateEmail(formData.email));
    } else if (field === 'phone' && formData.phone) {
      setPhoneError(validatePhone(formData.phone));
    }
  };

  const validateForm = () => {
    if (!formData.username || !formData.email || !formData.password || !formData.confirmPassword) {
      return 'All fields are required';
    }

    // Validate email
    const emailValidation = validateEmail(formData.email);
    if (emailValidation) {
      setEmailError(emailValidation);
      return emailValidation;
    }

    // Validate phone if provided
    if (formData.phone) {
      const phoneValidation = validatePhone(formData.phone);
      if (phoneValidation) {
        setPhoneError(phoneValidation);
        return phoneValidation;
      }
    }

    if (formData.password !== formData.confirmPassword) {
      return 'Passwords do not match';
    }

    if (formData.password.length < 6) {
      return 'Password must be at least 6 characters long';
    }

    return null;
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);

    try {
      await register({
        username: formData.username,
        email: formData.email,
        password: formData.password,
        first_name: formData.firstName,
        last_name: formData.lastName,
        phone: formData.phone,
      });

      setSuccess('Registration successful! Please check your email to verify your account before logging in.');
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
        background: '#0a0a0a',
        position: 'relative',
        overflow: 'hidden',
        '&::before': {
          content: '""',
          position: 'absolute',
          top: '-50%',
          left: '-50%',
          width: '200%',
          height: '200%',
          background: 'radial-gradient(circle at 50% 50%, rgba(212, 175, 55, 0.1) 0%, transparent 50%)',
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
              borderRadius: 0,
              background: 'rgba(18, 18, 18, 0.8)',
              backdropFilter: 'blur(20px)',
              border: '1px solid rgba(212, 175, 55, 0.2)',
              overflow: 'hidden',
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
                  color: '#ffffff',
                  mb: 1,
                  textTransform: 'uppercase',
                  background: 'linear-gradient(135deg, #d4af37 0%, #f4d03f 100%)',
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
                background: 'linear-gradient(90deg, #d4af37 0%, #f4d03f 100%)',
                mb: 2,
              }} />
              <Typography
                variant="h5"
                sx={{
                  fontWeight: 600,
                  letterSpacing: '0.1em',
                  color: 'rgba(255, 255, 255, 0.7)',
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
                  color: 'rgba(255, 255, 255, 0.5)',
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
              <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>
                {success}
              </Alert>
            </Collapse>

          <form onSubmit={handleRegister}>
            <Grid container spacing={2}>
              <Grid item xs={12}>
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

              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Email"
                  name="email"
                  type="email"
                  value={formData.email}
                  onChange={handleInputChange}
                  onBlur={() => handleBlur('email')}
                  error={!!emailError}
                  helperText={emailError}
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

              <Grid item xs={6}>
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

              <Grid item xs={6}>
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

              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Phone"
                  name="phone"
                  value={formData.phone}
                  onChange={handleInputChange}
                  onBlur={() => handleBlur('phone')}
                  error={!!phoneError}
                  helperText={phoneError}
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

              <Grid item xs={12}>
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

              <Grid item xs={12}>
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
                background: 'linear-gradient(135deg, #d4af37 0%, #f4d03f 100%)',
                color: '#0a0a0a',
                fontWeight: 600,
                fontSize: '1rem',
                transition: 'all 0.3s',
                '&:hover': {
                  background: 'linear-gradient(135deg, #f4d03f 0%, #d4af37 100%)',
                  transform: 'translateY(-2px)',
                  boxShadow: '0 8px 16px rgba(212, 175, 55, 0.3)',
                },
                '&:active': {
                  transform: 'translateY(0)',
                },
              }}
              disabled={loading}
            >
              {loading ? <LoadingSpinner size={24} /> : 'Create Account'}
            </Button>
          </form>

          <Box sx={{ mt: 3, textAlign: 'center' }}>
            <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.6)' }}>
              Already have an account?{' '}
              <Button
                variant="text"
                sx={{
                  p: 0,
                  minWidth: 'auto',
                  fontSize: 'inherit',
                  textTransform: 'none',
                  fontWeight: 600,
                  color: '#d4af37',
                  '&:hover': {
                    background: 'transparent',
                    textDecoration: 'underline',
                    color: '#f4d03f',
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

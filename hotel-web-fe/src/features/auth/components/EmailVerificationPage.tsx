import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Box,
  Container,
  Paper,
  Typography,
  Alert,
  CircularProgress,
  Button,
} from '@mui/material';
import { CheckCircle as CheckCircleIcon, Error as ErrorIcon, Email as EmailIcon } from '@mui/icons-material';
import { HotelAPIService } from '../../../api';

const EmailVerificationPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [countdown, setCountdown] = useState(5);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);

  const token = searchParams.get('token');

  useEffect(() => {
    isMountedRef.current = true;

    if (!token) {
      setStatus('error');
      setMessage('Invalid verification link. No token provided.');
      return;
    }

    const verifyEmail = async () => {
      try {
        await HotelAPIService.verifyEmail(token);
        if (!isMountedRef.current) return;

        setStatus('success');
        setMessage('Email verified successfully!');

        // Auto redirect after 5 seconds
        timerRef.current = setInterval(() => {
          if (!isMountedRef.current) return;
          setCountdown((prev) => {
            if (prev <= 1) {
              if (timerRef.current) clearInterval(timerRef.current);
              navigate('/login');
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      } catch (error: any) {
        if (!isMountedRef.current) return;
        setStatus('error');
        setMessage(error.message || 'Email verification failed. The link may be expired or invalid.');
      }
    };

    verifyEmail();

    return () => {
      isMountedRef.current = false;
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [token, navigate]);

  const handleLoginRedirect = () => {
    navigate('/login');
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
        '&::before': {
          content: '""',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'var(--hotel-soft-glow)',
          opacity: 0.3,
        },
      }}
    >
      <Container maxWidth="sm" sx={{ position: 'relative', zIndex: 1 }}>
        <Paper
          elevation={24}
          sx={{
            p: 5,
            width: '100%',
            borderRadius: 3,
            background: 'var(--hotel-panel-bg)',
            backdropFilter: 'blur(10px)',
            border: '1px solid var(--hotel-divider)',
            boxShadow: '0 20px 60px var(--hotel-shadow-color)',
            textAlign: 'center',
          }}
        >
          <Box sx={{ mb: 4 }}>
            <Box sx={{
              display: 'inline-flex',
              p: 2,
              borderRadius: 2,
              background: 'var(--hotel-action-gradient)',
              mb: 2,
            }}>
              <EmailIcon sx={{ fontSize: 48, color: 'white' }} />
            </Box>
            <Typography variant="h4" component="h1" gutterBottom sx={{ fontWeight: 700, color: 'text.primary' }}>
              Email Verification
            </Typography>
          </Box>

          {status === 'loading' && (
            <Box sx={{ py: 4 }}>
              <CircularProgress size={60} sx={{ mb: 2 }} />
              <Typography variant="h6" gutterBottom>
                Verifying your email...
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Please wait while we verify your email address.
              </Typography>
            </Box>
          )}

          {status === 'success' && (
            <Box sx={{ py: 4 }}>
              <CheckCircleIcon sx={{ fontSize: 60, color: 'success.main', mb: 2 }} />
              <Typography variant="h6" gutterBottom sx={{ color: 'success.main' }}>
                {message}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                You can now log in to your account.
              </Typography>
              <Alert severity="info" sx={{ mb: 3 }}>
                Redirecting to login page in {countdown} seconds...
              </Alert>
              <Button
                variant="contained"
                onClick={handleLoginRedirect}
                sx={{
                  background: 'var(--hotel-action-gradient)',
                  fontWeight: 600,
                  '&:hover': {
                    background: 'var(--hotel-action-gradient-hover)',
                  },
                }}
              >
                Go to Login
              </Button>
            </Box>
          )}

          {status === 'error' && (
            <Box sx={{ py: 4 }}>
              <ErrorIcon sx={{ fontSize: 60, color: 'error.main', mb: 2 }} />
              <Typography variant="h6" gutterBottom sx={{ color: 'error.main' }}>
                Verification Failed
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                {message}
              </Typography>
              <Alert severity="warning" sx={{ mb: 3 }}>
                If you need a new verification link, please contact support.
              </Alert>
              <Button
                variant="contained"
                onClick={handleLoginRedirect}
                sx={{
                  background: 'var(--hotel-action-gradient)',
                  fontWeight: 600,
                  '&:hover': {
                    background: 'var(--hotel-action-gradient-hover)',
                  },
                }}
              >
                Back to Login
              </Button>
            </Box>
          )}
        </Paper>
      </Container>
    </Box>
  );
};

export default EmailVerificationPage;

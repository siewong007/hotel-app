import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from '../../../router';
import {
  Box,
  Container,
  Paper,
  Typography,
  Alert,
  Button,
} from '@mui/material';
import { CheckCircle as CheckCircleIcon, Error as ErrorIcon, Email as EmailIcon } from '@mui/icons-material';
import { AuthService } from '../../../api';
import { LogoLoader } from '../../../components';
import { guestErrorMessage } from '../../guestPortal/utils/feedback';
import { useTranslation } from '../../../i18n';

const EmailVerificationPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useTranslation('auth');
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [countdown, setCountdown] = useState(5);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);

  const token = searchParams.get('token');

  useEffect(() => {
    isMountedRef.current = true;

    if (!token) {
      setStatus('error');
      setMessage(t('verifyEmail.noToken'));
      return;
    }

    const verifyEmail = async () => {
      try {
        await AuthService.verifyEmail(token);
        if (!isMountedRef.current) return;

        setStatus('success');
        setMessage(t('verifyEmail.success'));

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
      } catch (error) {
        if (!isMountedRef.current) return;
        setStatus('error');
        setMessage(guestErrorMessage(error, t('verifyEmail.failedFallback')));
      }
    };

    verifyEmail();

    return () => {
      isMountedRef.current = false;
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [token, navigate, t]);

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
        background: 'var(--hotel-bg)',
        position: 'relative',
        '&::before': {
          content: '""',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background:
            'radial-gradient(circle at 78% 12%, rgba(201, 169, 106, 0.10), transparent 34%), radial-gradient(circle at 12% 88%, rgba(127, 168, 220, 0.05), transparent 40%)',
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
            background: 'var(--hotel-surface-overlay)',
            border: '1px solid var(--hotel-border)',
            boxShadow: 'var(--hotel-shadow-lg)',
            textAlign: 'center',
          }}
        >
          <Box sx={{ mb: 4 }}>
            <Box sx={{
              display: 'inline-flex',
              p: 2,
              borderRadius: 2,
              background: 'var(--hotel-primary-subtle)',
              border: '1px solid var(--hotel-primary-border)',
              mb: 2,
            }}>
              <EmailIcon sx={{ fontSize: 48, color: 'var(--hotel-primary)' }} />
            </Box>
            <Typography variant="h4" component="h1" gutterBottom sx={{ fontWeight: 700, color: 'text.primary' }}>
              {t('verifyEmail.title')}
            </Typography>
          </Box>

          {status === 'loading' && (
            <Box sx={{ py: 4 }}>
              <LogoLoader variant="inline" size={48} sx={{ mb: 2 }} />
              <Typography variant="h6" gutterBottom>
                {t('verifyEmail.verifying')}
              </Typography>
              <Typography variant="body2" sx={{
                color: "text.secondary"
              }}>
                {t('verifyEmail.verifyingSubtitle')}
              </Typography>
            </Box>
          )}

          {status === 'success' && (
            <Box sx={{ py: 4 }}>
              <CheckCircleIcon sx={{ fontSize: 60, color: 'success.main', mb: 2 }} />
              <Typography variant="h6" gutterBottom sx={{ color: 'success.main' }}>
                {message}
              </Typography>
              <Typography
                variant="body2"
                sx={{
                  color: "text.secondary",
                  mb: 3
                }}>
                {t('verifyEmail.successNext')}
              </Typography>
              <Alert severity="info" role="alert" sx={{ mb: 3 }}>
                {t('verifyEmail.redirecting', { count: countdown })}
              </Alert>
              <Button
                variant="contained"
                onClick={handleLoginRedirect}
                sx={{
                  background: 'var(--hotel-primary)',
                  fontWeight: 600,
                  '&:hover': {
                    background: 'var(--hotel-primary-hover)',
                  },
                }}
              >
                {t('verifyEmail.goToLogin')}
              </Button>
            </Box>
          )}

          {status === 'error' && (
            <Box sx={{ py: 4 }}>
              <ErrorIcon sx={{ fontSize: 60, color: 'error.main', mb: 2 }} />
              <Typography variant="h6" gutterBottom sx={{ color: 'error.main' }}>
                {t('verifyEmail.failedTitle')}
              </Typography>
              <Typography
                variant="body2"
                sx={{
                  color: "text.secondary",
                  mb: 3
                }}>
                {message}
              </Typography>
              {/* No resend flow exists on the public routes — the actionable
                  step that does exist is signing in: a verified account goes
                  straight through, and one still pending is told so. */}
              <Alert severity="warning" role="alert" sx={{ mb: 3 }}>
                {t('verifyEmail.failedHint')}
              </Alert>
              <Button
                variant="contained"
                onClick={handleLoginRedirect}
                sx={{
                  background: 'var(--hotel-primary)',
                  fontWeight: 600,
                  '&:hover': {
                    background: 'var(--hotel-primary-hover)',
                  },
                }}
              >
                {t('verifyEmail.backToLogin')}
              </Button>
            </Box>
          )}
        </Paper>
      </Container>
    </Box>
  );
};

export default EmailVerificationPage;

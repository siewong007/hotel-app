import React from 'react';
import { Box, Card, CardContent, Typography, Alert, Button } from '@mui/material';
import { Navigate, useNavigate, useSearchParams } from '../../../router';
import { useAuth } from '../../../auth/AuthContext';
import { useTranslation } from '../../../i18n';
import TwoFactorSetup from './TwoFactorSetup';
import { parseEnrollmentDeadline } from '../twoFactorEnrollment';

/**
 * Forced two-factor enrolment.
 *
 * Reached from sign-in while an account is inside its enrolment grace window:
 * the session is already valid, so this is a step the reader must finish rather
 * than an authentication gate. Modelled on CompleteProfilePage, which solves the
 * same shape of problem for guest profiles.
 *
 * The deadline is advisory here — the backend is what actually refuses an
 * overdue sign-in, so a reader who dismisses this page simply meets the refusal
 * at their next sign-in rather than bypassing anything.
 */
const EnrollTwoFactorPage: React.FC = () => {
  const { isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { t } = useTranslation('auth');

  if (isLoading) {
    return null;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Carried in the URL rather than auth state: this is advisory copy only,
  // so a refresh that drops it degrades to the undated warning.
  const deadline = parseEnrollmentDeadline(searchParams.get('deadline'));

  return (
    <Box className="auth-page" sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
      <Card sx={{ maxWidth: 640, width: '100%' }}>
        <CardContent>
          <Typography variant="h5" gutterBottom>
            {t('twoFactorEnrollment.title')}
          </Typography>
          <Alert severity="warning" sx={{ mb: 2 }}>
            {deadline
              ? t('twoFactorEnrollment.deadlineWarning', {
                  date: deadline.toLocaleDateString(),
                })
              : t('twoFactorEnrollment.warning')}
          </Alert>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('twoFactorEnrollment.passkeyNote')}
          </Typography>

          <TwoFactorSetup onSetupComplete={() => navigate('/')} />

          <Button sx={{ mt: 2 }} onClick={() => navigate('/')}>
            {t('twoFactorEnrollment.later')}
          </Button>
        </CardContent>
      </Card>
    </Box>
  );
};

export default EnrollTwoFactorPage;

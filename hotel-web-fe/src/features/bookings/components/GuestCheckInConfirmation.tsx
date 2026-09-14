import React from 'react';
import { useNavigate } from '../../../router';
import {
  Container,
  Paper,
  Typography,
  Button,
  Box,
  Alert,
} from '@mui/material';
import { CheckCircle as CheckCircleIcon } from '@mui/icons-material';
import { useTranslation } from '../../../i18n';

export const GuestCheckInConfirmation: React.FC = () => {
  const { t } = useTranslation('guestPortal');
  const navigate = useNavigate();

  return (
    <Container maxWidth="sm" sx={{ mt: { xs: 3, sm: 8 } }}>
      <Paper elevation={3} sx={{ p: 4, textAlign: 'center' }}>
        <Box sx={{ mb: 3 }}>
          <CheckCircleIcon
            sx={{ fontSize: 80, color: 'success.main' }}
          />
        </Box>

        <Typography variant="h4" component="h1" gutterBottom sx={{
          color: "success.main"
        }}>
          {t('checkin.confirmation.title')}
        </Typography>

        <Typography variant="body1" sx={{ mb: 3 }}>
          {t('checkin.confirmation.body')}
        </Typography>

        <Alert severity="info" sx={{ mb: 3, textAlign: 'left' }}>
          <Typography variant="body2" gutterBottom>
            <strong>{t('checkin.confirmation.nextSteps')}</strong>
          </Typography>
          <Typography variant="body2" component="ul" sx={{ pl: 2, mb: 0 }}>
            <li>{t('checkin.confirmation.steps.email')}</li>
            <li>{t('checkin.confirmation.steps.arrive')}</li>
            <li>{t('checkin.confirmation.steps.id')}</li>
            <li>{t('checkin.confirmation.steps.room')}</li>
          </Typography>
        </Alert>

        <Box sx={{ mb: 3 }}>
          <Typography variant="body2" sx={{
            color: "text.secondary"
          }}>
            {t('checkin.confirmation.contactNote')}
          </Typography>
        </Box>

        <Button
          variant="contained"
          fullWidth
          size="large"
          onClick={() => window.close()}
        >
          {t('common:actions.close')}
        </Button>

        <Button
          variant="text"
          fullWidth
          sx={{ mt: 1 }}
          onClick={() => navigate('/guest-checkin')}
        >
          {t('checkin.confirmation.startNew')}
        </Button>
      </Paper>
    </Container>
  );
};

export default GuestCheckInConfirmation;

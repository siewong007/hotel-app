import React, { useEffect, useState } from 'react';
import {
  Card,
  CardContent,
  Typography,
  Button,
  Box,
  Chip,
  Alert,
  CircularProgress,
} from '@mui/material';
import {
  VerifiedUser as VerifiedIcon,
  HourglassEmpty as PendingIcon,
  Error as ErrorIcon,
  Add as AddIcon,
  CheckCircle as CheckIcon,
} from '@mui/icons-material';
import { useNavigate, useSearchParams } from '../../../router';
import { useEkycStatus } from '../hooks/useEkycQueries';
import { statusLabel, useTranslation } from '../../../i18n';
import { formatHotelDate } from '../../../utils/date';

interface EkycStatus {
  id: number;
  status: 'pending' | 'under_review' | 'approved' | 'rejected' | 'expired';
  self_checkin_enabled: boolean;
  submitted_at: string;
  verified_at: string | null;
  verification_notes: string | null;
  full_name: string;
  id_type: string;
  id_expiry_date: string;
}

const EkycStatusCard: React.FC = () => {
  const { t } = useTranslation('ekyc');
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data, isLoading: loading, error: queryError } = useEkycStatus();
  const ekycStatus = (data as EkycStatus | null | undefined) ?? null;
  const error = queryError ? (queryError as Error).message || t('statusCard.fetchFailed') : '';
  const [justSubmitted, setJustSubmitted] = useState(false);

  useEffect(() => {
    if (searchParams.get('ekycSubmitted') === 'true') {
      setJustSubmitted(true);
      searchParams.delete('ekycSubmitted');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'pending':
        return {
          color: 'warning' as const,
          icon: <PendingIcon />,
          message: t('statusCard.messages.pending'),
        };
      case 'under_review':
        return {
          color: 'info' as const,
          icon: <PendingIcon />,
          message: t('statusCard.messages.under_review'),
        };
      case 'approved':
        return {
          color: 'success' as const,
          icon: <CheckIcon />,
          message: t('statusCard.messages.approved'),
        };
      case 'rejected':
        return {
          color: 'error' as const,
          icon: <ErrorIcon />,
          message: t('statusCard.messages.rejected'),
        };
      case 'expired':
        return {
          color: 'warning' as const,
          icon: <ErrorIcon />,
          message: t('statusCard.messages.expired'),
        };
      default:
        return {
          color: 'info' as const,
          icon: <PendingIcon />,
          message: '',
        };
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
            <CircularProgress />
          </Box>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent>
          <Alert severity="warning">
            {t('statusCard.loadFailed')}
          </Alert>
        </CardContent>
      </Card>
    );
  }

  // No eKYC submission yet
  if (!ekycStatus) {
    return (
      <Card sx={{ border: 2, borderColor: 'primary.main', borderStyle: 'dashed' }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
            <VerifiedIcon sx={{ fontSize: 40, color: 'primary.main', mr: 2 }} />
            <Box>
              <Typography variant="h6">{t('statusCard.enableTitle')}</Typography>
              <Typography variant="body2" sx={{
                color: "text.secondary"
              }}>
                {t('statusCard.enableSubtitle')}
              </Typography>
            </Box>
          </Box>

          <Typography variant="body2" sx={{
            marginBottom: "16px"
          }}>
            {t('statusCard.enableBody')}
          </Typography>

          <Alert severity="info" sx={{ mb: 2 }}>
            <Typography variant="body2">
              <strong>{t('statusCard.benefitsTitle')}</strong>
            </Typography>
            <Typography variant="caption" component="div">
              • {t('statusCard.benefitQueue')}
            </Typography>
            <Typography variant="caption" component="div">
              • {t('statusCard.benefitAccess')}
            </Typography>
          </Alert>

          <Button
            variant="contained"
            fullWidth
            startIcon={<AddIcon />}
            onClick={() => navigate('/ekyc')}
          >
            {t('statusCard.start')}
          </Button>
        </CardContent>
      </Card>
    );
  }

  // eKYC submission exists
  const statusConfig = getStatusConfig(ekycStatus.status);

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
          <Box sx={{ color: `${statusConfig.color}.main`, mr: 2 }}>
            {statusConfig.icon}
          </Box>
          <Box sx={{ flex: 1 }}>
            <Typography variant="h6">{t('statusCard.title')}</Typography>
            <Chip
              label={statusLabel(t, 'ekyc', ekycStatus.status)}
              color={statusConfig.color}
              size="small"
              sx={{ mt: 0.5 }}
            />
          </Box>
        </Box>

        {justSubmitted && (ekycStatus.status === 'pending' || ekycStatus.status === 'under_review') && (
          <Alert severity="success" sx={{ mb: 2 }}>
            <Typography variant="body2">
              <strong>{t('statusCard.receivedTitle')}</strong> {t('statusCard.receivedBody')}
            </Typography>
          </Alert>
        )}

        <Alert severity={statusConfig.color} sx={{ mb: 2 }}>
          {statusConfig.message}
        </Alert>

        {ekycStatus.self_checkin_enabled && (
          <Alert severity="success" sx={{ mb: 2 }}>
            <Typography variant="body2">
              <strong>{t('statusCard.selfCheckinTitle')}</strong> {t('statusCard.selfCheckinBody')}
            </Typography>
          </Alert>
        )}

        <Box sx={{ mt: 2 }}>
          <Typography
            variant="caption"
            sx={{
              color: "text.secondary",
              display: "block"
            }}>
            {t('statusCard.submittedAt', { date: formatHotelDate(ekycStatus.submitted_at) })}
          </Typography>
          {ekycStatus.verified_at && (
            <Typography
              variant="caption"
              sx={{
                color: "text.secondary",
                display: "block"
              }}>
              {t('statusCard.verifiedAt', { date: formatHotelDate(ekycStatus.verified_at) })}
            </Typography>
          )}
          {ekycStatus.verification_notes && (
            <Typography
              variant="caption"
              sx={{
                color: "text.secondary",
                display: "block",
                mt: 1
              }}>
              <strong>{t('statusCard.notesLabel')}</strong> {ekycStatus.verification_notes}
            </Typography>
          )}
        </Box>

        {(ekycStatus.status === 'rejected' || ekycStatus.status === 'expired') && (
          <Button
            variant="outlined"
            fullWidth
            sx={{ mt: 2 }}
            onClick={() => navigate('/ekyc')}
          >
            {t('statusCard.submitNew')}
          </Button>
        )}
      </CardContent>
    </Card>
  );
};

export default EkycStatusCard;

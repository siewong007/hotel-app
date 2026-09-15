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
import { useTranslation } from '../../../i18n';
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
  const error = queryError ? (queryError as Error).message || t('errors.fetchStatus') : '';
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
          label: t('card.status.pending.label'),
          message: t('card.status.pending.message'),
        };
      case 'under_review':
        return {
          color: 'info' as const,
          icon: <PendingIcon />,
          label: t('card.status.underReview.label'),
          message: t('card.status.underReview.message'),
        };
      case 'approved':
        return {
          color: 'success' as const,
          icon: <CheckIcon />,
          label: t('card.status.approved.label'),
          message: t('card.status.approved.message'),
        };
      case 'rejected':
        return {
          color: 'error' as const,
          icon: <ErrorIcon />,
          label: t('card.status.rejected.label'),
          message: t('card.status.rejected.message'),
        };
      case 'expired':
        return {
          color: 'warning' as const,
          icon: <ErrorIcon />,
          label: t('card.status.expired.label'),
          message: t('card.status.expired.message'),
        };
      default:
        return {
          color: 'info' as const,
          icon: <PendingIcon />,
          label: t('status:generic.unknown'),
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
            {t('card.loadError')}
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
              <Typography variant="h6">{t('card.enableTitle')}</Typography>
              <Typography variant="body2" sx={{
                color: "text.secondary"
              }}>
                {t('card.enableSubtitle')}
              </Typography>
            </Box>
          </Box>

          <Typography variant="body2" sx={{
            marginBottom: "16px"
          }}>
            {t('card.enableBody')}
          </Typography>

          <Alert severity="info" sx={{ mb: 2 }}>
            <Typography variant="body2">
              <strong>{t('card.benefitsTitle')}</strong>
            </Typography>
            <Typography variant="caption" component="div">
              {t('card.benefit1')}
            </Typography>
            <Typography variant="caption" component="div">
              {t('card.benefit2')}
            </Typography>
          </Alert>

          <Button
            variant="contained"
            fullWidth
            startIcon={<AddIcon />}
            onClick={() => navigate('/ekyc')}
          >
            {t('card.start')}
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
            <Typography variant="h6">{t('card.title')}</Typography>
            <Chip
              label={statusConfig.label}
              color={statusConfig.color}
              size="small"
              sx={{ mt: 0.5 }}
            />
          </Box>
        </Box>

        {justSubmitted && (ekycStatus.status === 'pending' || ekycStatus.status === 'under_review') && (
          <Alert severity="success" sx={{ mb: 2 }}>
            <Typography variant="body2">
              <strong>{t('card.submittedTitle')}</strong> {t('card.submittedBody')}
            </Typography>
          </Alert>
        )}

        <Alert severity={statusConfig.color} sx={{ mb: 2 }}>
          {statusConfig.message}
        </Alert>

        {ekycStatus.self_checkin_enabled && (
          <Alert severity="success" sx={{ mb: 2 }}>
            <Typography variant="body2">
              <strong>{t('card.selfCheckinTitle')}</strong> {t('card.selfCheckinBody')}
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
            {t('card.submittedAt', { date: formatHotelDate(ekycStatus.submitted_at) })}
          </Typography>
          {ekycStatus.verified_at && (
            <Typography
              variant="caption"
              sx={{
                color: "text.secondary",
                display: "block"
              }}>
              {t('card.verifiedAt', { date: formatHotelDate(ekycStatus.verified_at) })}
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
              <strong>{t('card.notes')}</strong> {ekycStatus.verification_notes}
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
            {t('card.submitNew')}
          </Button>
        )}
      </CardContent>
    </Card>
  );
};

export default EkycStatusCard;

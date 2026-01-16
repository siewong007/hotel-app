import React, { useState, useEffect } from 'react';
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
import { useNavigate, useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';

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
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [ekycStatus, setEkycStatus] = useState<EkycStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [justSubmitted, setJustSubmitted] = useState(false);

  useEffect(() => {
    // Check if user just submitted eKYC
    if (searchParams.get('ekycSubmitted') === 'true') {
      setJustSubmitted(true);
      // Remove the query param
      searchParams.delete('ekycSubmitted');
      setSearchParams(searchParams, { replace: true });
    }
    fetchEkycStatus();
  }, [searchParams, setSearchParams]);

  const fetchEkycStatus = async () => {
    try {
      setLoading(true);
      const response = await fetch('http://localhost:3030/ekyc/status', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('accessToken')}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch eKYC status');
      }

      const data = await response.json();
      setEkycStatus(data);
    } catch (err: any) {
      console.error('eKYC status error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'pending':
        return {
          color: 'warning' as const,
          icon: <PendingIcon />,
          label: 'Pending Review',
          message: 'Your identity verification is pending review by our team.',
        };
      case 'under_review':
        return {
          color: 'info' as const,
          icon: <PendingIcon />,
          label: 'Under Review',
          message: 'Our team is currently reviewing your identity verification.',
        };
      case 'approved':
        return {
          color: 'success' as const,
          icon: <CheckIcon />,
          label: 'Approved',
          message: 'Your identity has been verified successfully!',
        };
      case 'rejected':
        return {
          color: 'error' as const,
          icon: <ErrorIcon />,
          label: 'Rejected',
          message: 'Your verification was rejected. Please submit again with correct documents.',
        };
      case 'expired':
        return {
          color: 'warning' as const,
          icon: <ErrorIcon />,
          label: 'Expired',
          message: 'Your ID has expired. Please submit a new verification.',
        };
      default:
        return {
          color: 'info' as const,
          icon: <PendingIcon />,
          label: 'Unknown',
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
            Unable to load eKYC status. This feature may not be available yet.
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
              <Typography variant="h6">Enable Self Check-in</Typography>
              <Typography variant="body2" color="text.secondary">
                Complete your identity verification
              </Typography>
            </Box>
          </Box>

          <Typography variant="body2" paragraph>
            Complete eKYC (electronic Know Your Customer) verification to enable self-check-in
            for your bookings. No more waiting at the front desk!
          </Typography>

          <Alert severity="info" sx={{ mb: 2 }}>
            <Typography variant="body2">
              <strong>Benefits:</strong>
            </Typography>
            <Typography variant="caption" component="div">
              • Skip the front desk queue
            </Typography>
            <Typography variant="caption" component="div">
              • Instant room access upon arrival
            </Typography>
          </Alert>

          <Button
            variant="contained"
            fullWidth
            startIcon={<AddIcon />}
            onClick={() => navigate('/ekyc')}
          >
            Start eKYC Verification
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
            <Typography variant="h6">eKYC Verification</Typography>
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
              <strong>Submission Received!</strong> Your eKYC verification has been successfully submitted and is now under review.
              We'll notify you once it's been processed.
            </Typography>
          </Alert>
        )}

        <Alert severity={statusConfig.color} sx={{ mb: 2 }}>
          {statusConfig.message}
        </Alert>

        {ekycStatus.self_checkin_enabled && (
          <Alert severity="success" sx={{ mb: 2 }}>
            <Typography variant="body2">
              <strong>Self check-in is enabled!</strong> You can now check in to your bookings without visiting the front desk.
            </Typography>
          </Alert>
        )}

        <Box sx={{ mt: 2 }}>
          <Typography variant="caption" color="text.secondary" display="block">
            Submitted: {format(new Date(ekycStatus.submitted_at), 'MMM dd, yyyy')}
          </Typography>
          {ekycStatus.verified_at && (
            <Typography variant="caption" color="text.secondary" display="block">
              Verified: {format(new Date(ekycStatus.verified_at), 'MMM dd, yyyy')}
            </Typography>
          )}
          {ekycStatus.verification_notes && (
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
              <strong>Notes:</strong> {ekycStatus.verification_notes}
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
            Submit New Verification
          </Button>
        )}
      </CardContent>
    </Card>
  );
};

export default EkycStatusCard;

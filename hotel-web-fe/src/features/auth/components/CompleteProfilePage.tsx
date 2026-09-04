import React, { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Navigate, useNavigate, useSearchParams } from '../../../router';
import {
  Box,
  Container,
  Paper,
  TextField,
  Button,
  Typography,
  Alert,
  Collapse,
  Grid,
} from '@mui/material';
import { PersonAdd as ProfileIcon } from '@mui/icons-material';
import { useAuth } from '../../../auth/AuthContext';
import { AuthService } from '../../../api/auth.service';
import { validatePhone } from '../../../utils/validation';
import { useProfileQuery } from '../../user/hooks/useProfileQueries';
import { queryKeys } from '../../../api/queryKeys';
import { LoadingSpinner } from '../../../components';
import { errorMessage } from '../../../utils/errorMessage';
import { safeGuestRedirect } from '../guestRedirect';

// A Google account only ever supplies one combined name; split it into the
// first/last fields this form (and the backend contract) expect.
function splitFullName(fullName: string | undefined): { firstName: string; lastName: string } {
  const trimmed = (fullName ?? '').trim();
  if (!trimmed) {
    return { firstName: '', lastName: '' };
  }
  const [firstName, ...rest] = trimmed.split(/\s+/);
  return { firstName, lastName: rest.join(' ') };
}

const CompleteProfilePage: React.FC = () => {
  const { isAuthenticated, isLoading, user, applyProfileUpdate } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { data: profile } = useProfileQuery();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [prefilled, setPrefilled] = useState(false);

  useEffect(() => {
    if (prefilled || !profile) {
      return;
    }
    const { firstName: first, lastName: last } = splitFullName(profile.full_name);
    setFirstName(first);
    setLastName(last);
    setPhone(profile.phone ?? '');
    setPrefilled(true);
  }, [profile, prefilled]);

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <LoadingSpinner size={40} />
      </Box>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login?account=guest" replace />;
  }

  if (user?.user_type !== 'guest') {
    return <Navigate to="/" replace />;
  }

  if (user.profile_complete) {
    return <Navigate to="/guest-portal" replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!firstName.trim()) {
      setError('First name is required');
      return;
    }
    if (!lastName.trim()) {
      setError('Last name is required');
      return;
    }
    const phoneValidationError = validatePhone(phone);
    if (phoneValidationError) {
      setPhoneError(phoneValidationError);
      return;
    }
    setPhoneError('');

    setSubmitting(true);
    try {
      const updatedProfile = await AuthService.completeGuestProfile({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        phone: phone.trim(),
        address_line1: addressLine1.trim() || undefined,
      });

      // Keep the cached profile in sync for anything reading it via
      // useProfileQuery (same pattern as useUpdateProfileMutation), and flip
      // AuthContext's in-memory `user.profile_complete` so a Back navigation
      // to this page (or any future guard reading it from context) sees the
      // completed state immediately rather than the stale pre-submit value.
      queryClient.setQueryData(queryKeys.profile.me(), updatedProfile);
      applyProfileUpdate(updatedProfile);

      const redirectTarget = safeGuestRedirect(searchParams.get('redirect'));
      navigate(redirectTarget ?? '/guest-portal', { replace: true });
    } catch (err) {
      setError(errorMessage(err, 'Could not save your profile. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        py: 4,
      }}
    >
      <Container maxWidth="sm">
        <Paper elevation={3} sx={{ p: { xs: 3, sm: 4 } }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
            <ProfileIcon sx={{ color: 'var(--hotel-primary)', fontSize: 32 }} />
            <Typography variant="h5" sx={{ fontWeight: 700 }}>
              Finish setting up your account
            </Typography>
          </Box>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
            We just need a few more details before you can book or manage your stay.
          </Typography>

          <Collapse in={!!error}>
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
              {error}
            </Alert>
          </Collapse>

          <form onSubmit={handleSubmit} noValidate>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  fullWidth
                  label="First Name"
                  name="firstName"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                  autoFocus
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  fullWidth
                  label="Last Name"
                  name="lastName"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  required
                />
              </Grid>
              <Grid size={12}>
                <TextField
                  fullWidth
                  label="Phone Number"
                  name="phone"
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    if (phoneError) setPhoneError('');
                  }}
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
                  value={addressLine1}
                  onChange={(e) => setAddressLine1(e.target.value)}
                />
              </Grid>
            </Grid>

            <Button
              type="submit"
              fullWidth
              variant="contained"
              sx={{
                mt: 3,
                py: 1.5,
                background: 'var(--hotel-action-gradient)',
                fontWeight: 600,
              }}
              disabled={submitting}
            >
              {submitting ? <LoadingSpinner size={24} /> : 'Continue'}
            </Button>
          </form>
        </Paper>
      </Container>
    </Box>
  );
};

export default CompleteProfilePage;

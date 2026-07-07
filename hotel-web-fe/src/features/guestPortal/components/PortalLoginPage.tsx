import React, { useState } from 'react';
import { useNavigate } from '../../../router';
import {
  Container,
  Paper,
  Typography,
  TextField,
  Button,
  Box,
  Alert,
  CircularProgress,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import { GuestPortalDashboardService } from '../api/guestPortalDashboard.service';
import { setPortalToken } from '../api/portalTokenStore';

type LookupMode = 'booking_number' | 'member_number';

export const PortalLoginPage: React.FC = () => {
  const navigate = useNavigate();
  const [mode, setMode] = useState<LookupMode>('booking_number');
  const [email, setEmail] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleModeChange = (_event: React.MouseEvent<HTMLElement>, nextMode: LookupMode | null) => {
    if (nextMode) {
      setMode(nextMode);
      setIdentifier('');
      setError(null);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!email.trim() || !identifier.trim()) {
      setError('Please enter your email and ' + (mode === 'booking_number' ? 'booking number' : 'member number'));
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await GuestPortalDashboardService.login({
        email: email.trim(),
        ...(mode === 'booking_number'
          ? { booking_number: identifier.trim() }
          : { member_number: identifier.trim() }),
      });

      setPortalToken(response.token, response.expires_at);
      navigate('/portal', { replace: true });
    } catch {
      // Generic message only — never reveal whether the email vs. the
      // booking/member number was the mismatch.
      setError('We could not find a matching account. Please check your details and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container maxWidth="sm" sx={{ mt: 8 }}>
      <Paper elevation={3} sx={{ p: 4 }}>
        <Box sx={{ textAlign: 'center', mb: 3 }}>
          <Typography variant="h4" component="h1" gutterBottom>
            Guest Portal
          </Typography>
          <Typography variant="body2" color="text.secondary">
            View your stays, transactions, and membership benefits
          </Typography>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
          <ToggleButtonGroup
            value={mode}
            exclusive
            onChange={handleModeChange}
            size="small"
            disabled={loading}
          >
            <ToggleButton value="booking_number">Booking Number</ToggleButton>
            <ToggleButton value="member_number">Member Number</ToggleButton>
          </ToggleButtonGroup>
        </Box>

        <form onSubmit={handleSubmit}>
          <TextField
            fullWidth
            label="Email Address"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            margin="normal"
            required
            placeholder="Enter your email address"
            disabled={loading}
          />

          <TextField
            fullWidth
            label={mode === 'booking_number' ? 'Booking Number' : 'Member Number'}
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            margin="normal"
            required
            placeholder={mode === 'booking_number' ? 'Enter your booking/folio number' : 'Enter your member number'}
            disabled={loading}
          />

          <Button
            type="submit"
            variant="contained"
            fullWidth
            size="large"
            disabled={loading}
            sx={{ mt: 3 }}
            startIcon={loading && <CircularProgress size={20} />}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </Button>
        </form>
      </Paper>
    </Container>
  );
};

export default PortalLoginPage;

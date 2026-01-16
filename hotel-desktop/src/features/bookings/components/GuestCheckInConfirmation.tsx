import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Container,
  Paper,
  Typography,
  Button,
  Box,
  Alert,
} from '@mui/material';
import { CheckCircle as CheckCircleIcon } from '@mui/icons-material';

export const GuestCheckInConfirmation: React.FC = () => {
  const navigate = useNavigate();

  return (
    <Container maxWidth="sm" sx={{ mt: 8 }}>
      <Paper elevation={3} sx={{ p: 4, textAlign: 'center' }}>
        <Box sx={{ mb: 3 }}>
          <CheckCircleIcon
            sx={{ fontSize: 80, color: 'success.main' }}
          />
        </Box>

        <Typography variant="h4" component="h1" gutterBottom color="success.main">
          Pre-Check-In Complete!
        </Typography>

        <Typography variant="body1" sx={{ mb: 3 }}>
          Thank you for completing your pre-check-in. Your information has been successfully submitted.
        </Typography>

        <Alert severity="info" sx={{ mb: 3, textAlign: 'left' }}>
          <Typography variant="body2" gutterBottom>
            <strong>Next Steps:</strong>
          </Typography>
          <Typography variant="body2" component="ul" sx={{ pl: 2, mb: 0 }}>
            <li>You will receive a confirmation email shortly</li>
            <li>Please arrive at the hotel during your scheduled check-in time</li>
            <li>Present your ID at the front desk for verification</li>
            <li>Your room will be ready for you</li>
          </Typography>
        </Alert>

        <Box sx={{ mb: 3 }}>
          <Typography variant="body2" color="text.secondary">
            If you need to make any changes to your booking or have questions, please contact us directly.
          </Typography>
        </Box>

        <Button
          variant="contained"
          fullWidth
          size="large"
          onClick={() => window.close()}
        >
          Close
        </Button>

        <Button
          variant="text"
          fullWidth
          sx={{ mt: 1 }}
          onClick={() => navigate('/guest-checkin')}
        >
          Start New Pre-Check-In
        </Button>
      </Paper>
    </Container>
  );
};

export default GuestCheckInConfirmation;

import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Button,
  Alert,
  CircularProgress,
  Card,
  CardContent
} from '@mui/material';
import {
  Refresh as RefreshIcon
} from '@mui/icons-material';
import { HotelAPIService } from '../../../api';
import { Guest } from '../../../types';

const GuestsPage: React.FC = () => {
  const [guests, setGuests] = useState<Guest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadGuests();
  }, []);

  const loadGuests = async () => {
    try {
      setLoading(true);
      const data = await HotelAPIService.getAllGuests();
      setGuests(data);
      setError(null);
    } catch (err: any) {
      console.error('Failed to load guests:', err);
      setError(err.message || 'Failed to load guests. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Box>
          <Typography variant="h4" component="h1" gutterBottom>
            All Guest Users
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Registered users with guest access. New guests register through the registration page.
          </Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={loadGuests}
        >
          Refresh
        </Button>
      </Box>

      {error && (
        <Alert
          severity="error"
          sx={{ mb: 3 }}
          action={
            <Button color="inherit" size="small" onClick={loadGuests}>
              Retry
            </Button>
          }
        >
          {error}
        </Alert>
      )}

      {/* Guest Statistics */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Guest User Statistics
          </Typography>
          <Typography variant="body1">
            Total registered guest users: <strong>{guests.length}</strong>
          </Typography>
        </CardContent>
      </Card>

      {/* Guests Table */}
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow sx={{ backgroundColor: '#f5f5f5' }}>
              <TableCell><strong>User ID</strong></TableCell>
              <TableCell><strong>Name</strong></TableCell>
              <TableCell><strong>Email</strong></TableCell>
              <TableCell><strong>Phone</strong></TableCell>
              <TableCell><strong>Status</strong></TableCell>
              <TableCell><strong>Registered Date</strong></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {guests.map((guest) => (
              <TableRow key={guest.id} hover>
                <TableCell>{guest.id}</TableCell>
                <TableCell>{guest.full_name || 'N/A'}</TableCell>
                <TableCell>{guest.email}</TableCell>
                <TableCell>{guest.phone || 'N/A'}</TableCell>
                <TableCell>
                  <Box
                    component="span"
                    sx={{
                      px: 1.5,
                      py: 0.5,
                      borderRadius: 1,
                      fontSize: '0.875rem',
                      fontWeight: 500,
                      bgcolor: guest.is_active ? 'success.light' : 'error.light',
                      color: guest.is_active ? 'success.dark' : 'error.dark',
                    }}
                  >
                    {guest.is_active ? 'Active' : 'Inactive'}
                  </Box>
                </TableCell>
                <TableCell>
                  {new Date(guest.created_at).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric'
                  })}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {guests.length === 0 && (
        <Box textAlign="center" py={4}>
          <Typography variant="h6" color="text.secondary">
            No guest users registered yet
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Guest users can register through the registration page
          </Typography>
        </Box>
      )}
    </Box>
  );
};

export default GuestsPage;

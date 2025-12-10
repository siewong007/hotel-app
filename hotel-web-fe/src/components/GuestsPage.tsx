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
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Alert,
  CircularProgress,
  Card,
  CardContent,
  Snackbar
} from '@mui/material';
import {
  PersonAdd as PersonAddIcon,
  Refresh as RefreshIcon
} from '@mui/icons-material';
import { HotelAPIService } from '../api';
import { Guest, GuestCreateRequest } from '../types';

const GuestsPage: React.FC = () => {
  const [guests, setGuests] = useState<Guest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Dialog state
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newGuestName, setNewGuestName] = useState('');
  const [newGuestEmail, setNewGuestEmail] = useState('');
  const [creating, setCreating] = useState(false);

  // Notifications
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');

  useEffect(() => {
    loadGuests();
  }, []);

  const loadGuests = async () => {
    try {
      setLoading(true);
      const data = await HotelAPIService.getAllGuests();
      setGuests(data);
      setError(null);
    } catch (err) {
      setError('Failed to load guests');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateGuest = async () => {
    if (!newGuestName || !newGuestEmail) return;

    try {
      setCreating(true);
      // Split name into first and last name
      const nameParts = newGuestName.trim().split(' ');
      const first_name = nameParts[0] || '';
      const last_name = nameParts.slice(1).join(' ') || '';

      const newGuest = await HotelAPIService.createGuest({
        first_name,
        last_name,
        email: newGuestEmail
      });

      setGuests(prev => [...prev, newGuest]);
      setSnackbarMessage(`Guest "${newGuest.full_name}" created successfully!`);
      setSnackbarOpen(true);

      // Reset form and close dialog
      setNewGuestName('');
      setNewGuestEmail('');
      setCreateDialogOpen(false);
    } catch (err) {
      setError('Failed to create guest');
    } finally {
      setCreating(false);
    }
  };

  const validateEmail = (email: string) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const isFormValid = newGuestName.trim() && validateEmail(newGuestEmail);

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
        <Typography variant="h4" component="h1">
          Guest Management
        </Typography>
        <Box display="flex" gap={2}>
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={loadGuests}
          >
            Refresh
          </Button>
          <Button
            variant="contained"
            startIcon={<PersonAddIcon />}
            onClick={() => setCreateDialogOpen(true)}
          >
            Add Guest
          </Button>
        </Box>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {/* Guest Statistics */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Guest Statistics
          </Typography>
          <Typography variant="body1">
            Total registered guests: <strong>{guests.length}</strong>
          </Typography>
        </CardContent>
      </Card>

      {/* Guests Table */}
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow sx={{ backgroundColor: '#f5f5f5' }}>
              <TableCell><strong>ID</strong></TableCell>
              <TableCell><strong>Name</strong></TableCell>
              <TableCell><strong>Email</strong></TableCell>
              <TableCell><strong>Registration Date</strong></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {guests.map((guest) => (
              <TableRow key={guest.id} hover>
                <TableCell>{guest.id}</TableCell>
                <TableCell>{guest.full_name}</TableCell>
                <TableCell>{guest.email}</TableCell>
                <TableCell>
                  {new Date().toLocaleDateString()} {/* In a real app, you'd store registration date */}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {guests.length === 0 && (
        <Box textAlign="center" py={4}>
          <Typography variant="h6" color="text.secondary">
            No guests registered yet
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Click "Add Guest" to register the first guest
          </Typography>
        </Box>
      )}

      {/* Create Guest Dialog */}
      <Dialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add New Guest</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            <TextField
              fullWidth
              label="Full Name"
              value={newGuestName}
              onChange={(e) => setNewGuestName(e.target.value)}
              sx={{ mb: 2 }}
              placeholder="Enter guest's full name"
            />
            <TextField
              fullWidth
              label="Email Address"
              type="email"
              value={newGuestEmail}
              onChange={(e) => setNewGuestEmail(e.target.value)}
              sx={{ mb: 2 }}
              placeholder="Enter email address"
              error={newGuestEmail !== '' && !validateEmail(newGuestEmail)}
              helperText={
                newGuestEmail !== '' && !validateEmail(newGuestEmail)
                  ? 'Please enter a valid email address'
                  : ''
              }
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
          <Button
            onClick={handleCreateGuest}
            variant="contained"
            disabled={creating || !isFormValid}
          >
            {creating ? <CircularProgress size={20} /> : 'Create Guest'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Success Snackbar */}
      <Snackbar
        open={snackbarOpen}
        autoHideDuration={4000}
        onClose={() => setSnackbarOpen(false)}
      >
        <Alert onClose={() => setSnackbarOpen(false)} severity="success">
          {snackbarMessage}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default GuestsPage;

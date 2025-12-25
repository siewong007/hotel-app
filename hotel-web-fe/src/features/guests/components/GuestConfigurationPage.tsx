import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Button,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  CircularProgress,
  Snackbar,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Chip,
  Grid,
  Card,
  CardContent,
  InputAdornment,
  Switch,
  FormControlLabel,
  Tooltip,
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Save as SaveIcon,
  Cancel as CancelIcon,
  Person as PersonIcon,
  PersonOff as PersonOffIcon,
  Search as SearchIcon,
  History as HistoryIcon,
  ToggleOn as ToggleOnIcon,
  ToggleOff as ToggleOffIcon,
  CardGiftcard as GiftIcon,
} from '@mui/icons-material';
import { HotelAPIService } from '../../../api';
import { Guest, GuestCreateRequest } from '../../../types';
import { useAuth } from '../../../auth/AuthContext';
import { validateEmail } from '../../../utils/validation';
import { useCurrency } from '../../../hooks/useCurrency';

interface GuestFormData extends GuestCreateRequest {
  id?: number;
}

const GuestConfigurationPage: React.FC = () => {
  const { hasRole, hasPermission } = useAuth();
  const { format: formatCurrency } = useCurrency();
  const hasAccess = hasRole('admin') || hasRole('receptionist') || hasRole('manager') || hasPermission('guests:read') || hasPermission('guests:manage');

  const [guests, setGuests] = useState<Guest[]>([]);
  const [filteredGuests, setFilteredGuests] = useState<Guest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  // Dialog states
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [bookingsDialogOpen, setBookingsDialogOpen] = useState(false);
  const [creditsDialogOpen, setCreditsDialogOpen] = useState(false);

  // Credits state
  interface GuestCredits {
    guest_id: number;
    guest_name: string;
    total_nights: number;
    legacy_total_nights: number;
    credits_by_room_type: {
      id: number;
      guest_id: number;
      room_type_id: number;
      room_type_name: string;
      room_type_code: string;
      nights_available: number;
    }[];
  }
  const [guestCredits, setGuestCredits] = useState<GuestCredits | null>(null);
  const [creditsLoading, setCreditsLoading] = useState(false);

  // Form states
  const [formData, setFormData] = useState<GuestFormData>({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    ic_number: '',
    nationality: '',
    address_line1: '',
    city: '',
    state_province: '',
    postal_code: '',
    country: '',
    is_active: true,
  });

  const [editingGuest, setEditingGuest] = useState<Guest | null>(null);
  const [deletingGuest, setDeletingGuest] = useState<Guest | null>(null);
  const [viewingGuest, setViewingGuest] = useState<Guest | null>(null);
  const [guestBookings, setGuestBookings] = useState<any[]>([]);
  const [formLoading, setFormLoading] = useState(false);

  // Snackbar
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');

  useEffect(() => {
    if (hasAccess) {
      loadData();
    }
  }, [hasAccess]);

  useEffect(() => {
    // Filter guests based on search term
    const filtered = guests.filter(guest =>
      guest.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      guest.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (guest.phone && guest.phone.includes(searchTerm)) ||
      (guest.ic_number && guest.ic_number.toLowerCase().includes(searchTerm.toLowerCase()))
    );
    // Sort: active guests first, then inactive guests, alphabetically within each group
    const sorted = [...filtered].sort((a, b) => {
      // First, sort by active status (active first)
      if (a.is_active !== b.is_active) {
        return a.is_active ? -1 : 1;
      }
      // Then sort alphabetically by name
      return a.full_name.localeCompare(b.full_name);
    });
    setFilteredGuests(sorted);
  }, [searchTerm, guests]);

  const loadData = async () => {
    try {
      setLoading(true);
      const guestsData = await HotelAPIService.getAllGuests();
      setGuests(guestsData);
      setFilteredGuests(guestsData);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      first_name: '',
      last_name: '',
      email: '',
      phone: '',
      ic_number: '',
      nationality: '',
      address_line1: '',
      city: '',
      state_province: '',
      postal_code: '',
      country: '',
      is_active: true,
    });
  };

  const handleCreateClick = () => {
    resetForm();
    setCreateDialogOpen(true);
  };

  const handleEditClick = (guest: Guest) => {
    setEditingGuest(guest);
    const [firstName, ...lastNameParts] = guest.full_name.split(' ');
    setFormData({
      first_name: firstName || '',
      last_name: lastNameParts.join(' ') || '',
      email: guest.email,
      phone: guest.phone || '',
      ic_number: guest.ic_number || '',
      nationality: guest.nationality || '',
      address_line1: guest.address_line1 || '',
      city: guest.city || '',
      state_province: guest.state_province || '',
      postal_code: guest.postal_code || '',
      country: guest.country || '',
      is_active: guest.is_active,
    });
    setEditDialogOpen(true);
  };

  const handleDeleteClick = (guest: Guest) => {
    setDeletingGuest(guest);
    setDeleteDialogOpen(true);
  };

  const handleViewBookings = async (guest: Guest) => {
    setViewingGuest(guest);
    try {
      const bookings = await HotelAPIService.getGuestBookings(guest.id);
      setGuestBookings(bookings);
      setBookingsDialogOpen(true);
    } catch (err: any) {
      setError(err.message || 'Failed to load bookings');
    }
  };

  const handleViewCredits = async (guest: Guest) => {
    setViewingGuest(guest);
    try {
      setCreditsLoading(true);
      const credits = await HotelAPIService.getGuestCredits(guest.id);
      setGuestCredits(credits);
      setCreditsDialogOpen(true);
    } catch (err: any) {
      setError(err.message || 'Failed to load credits');
    } finally {
      setCreditsLoading(false);
    }
  };

  const handleCreateGuest = async () => {
    if (!formData.first_name || !formData.last_name || !formData.email) {
      setError('Please fill in all required fields');
      return;
    }

    // Validate email format
    const emailError = validateEmail(formData.email);
    if (emailError) {
      setError(emailError);
      return;
    }

    try {
      setFormLoading(true);
      await HotelAPIService.createGuest(formData);
      setSnackbarMessage('Guest created successfully');
      setSnackbarOpen(true);
      setCreateDialogOpen(false);
      resetForm();
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to create guest');
    } finally {
      setFormLoading(false);
    }
  };

  const handleUpdateGuest = async () => {
    if (!editingGuest) return;

    try {
      setFormLoading(true);
      await HotelAPIService.updateGuest(editingGuest.id, formData);
      setSnackbarMessage('Guest updated successfully');
      setSnackbarOpen(true);
      setEditDialogOpen(false);
      setEditingGuest(null);
      resetForm();
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to update guest');
    } finally {
      setFormLoading(false);
    }
  };

  const handleDeleteGuest = async () => {
    if (!deletingGuest) return;

    try {
      setFormLoading(true);
      await HotelAPIService.deleteGuest(deletingGuest.id);
      setSnackbarMessage('Guest deleted successfully');
      setSnackbarOpen(true);
      setDeleteDialogOpen(false);
      setDeletingGuest(null);
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to delete guest');
    } finally {
      setFormLoading(false);
    }
  };

  const handleToggleActive = async (guest: Guest) => {
    try {
      await HotelAPIService.updateGuest(guest.id, { is_active: !guest.is_active });
      setSnackbarMessage(`Guest ${guest.is_active ? 'deactivated' : 'activated'} successfully`);
      setSnackbarOpen(true);
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to update guest status');
    }
  };

  if (!hasAccess) {
    return (
      <Alert severity="warning">
        You do not have permission to access this page. Contact your administrator for access.
      </Alert>
    );
  }

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  const activeGuests = guests.filter(g => g.is_active).length;

  return (
    <Box sx={{ p: 3 }}>
      <Snackbar
        open={snackbarOpen}
        autoHideDuration={6000}
        onClose={() => setSnackbarOpen(false)}
        message={snackbarMessage}
      />

      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
            <PersonIcon sx={{ fontSize: 32 }} />
            Guest Configuration
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Manage guest records - Create, edit, delete, and view booking history
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={handleCreateClick}
          sx={{ borderRadius: 2 }}
        >
          Add New Guest
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Statistics Cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent sx={{ textAlign: 'center' }}>
              <Typography variant="h4" sx={{ fontWeight: 600, color: 'primary.main' }}>
                {guests.length}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Total Guests
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent sx={{ textAlign: 'center' }}>
              <Typography variant="h4" sx={{ fontWeight: 600, color: 'success.main' }}>
                {activeGuests}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Active
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent sx={{ textAlign: 'center' }}>
              <Typography variant="h4" sx={{ fontWeight: 600, color: 'warning.main' }}>
                {guests.length - activeGuests}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Inactive
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent sx={{ textAlign: 'center' }}>
              <Typography variant="h4" sx={{ fontWeight: 600, color: 'info.main' }}>
                {guests.filter(g => g.ic_number).length}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                With IC Number
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Search Bar */}
      <Card sx={{ mb: 2 }}>
        <CardContent>
          <TextField
            fullWidth
            placeholder="Search by name, email, phone, or IC number..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon />
                </InputAdornment>
              ),
            }}
          />
        </CardContent>
      </Card>

      {/* Guests Table */}
      <Card>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Email</TableCell>
                <TableCell>Phone</TableCell>
                <TableCell>IC Number</TableCell>
                <TableCell>Nationality</TableCell>
                <TableCell>Free Gift Credits</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredGuests.map((guest) => (
                <TableRow
                  key={guest.id}
                  sx={{
                    opacity: guest.is_active ? 1 : 0.6,
                    bgcolor: guest.is_active ? 'inherit' : 'action.hover',
                  }}
                >
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      {!guest.is_active && (
                        <PersonOffIcon sx={{ fontSize: 18, color: 'text.disabled' }} />
                      )}
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {guest.full_name}
                      </Typography>
                    </Box>
                  </TableCell>
                  <TableCell>{guest.email}</TableCell>
                  <TableCell>{guest.phone || '-'}</TableCell>
                  <TableCell>{guest.ic_number || '-'}</TableCell>
                  <TableCell>{guest.nationality || '-'}</TableCell>
                  <TableCell>
                    {guest.complimentary_nights_credit > 0 ? (
                      <Chip
                        icon={<GiftIcon sx={{ fontSize: 16 }} />}
                        label={`${guest.complimentary_nights_credit} night${guest.complimentary_nights_credit !== 1 ? 's' : ''}`}
                        size="small"
                        color="secondary"
                      />
                    ) : (
                      <Typography variant="body2" color="text.disabled">-</Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={guest.is_active ? 'Active' : 'Inactive'}
                      size="small"
                      color={guest.is_active ? 'success' : 'default'}
                      onClick={() => handleToggleActive(guest)}
                      sx={{ cursor: 'pointer' }}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title={guest.is_active ? 'Mark as Inactive' : 'Mark as Active'}>
                      <IconButton
                        size="small"
                        onClick={() => handleToggleActive(guest)}
                        color={guest.is_active ? 'warning' : 'success'}
                      >
                        {guest.is_active ? <ToggleOffIcon /> : <ToggleOnIcon />}
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="View Bookings">
                      <IconButton
                        size="small"
                        onClick={() => handleViewBookings(guest)}
                        color="info"
                      >
                        <HistoryIcon />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Edit">
                      <IconButton
                        size="small"
                        onClick={() => handleEditClick(guest)}
                        color="primary"
                      >
                        <EditIcon />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Delete">
                      <IconButton
                        size="small"
                        onClick={() => handleDeleteClick(guest)}
                        color="error"
                      >
                        <DeleteIcon />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      {/* Create Dialog */}
      <Dialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Create New Guest</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="First Name"
                value={formData.first_name}
                onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                required
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Last Name"
                value={formData.last_name}
                onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                required
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                required
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Phone"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="IC Number / Passport"
                value={formData.ic_number}
                onChange={(e) => setFormData({ ...formData, ic_number: e.target.value })}
                helperText="Identity card or passport number"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Nationality"
                value={formData.nationality}
                onChange={(e) => setFormData({ ...formData, nationality: e.target.value })}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Address"
                value={formData.address_line1}
                onChange={(e) => setFormData({ ...formData, address_line1: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="City"
                value={formData.city}
                onChange={(e) => setFormData({ ...formData, city: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="State/Province"
                value={formData.state_province}
                onChange={(e) => setFormData({ ...formData, state_province: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Postal Code"
                value={formData.postal_code}
                onChange={(e) => setFormData({ ...formData, postal_code: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Country"
                value={formData.country}
                onChange={(e) => setFormData({ ...formData, country: e.target.value })}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialogOpen(false)} startIcon={<CancelIcon />}>
            Cancel
          </Button>
          <Button
            onClick={handleCreateGuest}
            variant="contained"
            startIcon={<SaveIcon />}
            disabled={formLoading}
          >
            {formLoading ? <CircularProgress size={20} /> : 'Create Guest'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onClose={() => setEditDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Edit Guest: {editingGuest?.full_name}</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="First Name"
                value={formData.first_name}
                onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Last Name"
                value={formData.last_name}
                onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Phone"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="IC Number / Passport"
                value={formData.ic_number}
                onChange={(e) => setFormData({ ...formData, ic_number: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Nationality"
                value={formData.nationality}
                onChange={(e) => setFormData({ ...formData, nationality: e.target.value })}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Address"
                value={formData.address_line1}
                onChange={(e) => setFormData({ ...formData, address_line1: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="City"
                value={formData.city}
                onChange={(e) => setFormData({ ...formData, city: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="State/Province"
                value={formData.state_province}
                onChange={(e) => setFormData({ ...formData, state_province: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Postal Code"
                value={formData.postal_code}
                onChange={(e) => setFormData({ ...formData, postal_code: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Country"
                value={formData.country}
                onChange={(e) => setFormData({ ...formData, country: e.target.value })}
              />
            </Grid>
            <Grid item xs={12}>
              <Box
                sx={{
                  p: 2,
                  mt: 1,
                  bgcolor: formData.is_active ? 'success.light' : 'warning.light',
                  borderRadius: 1,
                  border: 1,
                  borderColor: formData.is_active ? 'success.main' : 'warning.main',
                  opacity: 0.8,
                }}
              >
                <FormControlLabel
                  control={
                    <Switch
                      checked={formData.is_active}
                      onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                      color={formData.is_active ? 'success' : 'warning'}
                    />
                  }
                  label={
                    <Box>
                      <Typography variant="body1" sx={{ fontWeight: 600 }}>
                        {formData.is_active ? 'Active Guest' : 'Inactive Guest'}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {formData.is_active
                          ? 'Guest can make bookings and check in'
                          : 'Guest is inactive and will appear at the bottom of the list'}
                      </Typography>
                    </Box>
                  }
                />
              </Box>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditDialogOpen(false)} startIcon={<CancelIcon />}>
            Cancel
          </Button>
          <Button
            onClick={handleUpdateGuest}
            variant="contained"
            startIcon={<SaveIcon />}
            disabled={formLoading}
          >
            {formLoading ? <CircularProgress size={20} /> : 'Save Changes'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Delete Guest</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            Are you sure you want to delete guest <strong>{deletingGuest?.full_name}</strong>?
          </Alert>
          <Typography variant="body2" color="text.secondary">
            This action cannot be undone. The guest can only be deleted if they have no existing bookings.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleDeleteGuest}
            variant="contained"
            color="error"
            disabled={formLoading}
          >
            {formLoading ? <CircularProgress size={20} /> : 'Delete Guest'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Booking History Dialog */}
      <Dialog open={bookingsDialogOpen} onClose={() => setBookingsDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Booking History: {viewingGuest?.full_name}</DialogTitle>
        <DialogContent>
          {guestBookings.length === 0 ? (
            <Alert severity="info" sx={{ mt: 2 }}>
              No bookings found for this guest.
            </Alert>
          ) : (
            <TableContainer sx={{ mt: 2 }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Booking #</TableCell>
                    <TableCell>Room</TableCell>
                    <TableCell>Check In</TableCell>
                    <TableCell>Check Out</TableCell>
                    <TableCell>Nights</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell align="right">Amount</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {guestBookings.map((booking) => (
                    <TableRow key={booking.id}>
                      <TableCell>{booking.booking_number}</TableCell>
                      <TableCell>{booking.room_number} ({booking.room_type})</TableCell>
                      <TableCell>{new Date(booking.check_in_date).toLocaleDateString()}</TableCell>
                      <TableCell>{new Date(booking.check_out_date).toLocaleDateString()}</TableCell>
                      <TableCell>{booking.nights}</TableCell>
                      <TableCell>
                        <Chip label={booking.status} size="small" />
                      </TableCell>
                      <TableCell align="right">{formatCurrency(parseFloat(booking.total_amount))}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBookingsDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Credits Dialog */}
      <Dialog open={creditsDialogOpen} onClose={() => setCreditsDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <GiftIcon color="secondary" />
          Free Gift Credits: {viewingGuest?.full_name}
        </DialogTitle>
        <DialogContent>
          {creditsLoading ? (
            <Box display="flex" justifyContent="center" py={3}>
              <CircularProgress />
            </Box>
          ) : guestCredits ? (
            <Box>
              {/* Credits by Room Type */}
              {guestCredits.credits_by_room_type.length > 0 && (
                <Box mb={3}>
                  <Typography variant="subtitle2" color="text.secondary" mb={1}>
                    Credits by Room Type:
                  </Typography>
                  {guestCredits.credits_by_room_type.map((credit) => (
                    <Box
                      key={credit.id}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        backgroundColor: 'success.light',
                        borderRadius: 1,
                        px: 2,
                        py: 1,
                        mb: 1,
                      }}
                    >
                      <Box>
                        <Typography variant="body1" fontWeight={600}>
                          {credit.room_type_name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Code: {credit.room_type_code}
                        </Typography>
                      </Box>
                      <Chip
                        icon={<GiftIcon sx={{ fontSize: 16 }} />}
                        label={`${credit.nights_available} night${credit.nights_available !== 1 ? 's' : ''}`}
                        color="success"
                      />
                    </Box>
                  ))}
                </Box>
              )}

              {/* Legacy Credits */}
              {guestCredits.legacy_total_nights > 0 && (
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    backgroundColor: 'info.light',
                    borderRadius: 1,
                    px: 2,
                    py: 1,
                    mb: 2,
                  }}
                >
                  <Box>
                    <Typography variant="body1" fontWeight={600}>
                      Any Room Type
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Legacy credits (can be used for any room)
                    </Typography>
                  </Box>
                  <Chip
                    label={`${guestCredits.legacy_total_nights} night${guestCredits.legacy_total_nights !== 1 ? 's' : ''}`}
                    color="info"
                  />
                </Box>
              )}

              {/* Total */}
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  borderTop: '2px solid',
                  borderColor: 'divider',
                  pt: 2,
                  mt: 2,
                }}
              >
                <Typography variant="h6" fontWeight={600}>
                  Total Available:
                </Typography>
                <Chip
                  icon={<GiftIcon />}
                  label={`${guestCredits.total_nights + guestCredits.legacy_total_nights} night${(guestCredits.total_nights + guestCredits.legacy_total_nights) !== 1 ? 's' : ''}`}
                  color="secondary"
                  sx={{ fontSize: '1rem', py: 2 }}
                />
              </Box>

              {guestCredits.total_nights === 0 && guestCredits.legacy_total_nights === 0 && (
                <Alert severity="info" sx={{ mt: 2 }}>
                  This guest has no complimentary credits available.
                </Alert>
              )}
            </Box>
          ) : (
            <Alert severity="info">
              No credits information available.
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreditsDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default GuestConfigurationPage;

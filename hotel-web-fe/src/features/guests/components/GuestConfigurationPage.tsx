import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  Pagination,
  Stack,
  Tooltip,
  MenuItem,
  ToggleButton,
  ToggleButtonGroup,
  alpha,
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Save as SaveIcon,
  Cancel as CancelIcon,
  Person as PersonIcon,
  Search as SearchIcon,
  History as HistoryIcon,
  CardGiftcard as GiftIcon,
} from '@mui/icons-material';
import { HotelAPIService } from '../../../api';
import { Guest, GuestCreateRequest, GuestType, GUEST_TYPE_CONFIG, TourismType, TOURISM_TYPE_CONFIG } from '../../../types';
import { useAuth } from '../../../auth/AuthContext';
import { validateEmail } from '../../../utils/validation';
import { useCurrency } from '../../../hooks/useCurrency';
import {
  Star as MemberIcon,
  PersonOutline as NonMemberIcon,
} from '@mui/icons-material';

interface GuestFormData extends GuestCreateRequest {
  id?: number;
}

const PAGE_SIZE = 50;

const GuestConfigurationPage: React.FC = () => {
  const { hasRole, hasPermission } = useAuth();
  const { format: formatCurrency } = useCurrency();
  const hasAccess = hasRole('admin') || hasRole('receptionist') || hasRole('manager') || hasPermission('guests:read') || hasPermission('guests:manage');

  const [guests, setGuests] = useState<Guest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'all' | GuestType>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalGuests, setTotalGuests] = useState(0);
  // Stats counts fetched once on mount, independent of filters
  const [statsTotal, setStatsTotal] = useState(0);
  const [statsMembers, setStatsMembers] = useState(0);

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
    company_name: '',
    guest_type: 'non_member',
    tourism_type: undefined,
    discount_percentage: 0,
  });

  const [editingGuest, setEditingGuest] = useState<Guest | null>(null);
  const [deletingGuest, setDeletingGuest] = useState<Guest | null>(null);
  const [viewingGuest, setViewingGuest] = useState<Guest | null>(null);
  const [guestBookings, setGuestBookings] = useState<any[]>([]);
  const [formLoading, setFormLoading] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  // Snackbar
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');

  const loadGuests = useCallback(async (opts?: { page?: number; search?: string; type?: 'all' | GuestType }) => {
    try {
      setLoading(true);
      const page = opts?.page ?? currentPage;
      const search = opts?.search ?? searchTerm;
      const type = opts?.type ?? filterType;
      const resp = await HotelAPIService.getGuestsPage({
        page,
        page_size: PAGE_SIZE,
        ...(search.trim() ? { search: search.trim() } : {}),
        ...(type !== 'all' ? { guest_type: type } : {}),
      });
      setGuests(resp.data);
      setTotalGuests(resp.total);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [currentPage, searchTerm, filterType]);

  // Fetch global stats once on mount (total + member count, independent of active filters)
  useEffect(() => {
    if (!hasAccess) return;
    Promise.all([
      HotelAPIService.getGuestsPage({ page: 1, page_size: 1 }),
      HotelAPIService.getGuestsPage({ page: 1, page_size: 1, guest_type: 'member' }),
    ]).then(([all, members]) => {
      setStatsTotal(all.total);
      setStatsMembers(members.total);
    }).catch(() => {});
  }, [hasAccess]);

  // Reload on page/filter/search changes; debounce text input
  useEffect(() => {
    if (!hasAccess) return;
    const delay = searchTerm ? 400 : 0;
    const timer = setTimeout(() => loadGuests(), delay);
    return () => clearTimeout(timer);
  }, [currentPage, searchTerm, filterType, hasAccess]);

  const handleFilterTypeChange = (_: React.MouseEvent<HTMLElement>, value: 'all' | GuestType | null) => {
    if (!value) return;
    setFilterType(value);
    setCurrentPage(1);
  };

  const handleSearchChange = (value: string) => {
    setSearchTerm(value);
    setCurrentPage(1);
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
      company_name: '',
      guest_type: 'non_member',
      tourism_type: undefined,
      discount_percentage: 0,
    });
  };

  const handleCreateClick = () => {
    resetForm();
    setCreateDialogOpen(true);
  };

  const handleEditClick = (guest: Guest) => {
    setEditingGuest(guest);
    setDialogError(null);
    const [firstName, ...lastNameParts] = guest.full_name.split(' ');
    setFormData({
      first_name: firstName || '',
      last_name: lastNameParts.join(' ') || '',
      email: guest.email || '',
      phone: guest.phone || '',
      ic_number: guest.ic_number || '',
      nationality: guest.nationality || '',
      address_line1: guest.address_line1 || '',
      city: guest.city || '',
      state_province: guest.state_province || '',
      postal_code: guest.postal_code || '',
      country: guest.country || '',
      company_name: guest.company_name || '',
      guest_type: guest.guest_type || 'non_member',
      tourism_type: guest.tourism_type,
      discount_percentage: guest.discount_percentage || 0,
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
    if (!formData.first_name || !formData.last_name) {
      setError('Please fill in all required fields (First Name and Last Name)');
      return;
    }

    // Validate email format only if provided
    if (formData.email && formData.email.trim()) {
      const emailError = validateEmail(formData.email);
      if (emailError) {
        setError(emailError);
        return;
      }
    }

    try {
      setFormLoading(true);
      // Sanitize form data - convert empty strings to undefined
      const sanitizedData = {
        ...formData,
        email: formData.email?.trim() || undefined,
        phone: formData.phone?.trim() || undefined,
        ic_number: formData.ic_number?.trim() || undefined,
        nationality: formData.nationality?.trim() || undefined,
        address_line1: formData.address_line1?.trim() || undefined,
        city: formData.city?.trim() || undefined,
        state_province: formData.state_province?.trim() || undefined,
        postal_code: formData.postal_code?.trim() || undefined,
        country: formData.country?.trim() || undefined,
        company_name: formData.company_name?.trim() || undefined,
      };
      await HotelAPIService.createGuest(sanitizedData);
      setSnackbarMessage('Guest created successfully');
      setSnackbarOpen(true);
      setCreateDialogOpen(false);
      resetForm();
      await loadGuests();
    } catch (err: any) {
      setError(err.message || 'Failed to create guest');
    } finally {
      setFormLoading(false);
    }
  };

  const handleUpdateGuest = async () => {
    if (!editingGuest) return;

    // Validate required fields
    if (!formData.first_name || !formData.last_name) {
      setDialogError('First name and last name are required');
      return;
    }

    try {
      setFormLoading(true);
      setDialogError(null);
      await HotelAPIService.updateGuest(editingGuest.id, formData);
      setSnackbarMessage('Guest updated successfully');
      setSnackbarOpen(true);
      setEditDialogOpen(false);
      setEditingGuest(null);
      setDialogError(null);
      resetForm();
      await loadGuests();
    } catch (err: any) {
      setDialogError(err.message || 'Failed to update guest');
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
      await loadGuests();
    } catch (err: any) {
      setError(err.message || 'Failed to delete guest');
    } finally {
      setFormLoading(false);
    }
  };

  if (!hasAccess) {
    return (
      <Alert severity="warning">
        You do not have permission to access this page. Contact your administrator for access.
      </Alert>
    );
  }

  const nonMemberStats = statsTotal - statsMembers;

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
          <Typography variant="h5" sx={{ fontWeight: 600, color: '#103931' }}>
            Guest Configuration
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={handleCreateClick}
          sx={{ borderRadius: 2, bgcolor: '#009688', textTransform: 'none', boxShadow: 'none', '&:hover': { bgcolor: '#00796b'} }}
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
      <Grid container spacing={2} sx={{ mb: 4 }}>
        {[
          { title: 'Total Guests', value: statsTotal, color: '#009688', icon: <PersonIcon sx={{ fontSize: 18, color: '#103931' }} /> },
          { title: 'Members', value: statsMembers, color: '#00bcd4', icon: <MemberIcon sx={{ fontSize: 18, color: '#103931' }} /> },
          { title: 'Non-Members', value: nonMemberStats, color: '#4caf50', icon: <NonMemberIcon sx={{ fontSize: 18, color: '#103931' }} /> },
          { title: 'Showing', value: `${totalGuests}${filterType !== 'all' || searchTerm ? ' filtered' : ''}`, color: '#ff9800', icon: <PersonIcon sx={{ fontSize: 18, color: '#103931' }} /> }
        ].map((stat, idx) => (
          <Grid size={{ xs: 6, sm: 4, md: 3 }} key={idx}>
            <Card 
              elevation={0}
              sx={{ 
                borderRadius: 2,
                boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
                border: '1px solid #edf2f0',
              }}
            >
              <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  {stat.icon}
                  <Typography variant="body2" sx={{ fontWeight: 600, color: '#103931' }}>
                    {stat.title}
                  </Typography>
                </Box>
                <Typography variant="h5" sx={{ fontWeight: 600, color: stat.color }}>
                  {stat.value}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* Search Bar and Filter */}
      <Card 
        elevation={0}
        sx={{ 
          mb: 3, 
          borderRadius: 2, 
          border: '1px solid #edf2f0',
          boxShadow: '0 2px 8px rgba(0,0,0,0.04)'
        }}
      >
        <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <TextField
              placeholder="Search by name, email, phone, or IC number..."
              value={searchTerm}
              onChange={(e) => handleSearchChange(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ color: '#103931' }} />
                  </InputAdornment>
                ),
              }}
              sx={{ flex: 1, minWidth: 280 }}
            />
            <ToggleButtonGroup
              value={filterType}
              exclusive
              onChange={handleFilterTypeChange}
              size="small"
            >
              <ToggleButton value="all">
                All
              </ToggleButton>
              <ToggleButton
                value="member"
                sx={{
                  '&.Mui-selected': {
                    backgroundColor: alpha(GUEST_TYPE_CONFIG.member.color, 0.15),
                    color: GUEST_TYPE_CONFIG.member.color,
                    '&:hover': {
                      backgroundColor: alpha(GUEST_TYPE_CONFIG.member.color, 0.25),
                    },
                  },
                }}
              >
                <MemberIcon sx={{ mr: 0.5, fontSize: 18 }} />
                Members
              </ToggleButton>
              <ToggleButton
                value="non_member"
                sx={{
                  '&.Mui-selected': {
                    backgroundColor: alpha(GUEST_TYPE_CONFIG.non_member.color, 0.15),
                    color: GUEST_TYPE_CONFIG.non_member.color,
                    '&:hover': {
                      backgroundColor: alpha(GUEST_TYPE_CONFIG.non_member.color, 0.25),
                    },
                  },
                }}
              >
                <NonMemberIcon sx={{ mr: 0.5, fontSize: 18 }} />
                Non-Members
              </ToggleButton>
            </ToggleButtonGroup>
          </Box>
        </CardContent>
      </Card>

      {/* Guests Table */}
      <Card elevation={0} sx={{ borderRadius: 2, border: '1px solid #edf2f0', boxShadow: '0 2px 8px rgba(0,0,0,0.04)', overflow: 'hidden' }}>
        <TableContainer>
          <Table size="small" sx={{ minWidth: 800 }}>
            <TableHead>
              <TableRow sx={{ bgcolor: '#fbfcfc' }}>
                <TableCell>Name</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Tourism</TableCell>
                <TableCell>Email</TableCell>
                <TableCell>Phone</TableCell>
                <TableCell>IC Number</TableCell>
                <TableCell>Company</TableCell>
                <TableCell>Discount</TableCell>
                <TableCell align="center">Credits</TableCell>
                <TableCell align="center">Bookings</TableCell>
                <TableCell align="center">Edit</TableCell>
                <TableCell align="center">Delete</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={12} align="center" sx={{ py: 6 }}>
                    <CircularProgress size={32} />
                  </TableCell>
                </TableRow>
              ) : guests.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={12} align="center" sx={{ py: 6 }}>
                    <Typography variant="body1" color="text.secondary">
                      {searchTerm || filterType !== 'all'
                        ? 'No guests match the current filters'
                        : 'No guests registered yet'}
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : null}
              {!loading && guests.map((guest) => (
                <TableRow key={guest.id} hover>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {guest.full_name}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {(() => {
                      const guestType = guest.guest_type || 'non_member';
                      const config = GUEST_TYPE_CONFIG[guestType];
                      return (
                        <Chip
                          icon={guestType === 'member' ? <MemberIcon sx={{ fontSize: 16 }} /> : <NonMemberIcon sx={{ fontSize: 16 }} />}
                          label={config.label}
                          size="small"
                          sx={{
                            backgroundColor: alpha(config.color, 0.1),
                            color: config.color,
                            fontWeight: 500,
                            '& .MuiChip-icon': { color: 'inherit' },
                          }}
                        />
                      );
                    })()}
                  </TableCell>
                  <TableCell>
                    {guest.tourism_type ? (
                      <Chip
                        label={TOURISM_TYPE_CONFIG[guest.tourism_type].label}
                        size="small"
                        sx={{
                          backgroundColor: alpha(TOURISM_TYPE_CONFIG[guest.tourism_type].color, 0.1),
                          color: TOURISM_TYPE_CONFIG[guest.tourism_type].color,
                          fontWeight: 500,
                        }}
                      />
                    ) : (
                      <Typography variant="body2" color="text.disabled">-</Typography>
                    )}
                  </TableCell>
                  <TableCell>{guest.email || '-'}</TableCell>
                  <TableCell>{guest.phone || '-'}</TableCell>
                  <TableCell>{guest.ic_number || '-'}</TableCell>
                  <TableCell>{guest.company_name || '-'}</TableCell>
                  <TableCell>
                    {guest.discount_percentage && guest.discount_percentage > 0 ? (
                      <Chip
                        label={`${guest.discount_percentage}% off`}
                        size="small"
                        color="success"
                        variant="outlined"
                      />
                    ) : (
                      <Typography variant="body2" color="text.disabled">-</Typography>
                    )}
                  </TableCell>
                  <TableCell align="center">
                    <Tooltip title="View credits">
                      <IconButton size="small" onClick={() => handleViewCredits(guest)} color="secondary">
                        <GiftIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                  <TableCell align="center">
                    <Tooltip title="View Bookings">
                      <IconButton size="small" onClick={() => handleViewBookings(guest)} color="info">
                        <HistoryIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                  <TableCell align="center">
                    <Tooltip title="Edit">
                      <IconButton size="small" onClick={() => handleEditClick(guest)} color="primary">
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                  <TableCell align="center">
                    <Tooltip title="Delete">
                      <IconButton size="small" onClick={() => handleDeleteClick(guest)} color="error">
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      {/* Pagination */}
      {totalGuests > PAGE_SIZE && (
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 2, px: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Showing {((currentPage - 1) * PAGE_SIZE) + 1}–{Math.min(currentPage * PAGE_SIZE, totalGuests)} of {totalGuests} guests
          </Typography>
          <Pagination
            count={Math.ceil(totalGuests / PAGE_SIZE)}
            page={currentPage}
            onChange={(_, page) => setCurrentPage(page)}
            color="primary"
            size="small"
            showFirstButton
            showLastButton
          />
        </Stack>
      )}

      {/* Create Dialog */}
      <Dialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Create New Guest</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="First Name"
                value={formData.first_name}
                onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                required
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Last Name"
                value={formData.last_name}
                onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                required
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Phone"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="IC Number / Passport"
                value={formData.ic_number}
                onChange={(e) => setFormData({ ...formData, ic_number: e.target.value })}
                helperText="Identity card or passport number"
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Nationality"
                value={formData.nationality}
                onChange={(e) => setFormData({ ...formData, nationality: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Company Name"
                value={formData.company_name}
                onChange={(e) => setFormData({ ...formData, company_name: e.target.value })}
              />
            </Grid>
            <Grid size={12}>
              <TextField
                fullWidth
                label="Address"
                value={formData.address_line1}
                onChange={(e) => setFormData({ ...formData, address_line1: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="City"
                value={formData.city}
                onChange={(e) => setFormData({ ...formData, city: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="State/Province"
                value={formData.state_province}
                onChange={(e) => setFormData({ ...formData, state_province: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Postal Code"
                value={formData.postal_code}
                onChange={(e) => setFormData({ ...formData, postal_code: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Country"
                value={formData.country}
                onChange={(e) => setFormData({ ...formData, country: e.target.value })}
              />
            </Grid>

            {/* Membership Section */}
            <Grid size={12}>
              <Box
                sx={{
                  p: 2,
                  mt: 1,
                  bgcolor: formData.guest_type === 'member' ? alpha(GUEST_TYPE_CONFIG.member.color, 0.1) : 'grey.100',
                  borderRadius: 1,
                  border: 1,
                  borderColor: formData.guest_type === 'member' ? GUEST_TYPE_CONFIG.member.color : 'divider',
                }}
              >
                <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>
                  Membership & Pricing
                </Typography>
                <Grid container spacing={2}>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      select
                      fullWidth
                      label="Guest Type"
                      value={formData.guest_type || 'non_member'}
                      onChange={(e) => setFormData({
                        ...formData,
                        guest_type: e.target.value as GuestType,
                        discount_percentage: e.target.value === 'member' ? (formData.discount_percentage || 10) : 0,
                      })}
                    >
                      <MenuItem value="non_member">
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <NonMemberIcon sx={{ fontSize: 18, color: GUEST_TYPE_CONFIG.non_member.color }} />
                          Non-Member (Standard Rate)
                        </Box>
                      </MenuItem>
                      <MenuItem value="member">
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <MemberIcon sx={{ fontSize: 18, color: GUEST_TYPE_CONFIG.member.color }} />
                          Member (Discounted Rate)
                        </Box>
                      </MenuItem>
                    </TextField>
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      fullWidth
                      label="Discount Percentage"
                      type="number"
                      value={formData.discount_percentage || 0}
                      onChange={(e) => setFormData({ ...formData, discount_percentage: parseInt(e.target.value) || 0 })}
                      disabled={formData.guest_type !== 'member'}
                      InputProps={{
                        endAdornment: <InputAdornment position="end">%</InputAdornment>,
                      }}
                      inputProps={{ min: 0, max: 100 }}
                      helperText={formData.guest_type === 'member' ? 'Discount applied to room rates' : 'Only available for members'}
                    />
                  </Grid>
                </Grid>
              </Box>
            </Grid>

            {/* Tourism Type Section */}
            <Grid size={12}>
              <Box
                sx={{
                  p: 2,
                  bgcolor: formData.tourism_type === 'foreign' ? alpha(TOURISM_TYPE_CONFIG.foreign.color, 0.1) : 'grey.100',
                  borderRadius: 1,
                  border: 1,
                  borderColor: formData.tourism_type === 'foreign' ? TOURISM_TYPE_CONFIG.foreign.color : 'divider',
                }}
              >
                <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>
                  Tourism Classification
                </Typography>
                <Grid container spacing={2}>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      select
                      fullWidth
                      label="Tourism Type"
                      value={formData.tourism_type || ''}
                      onChange={(e) => setFormData({
                        ...formData,
                        tourism_type: e.target.value as TourismType || undefined,
                      })}
                      helperText="Determines if tourism tax is charged"
                    >
                      <MenuItem value="">
                        <em>Not specified</em>
                      </MenuItem>
                      <MenuItem value="local">
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Chip label="Local" size="small" sx={{ bgcolor: TOURISM_TYPE_CONFIG.local.color, color: 'white' }} />
                          <Typography variant="body2" color="text.secondary">{TOURISM_TYPE_CONFIG.local.taxLabel}</Typography>
                        </Box>
                      </MenuItem>
                      <MenuItem value="foreign">
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Chip label="Foreign" size="small" sx={{ bgcolor: TOURISM_TYPE_CONFIG.foreign.color, color: 'white' }} />
                          <Typography variant="body2" color="text.secondary">{TOURISM_TYPE_CONFIG.foreign.taxLabel}</Typography>
                        </Box>
                      </MenuItem>
                    </TextField>
                  </Grid>
                </Grid>
              </Box>
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
      <Dialog open={editDialogOpen} onClose={() => { setEditDialogOpen(false); setDialogError(null); }} maxWidth="md" fullWidth>
        <DialogTitle>Edit Guest: {editingGuest?.full_name}</DialogTitle>
        <DialogContent>
          {dialogError && (
            <Alert severity="error" sx={{ mb: 2, mt: 1 }} onClose={() => setDialogError(null)}>
              {dialogError}
            </Alert>
          )}
          <Grid container spacing={2} sx={{ mt: dialogError ? 0 : 1 }}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="First Name"
                value={formData.first_name}
                onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Last Name"
                value={formData.last_name}
                onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Phone"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="IC Number / Passport"
                value={formData.ic_number}
                onChange={(e) => setFormData({ ...formData, ic_number: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Nationality"
                value={formData.nationality}
                onChange={(e) => setFormData({ ...formData, nationality: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Company Name"
                value={formData.company_name}
                onChange={(e) => setFormData({ ...formData, company_name: e.target.value })}
              />
            </Grid>
            <Grid size={12}>
              <TextField
                fullWidth
                label="Address"
                value={formData.address_line1}
                onChange={(e) => setFormData({ ...formData, address_line1: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="City"
                value={formData.city}
                onChange={(e) => setFormData({ ...formData, city: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="State/Province"
                value={formData.state_province}
                onChange={(e) => setFormData({ ...formData, state_province: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Postal Code"
                value={formData.postal_code}
                onChange={(e) => setFormData({ ...formData, postal_code: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Country"
                value={formData.country}
                onChange={(e) => setFormData({ ...formData, country: e.target.value })}
              />
            </Grid>

            {/* Membership Section */}
            <Grid size={12}>
              <Box
                sx={{
                  p: 2,
                  mt: 1,
                  bgcolor: formData.guest_type === 'member' ? alpha(GUEST_TYPE_CONFIG.member.color, 0.1) : 'grey.100',
                  borderRadius: 1,
                  border: 1,
                  borderColor: formData.guest_type === 'member' ? GUEST_TYPE_CONFIG.member.color : 'divider',
                }}
              >
                <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>
                  Membership & Pricing
                </Typography>
                <Grid container spacing={2}>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      select
                      fullWidth
                      label="Guest Type"
                      value={formData.guest_type || 'non_member'}
                      onChange={(e) => setFormData({
                        ...formData,
                        guest_type: e.target.value as GuestType,
                        discount_percentage: e.target.value === 'member' ? (formData.discount_percentage || 10) : 0,
                      })}
                    >
                      <MenuItem value="non_member">
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <NonMemberIcon sx={{ fontSize: 18, color: GUEST_TYPE_CONFIG.non_member.color }} />
                          Non-Member (Standard Rate)
                        </Box>
                      </MenuItem>
                      <MenuItem value="member">
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <MemberIcon sx={{ fontSize: 18, color: GUEST_TYPE_CONFIG.member.color }} />
                          Member (Discounted Rate)
                        </Box>
                      </MenuItem>
                    </TextField>
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      fullWidth
                      label="Discount Percentage"
                      type="number"
                      value={formData.discount_percentage || 0}
                      onChange={(e) => setFormData({ ...formData, discount_percentage: parseInt(e.target.value) || 0 })}
                      disabled={formData.guest_type !== 'member'}
                      InputProps={{
                        endAdornment: <InputAdornment position="end">%</InputAdornment>,
                      }}
                      inputProps={{ min: 0, max: 100 }}
                      helperText={formData.guest_type === 'member' ? 'Discount applied to room rates' : 'Only available for members'}
                    />
                  </Grid>
                </Grid>
              </Box>
            </Grid>

            {/* Tourism Type Section */}
            <Grid size={12}>
              <Box
                sx={{
                  p: 2,
                  bgcolor: formData.tourism_type === 'foreign' ? alpha(TOURISM_TYPE_CONFIG.foreign.color, 0.1) : 'grey.100',
                  borderRadius: 1,
                  border: 1,
                  borderColor: formData.tourism_type === 'foreign' ? TOURISM_TYPE_CONFIG.foreign.color : 'divider',
                }}
              >
                <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>
                  Tourism Classification
                </Typography>
                <Grid container spacing={2}>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      select
                      fullWidth
                      label="Tourism Type"
                      value={formData.tourism_type || ''}
                      onChange={(e) => setFormData({
                        ...formData,
                        tourism_type: e.target.value as TourismType || undefined,
                      })}
                      helperText="Determines if tourism tax is charged"
                    >
                      <MenuItem value="">
                        <em>Not specified</em>
                      </MenuItem>
                      <MenuItem value="local">
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Chip label="Local" size="small" sx={{ bgcolor: TOURISM_TYPE_CONFIG.local.color, color: 'white' }} />
                          <Typography variant="body2" color="text.secondary">{TOURISM_TYPE_CONFIG.local.taxLabel}</Typography>
                        </Box>
                      </MenuItem>
                      <MenuItem value="foreign">
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Chip label="Foreign" size="small" sx={{ bgcolor: TOURISM_TYPE_CONFIG.foreign.color, color: 'white' }} />
                          <Typography variant="body2" color="text.secondary">{TOURISM_TYPE_CONFIG.foreign.taxLabel}</Typography>
                        </Box>
                      </MenuItem>
                    </TextField>
                  </Grid>
                </Grid>
              </Box>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setEditDialogOpen(false); setDialogError(null); }} startIcon={<CancelIcon />}>
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
            This action cannot be undone. All bookings associated with this guest will also be deleted. The guest cannot be deleted if they are currently checked in.
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
                  label={`${guestCredits.total_nights} night${guestCredits.total_nights !== 1 ? 's' : ''}`}
                  color="secondary"
                  sx={{ fontSize: '1rem', py: 2 }}
                />
              </Box>

              {guestCredits.total_nights === 0 && (
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

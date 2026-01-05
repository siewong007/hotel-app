import React, { useState, useEffect, useMemo } from 'react';
import {
  Box,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  Button,
  IconButton,
  Chip,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  Snackbar,
  Card,
  CardContent,
  Grid,
  Tabs,
  Tab,
  CircularProgress,
  Tooltip,
  InputAdornment,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  CardGiftcard as GiftIcon,
  Search as SearchIcon,
  Person as PersonIcon,
  Hotel as HotelIcon,
  AttachMoney as MoneyIcon,
  NightsStay as NightsIcon,
  Add as AddIcon,
} from '@mui/icons-material';
import { Autocomplete, FormControl, InputLabel, Select, MenuItem } from '@mui/material';
import { HotelAPIService } from '../../../api';
import { BookingWithDetails } from '../../../types';
import { useCurrency } from '../../../hooks/useCurrency';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;
  return (
    <div role="tabpanel" hidden={value !== index} {...other}>
      {value === index && <Box sx={{ pt: 2 }}>{children}</Box>}
    </div>
  );
}

interface GuestCredit {
  guest_id: number;
  guest_name: string;
  email: string | null;
  room_type_id: number;
  room_type_name: string;
  room_type_code: string | null;
  nights_available: number;
  notes: string | null;
}

interface ComplimentarySummary {
  total_complimentary_bookings: number;
  total_complimentary_nights: number;
  total_credits_available: number;
  value_of_complimentary_nights: string;
}

type SortField = 'created_at' | 'guest_name' | 'room_number' | 'complimentary_nights' | 'status';
type SortOrder = 'asc' | 'desc';

export default function ComplimentaryManagementPage() {
  const { format: formatCurrency } = useCurrency();

  // Data state
  const [bookings, setBookings] = useState<BookingWithDetails[]>([]);
  const [guestCredits, setGuestCredits] = useState<GuestCredit[]>([]);
  const [summary, setSummary] = useState<ComplimentarySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // UI state
  const [tabValue, setTabValue] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  // Dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState<BookingWithDetails | null>(null);
  const [editFormData, setEditFormData] = useState({
    complimentary_start_date: '',
    complimentary_end_date: '',
    complimentary_reason: '',
  });
  const [processing, setProcessing] = useState(false);

  // Snackbar state
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' as 'success' | 'error' });

  // Credit CRUD dialog state
  const [addCreditDialogOpen, setAddCreditDialogOpen] = useState(false);
  const [editCreditDialogOpen, setEditCreditDialogOpen] = useState(false);
  const [deleteCreditDialogOpen, setDeleteCreditDialogOpen] = useState(false);
  const [selectedCredit, setSelectedCredit] = useState<GuestCredit | null>(null);
  const [guests, setGuests] = useState<Array<{ id: number; full_name: string; email?: string }>>([]);
  const [roomTypes, setRoomTypes] = useState<Array<{ id: number; name: string; code?: string }>>([]);
  const [creditFormData, setCreditFormData] = useState({
    guest_id: 0,
    room_type_id: 0,
    nights: 1,
    notes: '',
  });
  const [editCreditFormData, setEditCreditFormData] = useState({
    nights_available: 0,
    notes: '',
  });

  // Load data
  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [bookingsData, creditsData, summaryData, guestsData, roomTypesData] = await Promise.all([
        HotelAPIService.getComplimentaryBookings(),
        HotelAPIService.getGuestsWithCredits(),
        HotelAPIService.getComplimentarySummary(),
        HotelAPIService.getAllGuests(),
        HotelAPIService.getRoomTypes(),
      ]);
      setBookings(bookingsData || []);
      setGuestCredits(creditsData?.credits || []);
      setSummary(summaryData);
      setGuests(guestsData || []);
      setRoomTypes(roomTypesData || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Credit CRUD handlers
  const handleAddCreditClick = () => {
    setCreditFormData({ guest_id: 0, room_type_id: 0, nights: 1, notes: '' });
    setAddCreditDialogOpen(true);
  };

  const handleEditCreditClick = (credit: GuestCredit) => {
    setSelectedCredit(credit);
    setEditCreditFormData({
      nights_available: credit.nights_available,
      notes: credit.notes || '',
    });
    setEditCreditDialogOpen(true);
  };

  const handleDeleteCreditClick = (credit: GuestCredit) => {
    setSelectedCredit(credit);
    setDeleteCreditDialogOpen(true);
  };

  const handleAddCredit = async () => {
    if (!creditFormData.guest_id || !creditFormData.room_type_id || creditFormData.nights <= 0) {
      setSnackbar({ open: true, message: 'Please fill in all required fields', severity: 'error' });
      return;
    }
    try {
      setProcessing(true);
      await HotelAPIService.addGuestCredits({
        guest_id: creditFormData.guest_id,
        room_type_id: creditFormData.room_type_id,
        nights: creditFormData.nights,
        notes: creditFormData.notes || undefined,
      });
      setSnackbar({ open: true, message: 'Credits added successfully', severity: 'success' });
      setAddCreditDialogOpen(false);
      await loadData();
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || 'Failed to add credits', severity: 'error' });
    } finally {
      setProcessing(false);
    }
  };

  const handleUpdateCredit = async () => {
    if (!selectedCredit) return;
    try {
      setProcessing(true);
      await HotelAPIService.updateGuestCredits(
        selectedCredit.guest_id,
        selectedCredit.room_type_id,
        {
          nights_available: editCreditFormData.nights_available,
          notes: editCreditFormData.notes || undefined,
        }
      );
      setSnackbar({ open: true, message: 'Credits updated successfully', severity: 'success' });
      setEditCreditDialogOpen(false);
      await loadData();
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || 'Failed to update credits', severity: 'error' });
    } finally {
      setProcessing(false);
    }
  };

  const handleDeleteCredit = async () => {
    if (!selectedCredit) return;
    try {
      setProcessing(true);
      await HotelAPIService.deleteGuestCredits(selectedCredit.guest_id, selectedCredit.room_type_id);
      setSnackbar({ open: true, message: 'Credits deleted successfully', severity: 'success' });
      setDeleteCreditDialogOpen(false);
      await loadData();
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || 'Failed to delete credits', severity: 'error' });
    } finally {
      setProcessing(false);
    }
  };

  // Filtered and sorted bookings
  const filteredBookings = useMemo(() => {
    let filtered = [...(bookings || [])];

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (b) =>
          b.guest_name?.toLowerCase().includes(query) ||
          b.booking_number?.toLowerCase().includes(query) ||
          b.room_number?.toLowerCase().includes(query)
      );
    }

    filtered.sort((a, b) => {
      let aVal: any, bVal: any;
      switch (sortField) {
        case 'guest_name':
          aVal = a.guest_name || '';
          bVal = b.guest_name || '';
          break;
        case 'room_number':
          aVal = a.room_number || '';
          bVal = b.room_number || '';
          break;
        case 'complimentary_nights':
          aVal = a.complimentary_nights || 0;
          bVal = b.complimentary_nights || 0;
          break;
        case 'status':
          aVal = a.status || '';
          bVal = b.status || '';
          break;
        default:
          aVal = new Date(a.created_at || 0).getTime();
          bVal = new Date(b.created_at || 0).getTime();
      }
      if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

    return filtered;
  }, [bookings, searchQuery, sortField, sortOrder]);

  // Handlers
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const handleEditClick = (booking: BookingWithDetails) => {
    setSelectedBooking(booking);
    setEditFormData({
      complimentary_start_date: booking.complimentary_start_date || '',
      complimentary_end_date: booking.complimentary_end_date || '',
      complimentary_reason: booking.complimentary_reason || '',
    });
    setEditDialogOpen(true);
  };

  const handleDeleteClick = (booking: BookingWithDetails) => {
    setSelectedBooking(booking);
    setDeleteDialogOpen(true);
  };

  const handleUpdateComplimentary = async () => {
    if (!selectedBooking) return;
    try {
      setProcessing(true);
      await HotelAPIService.updateComplimentary(selectedBooking.id.toString(), editFormData);
      setSnackbar({ open: true, message: 'Complimentary booking updated successfully', severity: 'success' });
      setEditDialogOpen(false);
      await loadData();
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || 'Failed to update', severity: 'error' });
    } finally {
      setProcessing(false);
    }
  };

  const handleRemoveComplimentary = async () => {
    if (!selectedBooking) return;
    try {
      setProcessing(true);
      await HotelAPIService.removeComplimentary(selectedBooking.id.toString());
      setSnackbar({ open: true, message: 'Complimentary status removed successfully', severity: 'success' });
      setDeleteDialogOpen(false);
      await loadData();
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || 'Failed to remove', severity: 'error' });
    } finally {
      setProcessing(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'fully_complimentary':
        return 'success';
      case 'partial_complimentary':
        return 'warning';
      case 'comp_cancelled':
        return 'info';
      default:
        return 'default';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'fully_complimentary':
        return 'Fully Complimentary';
      case 'partial_complimentary':
        return 'Partial';
      case 'comp_cancelled':
        return 'Comp Cancelled';
      default:
        return status;
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" sx={{ fontWeight: 700, display: 'flex', alignItems: 'center' }}>
          <GiftIcon sx={{ mr: 1, fontSize: 32 }} />
          Complimentary Management
        </Typography>
        <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadData}>
          Refresh
        </Button>
      </Box>

      {/* Error Alert */}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Summary Cards */}
      {summary && (
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid item xs={12} sm={6} md={3}>
            <Card>
              <CardContent>
                <Box display="flex" alignItems="center" mb={1}>
                  <HotelIcon color="primary" sx={{ mr: 1 }} />
                  <Typography variant="subtitle2" color="text.secondary">
                    Complimentary Bookings
                  </Typography>
                </Box>
                <Typography variant="h4" color="primary">
                  {summary.total_complimentary_bookings}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Card>
              <CardContent>
                <Box display="flex" alignItems="center" mb={1}>
                  <NightsIcon color="secondary" sx={{ mr: 1 }} />
                  <Typography variant="subtitle2" color="text.secondary">
                    Total Nights Given
                  </Typography>
                </Box>
                <Typography variant="h4" color="secondary">
                  {summary.total_complimentary_nights}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Card>
              <CardContent>
                <Box display="flex" alignItems="center" mb={1}>
                  <PersonIcon color="info" sx={{ mr: 1 }} />
                  <Typography variant="subtitle2" color="text.secondary">
                    Credits Available
                  </Typography>
                </Box>
                <Typography variant="h4" color="info.main">
                  {summary.total_credits_available}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  (room-type specific credits)
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Card>
              <CardContent>
                <Box display="flex" alignItems="center" mb={1}>
                  <MoneyIcon color="success" sx={{ mr: 1 }} />
                  <Typography variant="subtitle2" color="text.secondary">
                    Value Given
                  </Typography>
                </Box>
                <Typography variant="h4" color="success.main">
                  {formatCurrency(parseFloat(summary.value_of_complimentary_nights) || 0)}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {/* Tabs */}
      <Paper sx={{ mb: 2 }}>
        <Tabs value={tabValue} onChange={(_, newValue) => setTabValue(newValue)}>
          <Tab label={`Complimentary Bookings (${bookings?.length || 0})`} />
          <Tab
            label={`Guest Credits (${guestCredits?.length || 0})`}
          />
        </Tabs>
      </Paper>

      {/* Tab Panels */}
      <TabPanel value={tabValue} index={0}>
        {/* Search */}
        <TextField
          fullWidth
          variant="outlined"
          placeholder="Search by guest, booking number, or room..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          sx={{ mb: 2 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon />
              </InputAdornment>
            ),
          }}
        />

        {/* Bookings Table */}
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow sx={{ backgroundColor: '#f5f5f5' }}>
                <TableCell>
                  <TableSortLabel
                    active={sortField === 'created_at'}
                    direction={sortField === 'created_at' ? sortOrder : 'asc'}
                    onClick={() => handleSort('created_at')}
                  >
                    <strong>Booking #</strong>
                  </TableSortLabel>
                </TableCell>
                <TableCell>
                  <TableSortLabel
                    active={sortField === 'guest_name'}
                    direction={sortField === 'guest_name' ? sortOrder : 'asc'}
                    onClick={() => handleSort('guest_name')}
                  >
                    <strong>Guest</strong>
                  </TableSortLabel>
                </TableCell>
                <TableCell>
                  <TableSortLabel
                    active={sortField === 'room_number'}
                    direction={sortField === 'room_number' ? sortOrder : 'asc'}
                    onClick={() => handleSort('room_number')}
                  >
                    <strong>Room</strong>
                  </TableSortLabel>
                </TableCell>
                <TableCell><strong>Dates</strong></TableCell>
                <TableCell>
                  <TableSortLabel
                    active={sortField === 'complimentary_nights'}
                    direction={sortField === 'complimentary_nights' ? sortOrder : 'asc'}
                    onClick={() => handleSort('complimentary_nights')}
                  >
                    <strong>Comp. Nights</strong>
                  </TableSortLabel>
                </TableCell>
                <TableCell><strong>Reason</strong></TableCell>
                <TableCell>
                  <TableSortLabel
                    active={sortField === 'status'}
                    direction={sortField === 'status' ? sortOrder : 'asc'}
                    onClick={() => handleSort('status')}
                  >
                    <strong>Status</strong>
                  </TableSortLabel>
                </TableCell>
                <TableCell><strong>Actions</strong></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredBookings.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} align="center">
                    <Typography color="text.secondary" py={4}>
                      No complimentary bookings found
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                filteredBookings.map((booking) => (
                  <TableRow key={booking.id} hover>
                    <TableCell>{booking.booking_number}</TableCell>
                    <TableCell>
                      <Typography variant="body2">{booking.guest_name}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {booking.guest_email}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{booking.room_number}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {booking.room_type}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {new Date(booking.check_in_date).toLocaleDateString()} -{' '}
                        {new Date(booking.check_out_date).toLocaleDateString()}
                      </Typography>
                      {booking.complimentary_start_date && booking.complimentary_end_date && (
                        <Typography variant="caption" color="success.main">
                          Comp: {new Date(booking.complimentary_start_date).toLocaleDateString()} -{' '}
                          {new Date(booking.complimentary_end_date).toLocaleDateString()}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={`${booking.complimentary_nights || 0} nights`}
                        size="small"
                        color="success"
                      />
                    </TableCell>
                    <TableCell>
                      <Tooltip title={booking.complimentary_reason || 'No reason provided'}>
                        <Typography
                          variant="body2"
                          sx={{
                            maxWidth: 150,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {booking.complimentary_reason || '-'}
                        </Typography>
                      </Tooltip>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={getStatusLabel(booking.status as string)}
                        size="small"
                        color={getStatusColor(booking.status as string) as any}
                      />
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', gap: 0.5 }}>
                        <Tooltip title="Edit complimentary details">
                          <IconButton
                            size="small"
                            color="primary"
                            onClick={() => handleEditClick(booking)}
                          >
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Remove complimentary status">
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => handleDeleteClick(booking)}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </TabPanel>

      <TabPanel value={tabValue} index={1}>
        {/* Guest Credits */}
        <Paper sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6">
              Guest Complimentary Credits by Room Type
            </Typography>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={handleAddCreditClick}
              color="secondary"
            >
              Add Credits
            </Button>
          </Box>
          {(!guestCredits || guestCredits.length === 0) ? (
            <Typography color="text.secondary">No guests with complimentary credits</Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell><strong>Guest</strong></TableCell>
                  <TableCell><strong>Room Type</strong></TableCell>
                  <TableCell><strong>Notes</strong></TableCell>
                  <TableCell align="center"><strong>Credits</strong></TableCell>
                  <TableCell align="right"><strong>Actions</strong></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(guestCredits || []).map((credit, idx) => (
                  <TableRow key={`${credit.guest_id}-${credit.room_type_id}-${idx}`}>
                    <TableCell>
                      <Typography variant="body2">{credit.guest_name}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {credit.email}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={credit.room_type_code || credit.room_type_name}
                        size="small"
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">
                        {credit.notes || '-'}
                      </Typography>
                    </TableCell>
                    <TableCell align="center">
                      <Chip
                        label={`${credit.nights_available} nights`}
                        size="small"
                        color="success"
                      />
                    </TableCell>
                    <TableCell align="right">
                      <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'flex-end' }}>
                        <Tooltip title="Edit credits">
                          <IconButton
                            size="small"
                            color="primary"
                            onClick={() => handleEditCreditClick(credit)}
                          >
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Delete credits">
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => handleDeleteCreditClick(credit)}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Paper>
      </TabPanel>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onClose={() => setEditDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Edit Complimentary Booking</DialogTitle>
        <DialogContent>
          {selectedBooking && (
            <Box sx={{ pt: 1 }}>
              <Alert severity="info" sx={{ mb: 2 }}>
                Booking: {selectedBooking.booking_number} - {selectedBooking.guest_name}
              </Alert>
              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <TextField
                    fullWidth
                    label="Complimentary Start Date"
                    type="date"
                    value={editFormData.complimentary_start_date}
                    onChange={(e) =>
                      setEditFormData({ ...editFormData, complimentary_start_date: e.target.value })
                    }
                    InputLabelProps={{ shrink: true }}
                    inputProps={{
                      min: selectedBooking.check_in_date,
                      max: selectedBooking.check_out_date,
                    }}
                  />
                </Grid>
                <Grid item xs={6}>
                  <TextField
                    fullWidth
                    label="Complimentary End Date"
                    type="date"
                    value={editFormData.complimentary_end_date}
                    onChange={(e) =>
                      setEditFormData({ ...editFormData, complimentary_end_date: e.target.value })
                    }
                    InputLabelProps={{ shrink: true }}
                    inputProps={{
                      min: selectedBooking.check_in_date,
                      max: selectedBooking.check_out_date,
                    }}
                  />
                </Grid>
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    label="Reason"
                    multiline
                    rows={2}
                    value={editFormData.complimentary_reason}
                    onChange={(e) =>
                      setEditFormData({ ...editFormData, complimentary_reason: e.target.value })
                    }
                  />
                </Grid>
              </Grid>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleUpdateComplimentary} variant="contained" disabled={processing}>
            {processing ? 'Updating...' : 'Update'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Remove Complimentary Status</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            Are you sure you want to remove the complimentary status from this booking? The original
            amount will be restored.
          </Alert>
          {selectedBooking && (
            <Box>
              <Typography variant="body2">
                <strong>Booking:</strong> {selectedBooking.booking_number}
              </Typography>
              <Typography variant="body2">
                <strong>Guest:</strong> {selectedBooking.guest_name}
              </Typography>
              <Typography variant="body2">
                <strong>Complimentary Nights:</strong> {selectedBooking.complimentary_nights}
              </Typography>
              {selectedBooking.original_total_amount && (
                <Typography variant="body2">
                  <strong>Original Amount:</strong>{' '}
                  {formatCurrency(parseFloat(selectedBooking.original_total_amount as string))}
                </Typography>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleRemoveComplimentary} variant="contained" color="error" disabled={processing}>
            {processing ? 'Removing...' : 'Remove Complimentary'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add Credit Dialog */}
      <Dialog open={addCreditDialogOpen} onClose={() => setAddCreditDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Complimentary Credits</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 1 }}>
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <Autocomplete
                  options={guests}
                  getOptionLabel={(option) => `${option.full_name}${option.email ? ` (${option.email})` : ''}`}
                  value={guests.find(g => g.id === creditFormData.guest_id) || null}
                  onChange={(_, newValue) => setCreditFormData({ ...creditFormData, guest_id: newValue?.id || 0 })}
                  renderInput={(params) => <TextField {...params} label="Select Guest *" />}
                />
              </Grid>
              <Grid item xs={12}>
                <FormControl fullWidth>
                  <InputLabel>Room Type *</InputLabel>
                  <Select
                    value={creditFormData.room_type_id || ''}
                    label="Room Type *"
                    onChange={(e) => setCreditFormData({ ...creditFormData, room_type_id: Number(e.target.value) })}
                  >
                    {roomTypes.map((rt) => (
                      <MenuItem key={rt.id} value={rt.id}>
                        {rt.name} {rt.code ? `(${rt.code})` : ''}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Number of Nights *"
                  type="number"
                  value={creditFormData.nights}
                  onChange={(e) => setCreditFormData({ ...creditFormData, nights: parseInt(e.target.value) || 0 })}
                  inputProps={{ min: 1 }}
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Notes"
                  multiline
                  rows={2}
                  value={creditFormData.notes}
                  onChange={(e) => setCreditFormData({ ...creditFormData, notes: e.target.value })}
                  placeholder="e.g., Loyalty reward, Compensation, etc."
                />
              </Grid>
            </Grid>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddCreditDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleAddCredit} variant="contained" color="secondary" disabled={processing}>
            {processing ? 'Adding...' : 'Add Credits'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit Credit Dialog */}
      <Dialog open={editCreditDialogOpen} onClose={() => setEditCreditDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Edit Complimentary Credits</DialogTitle>
        <DialogContent>
          {selectedCredit && (
            <Box sx={{ pt: 1 }}>
              <Alert severity="info" sx={{ mb: 2 }}>
                <Typography variant="body2">
                  <strong>Guest:</strong> {selectedCredit.guest_name}
                </Typography>
                <Typography variant="body2">
                  <strong>Room Type:</strong> {selectedCredit.room_type_name}
                </Typography>
              </Alert>
              <Grid container spacing={2}>
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    label="Nights Available *"
                    type="number"
                    value={editCreditFormData.nights_available}
                    onChange={(e) => setEditCreditFormData({ ...editCreditFormData, nights_available: parseInt(e.target.value) || 0 })}
                    inputProps={{ min: 0 }}
                  />
                </Grid>
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    label="Notes"
                    multiline
                    rows={2}
                    value={editCreditFormData.notes}
                    onChange={(e) => setEditCreditFormData({ ...editCreditFormData, notes: e.target.value })}
                  />
                </Grid>
              </Grid>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditCreditDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleUpdateCredit} variant="contained" disabled={processing}>
            {processing ? 'Updating...' : 'Update Credits'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Credit Confirmation Dialog */}
      <Dialog open={deleteCreditDialogOpen} onClose={() => setDeleteCreditDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Delete Complimentary Credits</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            Are you sure you want to delete these complimentary credits? This action cannot be undone.
          </Alert>
          {selectedCredit && (
            <Box>
              <Typography variant="body2">
                <strong>Guest:</strong> {selectedCredit.guest_name}
              </Typography>
              <Typography variant="body2">
                <strong>Room Type:</strong> {selectedCredit.room_type_name}
              </Typography>
              <Typography variant="body2">
                <strong>Nights to Delete:</strong> {selectedCredit.nights_available}
              </Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteCreditDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleDeleteCredit} variant="contained" color="error" disabled={processing}>
            {processing ? 'Deleting...' : 'Delete Credits'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
      >
        <Alert severity={snackbar.severity} onClose={() => setSnackbar({ ...snackbar, open: false })}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}

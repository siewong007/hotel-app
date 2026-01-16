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
  Paper,
  IconButton,
  Chip,
  MenuItem,
  Switch,
  FormControlLabel,
  Grid,
  Card,
  CardContent,
  Tooltip,
  InputAdornment,
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Hotel as HotelIcon,
  KingBed as BedIcon,
  AttachMoney as MoneyIcon,
  CheckCircle as ActiveIcon,
  Cancel as InactiveIcon,
} from '@mui/icons-material';
import { HotelAPIService } from '../../../api';
import { RoomType, RoomTypeCreateInput, RoomTypeUpdateInput } from '../../../types';
import { useAuth } from '../../../auth/AuthContext';
import { useCurrency } from '../../../hooks/useCurrency';
import { toNumber } from '../../../utils/currency';

const BED_TYPES = [
  'Single',
  'Twin',
  'Double',
  'Queen',
  'King',
  'Super King',
  'Bunk',
];

interface RoomTypeFormData {
  name: string;
  code: string;
  description: string;
  base_price: number | '';
  weekday_rate: number | '';
  weekend_rate: number | '';
  max_occupancy: number;
  bed_type: string;
  bed_count: number;
  allows_extra_bed: boolean;
  max_extra_beds: number;
  extra_bed_charge: number | '';
  sort_order: number;
  is_active: boolean;
}

const initialFormData: RoomTypeFormData = {
  name: '',
  code: '',
  description: '',
  base_price: '',
  weekday_rate: '',
  weekend_rate: '',
  max_occupancy: 2,
  bed_type: 'Queen',
  bed_count: 1,
  allows_extra_bed: false,
  max_extra_beds: 0,
  extra_bed_charge: '',
  sort_order: 0,
  is_active: true,
};

const RoomTypeConfigurationPage: React.FC = () => {
  const { hasRole, hasPermission } = useAuth();
  const { format: formatCurrency, symbol: currencySymbol } = useCurrency();
  const hasAccess = hasRole('admin') || hasRole('manager') || hasPermission('rooms:read') || hasPermission('rooms:manage');
  const canEdit = hasRole('admin') || hasRole('manager') || hasPermission('rooms:write') || hasPermission('rooms:manage');

  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const [formData, setFormData] = useState<RoomTypeFormData>(initialFormData);
  const [editingRoomType, setEditingRoomType] = useState<RoomType | null>(null);
  const [deletingRoomType, setDeletingRoomType] = useState<RoomType | null>(null);
  const [formLoading, setFormLoading] = useState(false);

  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');
  const [snackbarSeverity, setSnackbarSeverity] = useState<'success' | 'error'>('success');

  useEffect(() => {
    if (hasAccess) {
      loadData();
    }
  }, [hasAccess]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await HotelAPIService.getAllRoomTypes();
      setRoomTypes(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load room types');
    } finally {
      setLoading(false);
    }
  };

  const showSnackbar = (message: string, severity: 'success' | 'error' = 'success') => {
    setSnackbarMessage(message);
    setSnackbarSeverity(severity);
    setSnackbarOpen(true);
  };

  const handleCreateOpen = () => {
    setFormData(initialFormData);
    setCreateDialogOpen(true);
  };

  const handleEditOpen = (roomType: RoomType) => {
    setEditingRoomType(roomType);
    setFormData({
      name: roomType.name,
      code: roomType.code,
      description: roomType.description || '',
      base_price: toNumber(roomType.base_price),
      weekday_rate: roomType.weekday_rate ? toNumber(roomType.weekday_rate) : '',
      weekend_rate: roomType.weekend_rate ? toNumber(roomType.weekend_rate) : '',
      max_occupancy: roomType.max_occupancy,
      bed_type: roomType.bed_type || 'Queen',
      bed_count: roomType.bed_count || 1,
      allows_extra_bed: roomType.allows_extra_bed,
      max_extra_beds: roomType.max_extra_beds,
      extra_bed_charge: toNumber(roomType.extra_bed_charge),
      sort_order: roomType.sort_order,
      is_active: roomType.is_active,
    });
    setEditDialogOpen(true);
  };

  const handleDeleteOpen = (roomType: RoomType) => {
    setDeletingRoomType(roomType);
    setDeleteDialogOpen(true);
  };

  const handleCreate = async () => {
    try {
      setFormLoading(true);
      const input: RoomTypeCreateInput = {
        name: formData.name,
        code: formData.code.toUpperCase(),
        description: formData.description || undefined,
        base_price: Number(formData.base_price),
        weekday_rate: formData.weekday_rate ? Number(formData.weekday_rate) : undefined,
        weekend_rate: formData.weekend_rate ? Number(formData.weekend_rate) : undefined,
        max_occupancy: formData.max_occupancy,
        bed_type: formData.bed_type,
        bed_count: formData.bed_count,
        allows_extra_bed: formData.allows_extra_bed,
        max_extra_beds: formData.allows_extra_bed ? formData.max_extra_beds : 0,
        extra_bed_charge: formData.allows_extra_bed && formData.extra_bed_charge ? Number(formData.extra_bed_charge) : 0,
        sort_order: formData.sort_order,
      };
      await HotelAPIService.createRoomType(input);
      setCreateDialogOpen(false);
      showSnackbar('Room type created successfully');
      loadData();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      // Handle duplicate key constraint errors with user-friendly messages
      if (errorMessage.includes('duplicate key') || errorMessage.includes('unique constraint')) {
        if (errorMessage.includes('room_types_name_key')) {
          showSnackbar(`A room type with the name "${formData.name}" already exists. Please use a different name.`, 'error');
        } else if (errorMessage.includes('room_types_code_key')) {
          showSnackbar(`A room type with the code "${formData.code.toUpperCase()}" already exists. Please use a different code.`, 'error');
        } else {
          showSnackbar('A room type with this name or code already exists. Please use different values.', 'error');
        }
      } else {
        showSnackbar(errorMessage || 'Failed to create room type', 'error');
      }
    } finally {
      setFormLoading(false);
    }
  };

  const handleUpdate = async () => {
    if (!editingRoomType) return;
    try {
      setFormLoading(true);
      const input: RoomTypeUpdateInput = {
        name: formData.name,
        code: formData.code.toUpperCase(),
        description: formData.description || undefined,
        base_price: Number(formData.base_price),
        weekday_rate: formData.weekday_rate ? Number(formData.weekday_rate) : undefined,
        weekend_rate: formData.weekend_rate ? Number(formData.weekend_rate) : undefined,
        max_occupancy: formData.max_occupancy,
        bed_type: formData.bed_type,
        bed_count: formData.bed_count,
        allows_extra_bed: formData.allows_extra_bed,
        max_extra_beds: formData.allows_extra_bed ? formData.max_extra_beds : 0,
        extra_bed_charge: formData.allows_extra_bed && formData.extra_bed_charge ? Number(formData.extra_bed_charge) : 0,
        is_active: formData.is_active,
        sort_order: formData.sort_order,
      };
      await HotelAPIService.updateRoomType(editingRoomType.id, input);
      setEditDialogOpen(false);
      setEditingRoomType(null);
      showSnackbar('Room type updated successfully');
      loadData();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      // Handle duplicate key constraint errors with user-friendly messages
      if (errorMessage.includes('duplicate key') || errorMessage.includes('unique constraint')) {
        if (errorMessage.includes('room_types_name_key')) {
          showSnackbar(`A room type with the name "${formData.name}" already exists. Please use a different name.`, 'error');
        } else if (errorMessage.includes('room_types_code_key')) {
          showSnackbar(`A room type with the code "${formData.code.toUpperCase()}" already exists. Please use a different code.`, 'error');
        } else {
          showSnackbar('A room type with this name or code already exists. Please use different values.', 'error');
        }
      } else {
        showSnackbar(errorMessage || 'Failed to update room type', 'error');
      }
    } finally {
      setFormLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingRoomType) return;
    try {
      setFormLoading(true);
      await HotelAPIService.deleteRoomType(deletingRoomType.id);
      setDeleteDialogOpen(false);
      setDeletingRoomType(null);
      showSnackbar('Room type deleted successfully');
      loadData();
    } catch (err) {
      showSnackbar(err instanceof Error ? err.message : 'Failed to delete room type', 'error');
    } finally {
      setFormLoading(false);
    }
  };

  const handleToggleActive = async (roomType: RoomType) => {
    try {
      await HotelAPIService.updateRoomType(roomType.id, { is_active: !roomType.is_active });
      showSnackbar(`Room type ${roomType.is_active ? 'deactivated' : 'activated'} successfully`);
      loadData();
    } catch (err) {
      showSnackbar(err instanceof Error ? err.message : 'Failed to update room type', 'error');
    }
  };

  if (!hasAccess) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">You do not have permission to access this page.</Alert>
      </Box>
    );
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }

  const activeCount = roomTypes.filter(rt => rt.is_active).length;
  const withExtraBedCount = roomTypes.filter(rt => rt.allows_extra_bed).length;

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" component="h1">
          <HotelIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
          Room Type Configuration
        </Typography>
        {canEdit && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={handleCreateOpen}>
            Add Room Type
          </Button>
        )}
      </Box>

      {/* Summary Cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={4}>
          <Card>
            <CardContent>
              <Typography color="text.secondary" gutterBottom>Total Room Types</Typography>
              <Typography variant="h4">{roomTypes.length}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Card>
            <CardContent>
              <Typography color="text.secondary" gutterBottom>Active Types</Typography>
              <Typography variant="h4" color="success.main">{activeCount}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Card>
            <CardContent>
              <Typography color="text.secondary" gutterBottom>With Extra Bed Option</Typography>
              <Typography variant="h4" color="info.main">{withExtraBedCount}</Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Room Types Table */}
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Code</TableCell>
              <TableCell align="right">Base Price</TableCell>
              <TableCell align="center">Max Occupancy</TableCell>
              <TableCell align="center">Bed Config</TableCell>
              <TableCell align="center">Extra Bed</TableCell>
              <TableCell align="center">Status</TableCell>
              {canEdit && <TableCell align="center">Actions</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {roomTypes.map((roomType) => (
              <TableRow key={roomType.id} sx={{ opacity: roomType.is_active ? 1 : 0.6 }}>
                <TableCell>
                  <Typography fontWeight="medium">{roomType.name}</Typography>
                  {roomType.description && (
                    <Typography variant="caption" color="text.secondary" display="block">
                      {roomType.description}
                    </Typography>
                  )}
                </TableCell>
                <TableCell>
                  <Chip label={roomType.code} size="small" variant="outlined" />
                </TableCell>
                <TableCell align="right">
                  <Typography fontWeight="medium">
                    {formatCurrency(toNumber(roomType.base_price))}
                  </Typography>
                  {(roomType.weekday_rate || roomType.weekend_rate) && (
                    <Typography variant="caption" color="text.secondary" display="block">
                      {roomType.weekday_rate && `Weekday: ${formatCurrency(toNumber(roomType.weekday_rate))}`}
                      {roomType.weekday_rate && roomType.weekend_rate && ' | '}
                      {roomType.weekend_rate && `Weekend: ${formatCurrency(toNumber(roomType.weekend_rate))}`}
                    </Typography>
                  )}
                </TableCell>
                <TableCell align="center">
                  <Chip label={roomType.max_occupancy} size="small" color="primary" />
                </TableCell>
                <TableCell align="center">
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                    <BedIcon fontSize="small" />
                    <Typography variant="body2">
                      {roomType.bed_count || 1}x {roomType.bed_type || 'Queen'}
                    </Typography>
                  </Box>
                </TableCell>
                <TableCell align="center">
                  {roomType.allows_extra_bed ? (
                    <Tooltip title={`Max ${roomType.max_extra_beds} extra bed(s) @ ${formatCurrency(toNumber(roomType.extra_bed_charge))}/night`}>
                      <Chip
                        label={`Yes (${roomType.max_extra_beds})`}
                        size="small"
                        color="success"
                        icon={<BedIcon />}
                      />
                    </Tooltip>
                  ) : (
                    <Chip label="No" size="small" color="default" />
                  )}
                </TableCell>
                <TableCell align="center">
                  <Tooltip title={roomType.is_active ? 'Active' : 'Inactive'}>
                    <IconButton
                      size="small"
                      onClick={() => canEdit && handleToggleActive(roomType)}
                      disabled={!canEdit}
                    >
                      {roomType.is_active ? (
                        <ActiveIcon color="success" />
                      ) : (
                        <InactiveIcon color="error" />
                      )}
                    </IconButton>
                  </Tooltip>
                </TableCell>
                {canEdit && (
                  <TableCell align="center">
                    <IconButton size="small" onClick={() => handleEditOpen(roomType)}>
                      <EditIcon />
                    </IconButton>
                    <IconButton size="small" onClick={() => handleDeleteOpen(roomType)} color="error">
                      <DeleteIcon />
                    </IconButton>
                  </TableCell>
                )}
              </TableRow>
            ))}
            {roomTypes.length === 0 && (
              <TableRow>
                <TableCell colSpan={canEdit ? 8 : 7} align="center">
                  <Typography color="text.secondary" sx={{ py: 3 }}>
                    No room types configured. Click "Add Room Type" to create one.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Create/Edit Dialog */}
      <Dialog
        open={createDialogOpen || editDialogOpen}
        onClose={() => {
          setCreateDialogOpen(false);
          setEditDialogOpen(false);
          setEditingRoomType(null);
        }}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          {editDialogOpen ? 'Edit Room Type' : 'Create Room Type'}
        </DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
                placeholder="e.g., Deluxe Room"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Code"
                value={formData.code}
                onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                required
                placeholder="e.g., DLX"
                inputProps={{ maxLength: 10 }}
                helperText="Short code for the room type"
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                multiline
                rows={2}
                placeholder="Brief description of the room type"
              />
            </Grid>

            {/* Pricing Section */}
            <Grid item xs={12}>
              <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                <MoneyIcon sx={{ fontSize: 16, verticalAlign: 'middle', mr: 0.5 }} />
                Pricing
              </Typography>
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                fullWidth
                label="Base Price"
                type="number"
                value={formData.base_price}
                onChange={(e) => setFormData({ ...formData, base_price: e.target.value ? Number(e.target.value) : '' })}
                required
                InputProps={{
                  startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment>,
                }}
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                fullWidth
                label="Weekday Rate"
                type="number"
                value={formData.weekday_rate}
                onChange={(e) => setFormData({ ...formData, weekday_rate: e.target.value ? Number(e.target.value) : '' })}
                InputProps={{
                  startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment>,
                }}
                helperText="Optional"
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                fullWidth
                label="Weekend Rate"
                type="number"
                value={formData.weekend_rate}
                onChange={(e) => setFormData({ ...formData, weekend_rate: e.target.value ? Number(e.target.value) : '' })}
                InputProps={{
                  startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment>,
                }}
                helperText="Optional"
              />
            </Grid>

            {/* Room Configuration */}
            <Grid item xs={12}>
              <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1, mt: 1 }}>
                <BedIcon sx={{ fontSize: 16, verticalAlign: 'middle', mr: 0.5 }} />
                Room Configuration
              </Typography>
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                fullWidth
                label="Max Occupancy"
                type="number"
                value={formData.max_occupancy}
                onChange={(e) => setFormData({ ...formData, max_occupancy: Number(e.target.value) || 1 })}
                inputProps={{ min: 1, max: 10 }}
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                fullWidth
                select
                label="Bed Type"
                value={formData.bed_type}
                onChange={(e) => setFormData({ ...formData, bed_type: e.target.value })}
              >
                {BED_TYPES.map((type) => (
                  <MenuItem key={type} value={type}>{type}</MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                fullWidth
                label="Bed Count"
                type="number"
                value={formData.bed_count}
                onChange={(e) => setFormData({ ...formData, bed_count: Number(e.target.value) || 1 })}
                inputProps={{ min: 1, max: 5 }}
              />
            </Grid>

            {/* Extra Bed Configuration */}
            <Grid item xs={12}>
              <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1, mt: 1 }}>
                Extra Bed Configuration
              </Typography>
            </Grid>
            <Grid item xs={12}>
              <FormControlLabel
                control={
                  <Switch
                    checked={formData.allows_extra_bed}
                    onChange={(e) => setFormData({
                      ...formData,
                      allows_extra_bed: e.target.checked,
                      max_extra_beds: e.target.checked ? (formData.max_extra_beds || 1) : 0,
                    })}
                  />
                }
                label="Allow Extra Bed"
              />
            </Grid>
            {formData.allows_extra_bed && (
              <>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    label="Max Extra Beds"
                    type="number"
                    value={formData.max_extra_beds}
                    onChange={(e) => setFormData({ ...formData, max_extra_beds: Number(e.target.value) || 0 })}
                    inputProps={{ min: 1, max: 5 }}
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    label="Extra Bed Charge (per night)"
                    type="number"
                    value={formData.extra_bed_charge}
                    onChange={(e) => setFormData({ ...formData, extra_bed_charge: e.target.value ? Number(e.target.value) : '' })}
                    InputProps={{
                      startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment>,
                    }}
                  />
                </Grid>
              </>
            )}

            {/* Display Settings */}
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Sort Order"
                type="number"
                value={formData.sort_order}
                onChange={(e) => setFormData({ ...formData, sort_order: Number(e.target.value) || 0 })}
                helperText="Lower numbers appear first"
              />
            </Grid>
            {editDialogOpen && (
              <Grid item xs={12} sm={6}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={formData.is_active}
                      onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                    />
                  }
                  label="Active"
                />
              </Grid>
            )}
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setCreateDialogOpen(false);
              setEditDialogOpen(false);
              setEditingRoomType(null);
            }}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={editDialogOpen ? handleUpdate : handleCreate}
            disabled={formLoading || !formData.name || !formData.code || !formData.base_price}
          >
            {formLoading ? <CircularProgress size={24} /> : (editDialogOpen ? 'Update' : 'Create')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>Delete Room Type</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete <strong>{deletingRoomType?.name}</strong>?
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            This action cannot be undone. If rooms are using this type, you should deactivate it instead.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" color="error" onClick={handleDelete} disabled={formLoading}>
            {formLoading ? <CircularProgress size={24} /> : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar */}
      <Snackbar
        open={snackbarOpen}
        autoHideDuration={4000}
        onClose={() => setSnackbarOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert severity={snackbarSeverity} onClose={() => setSnackbarOpen(false)}>
          {snackbarMessage}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default RoomTypeConfigurationPage;

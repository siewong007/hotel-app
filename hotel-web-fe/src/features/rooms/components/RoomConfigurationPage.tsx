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
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Save as SaveIcon,
  Cancel as CancelIcon,
  Hotel as HotelIcon,
} from '@mui/icons-material';
import { HotelAPIService } from '../../../api';
import { Room } from '../../../types';
import { useAuth } from '../../../auth/AuthContext';
import { useCurrency } from '../../../hooks/useCurrency';

interface RoomType {
  id: number;
  name: string;
  code: string;
  base_price: number;
}

interface RoomFormData {
  room_number: string;
  room_type_id: number | '';
  floor: number | '';
  building: string;
  custom_price: number | '';
  is_accessible: boolean;
}

const RoomConfigurationPage: React.FC = () => {
  const { hasRole, hasPermission } = useAuth();
  const { format: formatCurrency, symbol: currencySymbol } = useCurrency();
  const isAdmin = hasRole('admin');
  const hasAccess = hasRole('admin') || hasRole('receptionist') || hasRole('manager') || hasPermission('rooms:read') || hasPermission('rooms:manage');

  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Dialog states
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Form states
  const [formData, setFormData] = useState<RoomFormData>({
    room_number: '',
    room_type_id: '',
    floor: '',
    building: '',
    custom_price: '',
    is_accessible: false,
  });

  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [deletingRoom, setDeletingRoom] = useState<Room | null>(null);
  const [formLoading, setFormLoading] = useState(false);

  // Snackbar
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');

  useEffect(() => {
    if (hasAccess) {
      loadData();
    }
  }, [hasAccess]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [roomsData, roomTypesData] = await Promise.all([
        HotelAPIService.getAllRooms(),
        HotelAPIService.getRoomTypes(),
      ]);
      setRooms(roomsData);
      setRoomTypes(roomTypesData);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      room_number: '',
      room_type_id: '',
      floor: '',
      building: '',
      custom_price: '',
      is_accessible: false,
    });
  };

  const handleCreateClick = () => {
    resetForm();
    setCreateDialogOpen(true);
  };

  const handleEditClick = (room: Room) => {
    setEditingRoom(room);
    const roomType = roomTypes.find(rt => rt.name === room.room_type);
    setFormData({
      room_number: room.room_number,
      room_type_id: roomType?.id || '',
      floor: '', // Not available in Room type
      building: '',
      custom_price: typeof room.price_per_night === 'string' ? parseFloat(room.price_per_night) : room.price_per_night,
      is_accessible: false,
    });
    setEditDialogOpen(true);
  };

  const handleDeleteClick = (room: Room) => {
    setDeletingRoom(room);
    setDeleteDialogOpen(true);
  };

  const handleCreateRoom = async () => {
    if (!formData.room_number || !formData.room_type_id || formData.floor === '') {
      setError('Please fill in all required fields');
      return;
    }

    try {
      setFormLoading(true);
      await HotelAPIService.createRoom({
        room_number: formData.room_number,
        room_type_id: formData.room_type_id as number,
        floor: formData.floor as number,
        building: formData.building || undefined,
        custom_price: formData.custom_price ? (formData.custom_price as number) : undefined,
        is_accessible: formData.is_accessible,
      });
      setSnackbarMessage('Room created successfully');
      setSnackbarOpen(true);
      setCreateDialogOpen(false);
      resetForm();
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to create room');
    } finally {
      setFormLoading(false);
    }
  };

  const handleUpdateRoom = async () => {
    if (!editingRoom) return;

    try {
      setFormLoading(true);
      await HotelAPIService.updateRoom(editingRoom.id, {
        room_number: formData.room_number,
        price_per_night: formData.custom_price ? (formData.custom_price as number) : undefined,
        available: editingRoom.available,
      });
      setSnackbarMessage('Room updated successfully');
      setSnackbarOpen(true);
      setEditDialogOpen(false);
      setEditingRoom(null);
      resetForm();
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to update room');
    } finally {
      setFormLoading(false);
    }
  };

  const handleDeleteRoom = async () => {
    if (!deletingRoom) return;

    try {
      setFormLoading(true);
      await HotelAPIService.deleteRoom(Number(deletingRoom.id));
      setSnackbarMessage('Room deleted successfully');
      setSnackbarOpen(true);
      setDeleteDialogOpen(false);
      setDeletingRoom(null);
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to delete room');
    } finally {
      setFormLoading(false);
    }
  };

  const getRoomTypeById = (id: number) => {
    return roomTypes.find(rt => rt.id === id);
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
            <HotelIcon sx={{ fontSize: 32 }} />
            Room Configuration
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Manage room inventory - Create, edit, and delete rooms
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={handleCreateClick}
          sx={{ borderRadius: 2 }}
        >
          Add New Room
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
                {rooms.length}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Total Rooms
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent sx={{ textAlign: 'center' }}>
              <Typography variant="h4" sx={{ fontWeight: 600, color: 'success.main' }}>
                {rooms.filter(r => r.available).length}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Available
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent sx={{ textAlign: 'center' }}>
              <Typography variant="h4" sx={{ fontWeight: 600, color: 'info.main' }}>
                {roomTypes.length}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Room Types
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent sx={{ textAlign: 'center' }}>
              <Typography variant="h4" sx={{ fontWeight: 600, color: 'warning.main' }}>
                {rooms.filter(r => !r.available).length}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Unavailable
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Rooms Table */}
      <Card>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Room Number</TableCell>
                <TableCell>Room Type</TableCell>
                <TableCell>Price/Night</TableCell>
                <TableCell>Max Occupancy</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rooms.map((room) => (
                <TableRow key={room.id}>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {room.room_number}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip label={room.room_type} size="small" color="primary" variant="outlined" />
                  </TableCell>
                  <TableCell>
                    {formatCurrency(typeof room.price_per_night === 'string'
                      ? parseFloat(room.price_per_night)
                      : room.price_per_night)}
                  </TableCell>
                  <TableCell>{room.max_occupancy} guests</TableCell>
                  <TableCell>
                    <Chip
                      label={room.available ? 'Available' : 'Unavailable'}
                      size="small"
                      color={room.available ? 'success' : 'default'}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <IconButton
                      size="small"
                      onClick={() => handleEditClick(room)}
                      color="primary"
                    >
                      <EditIcon />
                    </IconButton>
                    <IconButton
                      size="small"
                      onClick={() => handleDeleteClick(room)}
                      color="error"
                    >
                      <DeleteIcon />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      {/* Create Dialog */}
      <Dialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Create New Room</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Room Number"
                value={formData.room_number}
                onChange={(e) => setFormData({ ...formData, room_number: e.target.value })}
                required
                helperText="e.g., 101, 102, 201A"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                select
                fullWidth
                label="Room Type"
                value={formData.room_type_id}
                onChange={(e) => setFormData({ ...formData, room_type_id: parseInt(e.target.value) })}
                required
              >
                {roomTypes.map((rt) => (
                  <MenuItem key={rt.id} value={rt.id}>
                    {rt.name} ({rt.code})
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Floor"
                type="number"
                value={formData.floor}
                onChange={(e) => setFormData({ ...formData, floor: parseInt(e.target.value) })}
                required
                inputProps={{ min: 0 }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Building"
                value={formData.building}
                onChange={(e) => setFormData({ ...formData, building: e.target.value })}
                helperText="Optional, e.g., Main Building, Tower A"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label={`Custom Price (${currencySymbol})`}
                type="number"
                value={formData.custom_price}
                onChange={(e) => setFormData({ ...formData, custom_price: parseFloat(e.target.value) })}
                inputProps={{ step: '0.01', min: '0' }}
                helperText={
                  formData.room_type_id && getRoomTypeById(formData.room_type_id as number)
                    ? `Base price: ${formatCurrency(getRoomTypeById(formData.room_type_id as number)?.base_price || 0)}`
                    : 'Leave empty to use room type base price'
                }
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControlLabel
                control={
                  <Switch
                    checked={formData.is_accessible}
                    onChange={(e) => setFormData({ ...formData, is_accessible: e.target.checked })}
                  />
                }
                label="Wheelchair Accessible"
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialogOpen(false)} startIcon={<CancelIcon />}>
            Cancel
          </Button>
          <Button
            onClick={handleCreateRoom}
            variant="contained"
            startIcon={<SaveIcon />}
            disabled={formLoading}
          >
            {formLoading ? <CircularProgress size={20} /> : 'Create Room'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onClose={() => setEditDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Edit Room {editingRoom?.room_number}</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Room Number"
                value={formData.room_number}
                onChange={(e) => setFormData({ ...formData, room_number: e.target.value })}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Custom Price (RM)"
                type="number"
                value={formData.custom_price}
                onChange={(e) => setFormData({ ...formData, custom_price: parseFloat(e.target.value) })}
                inputProps={{ step: '0.01', min: '0' }}
                helperText="Leave empty to use room type base price"
              />
            </Grid>
            <Grid item xs={12}>
              <Alert severity="info">
                Room type, floor, and building cannot be changed after creation. To change these, please delete and recreate the room.
              </Alert>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditDialogOpen(false)} startIcon={<CancelIcon />}>
            Cancel
          </Button>
          <Button
            onClick={handleUpdateRoom}
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
        <DialogTitle>Delete Room</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            Are you sure you want to delete room <strong>{deletingRoom?.room_number}</strong>?
          </Alert>
          <Typography variant="body2" color="text.secondary">
            This action cannot be undone. The room can only be deleted if it has no existing bookings.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleDeleteRoom}
            variant="contained"
            color="error"
            disabled={formLoading}
          >
            {formLoading ? <CircularProgress size={20} /> : 'Delete Room'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default RoomConfigurationPage;

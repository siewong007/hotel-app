import React, { useState, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Typography,
  CircularProgress,
  Alert,
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  Divider,
  Card,
  CardContent,
  Tabs,
  Tab,
} from '@mui/material';
import {
  Settings as SettingsIcon,
  Info as InfoIcon,
  History as HistoryIcon,
  SwapHoriz as RoomChangeIcon,
} from '@mui/icons-material';
import { HotelAPIService } from '../../../api';
import { RoomDetailedStatus, RoomStatusUpdateInput } from '../../../types';
import RoomHistoryTimeline from './RoomHistoryTimeline';

interface RoomEventDialogProps {
  open: boolean;
  onClose: () => void;
  roomId: string | null;
  roomNumber?: string;
  currentStatus?: string;
  onSuccess: () => void;
}

const RoomEventDialog: React.FC<RoomEventDialogProps> = ({
  open,
  onClose,
  roomId,
  roomNumber,
  currentStatus,
  onSuccess,
}) => {
  const loadedRoomIdRef = useRef<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailedStatus, setDetailedStatus] = useState<RoomDetailedStatus | null>(null);
  const [currentTab, setCurrentTab] = useState(0);

  // Status form state - only change status functionality
  const [newStatus, setNewStatus] = useState<'available' | 'occupied' | 'cleaning' | 'maintenance' | 'reserved'>('maintenance');
  const [statusNotes, setStatusNotes] = useState('');
  // Enhanced status metadata fields
  const [reservedStartDate, setReservedStartDate] = useState('');
  const [reservedEndDate, setReservedEndDate] = useState('');
  const [maintenanceStartDate, setMaintenanceStartDate] = useState('');
  const [maintenanceEndDate, setMaintenanceEndDate] = useState('');
  const [cleaningStartDate, setCleaningStartDate] = useState('');
  const [cleaningEndDate, setCleaningEndDate] = useState('');
  const [targetRoomId, setTargetRoomId] = useState('');
  const [availableRooms, setAvailableRooms] = useState<any[]>([]);
  const [roomChangeMode, setRoomChangeMode] = useState(false);

  useEffect(() => {
    if (open && roomId && loadedRoomIdRef.current !== roomId) {
      loadedRoomIdRef.current = roomId;
      loadRoomDetails();
      // Reset form - default to 'maintenance'
      setNewStatus('maintenance');
      setStatusNotes('');
      setReservedStartDate('');
      setReservedEndDate('');
      setMaintenanceStartDate('');
      setMaintenanceEndDate('');
      setCleaningStartDate('');
      setCleaningEndDate('');
      setTargetRoomId('');
      setError(null);
    }

    // Reset ref when dialog closes
    if (!open) {
      loadedRoomIdRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, roomId]);

  // Load available rooms when room change mode is activated
  useEffect(() => {
    if (roomChangeMode) {
      loadAvailableRooms();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomChangeMode]);

  const loadAvailableRooms = async () => {
    try {
      const rooms = await HotelAPIService.getAllRooms();
      // Filter out the current room
      const otherRooms = rooms.filter((r: any) => r.id !== roomId);

      // Filter rooms that are truly available for room change
      // Backend requires status === 'available', so we must match that
      const filtered = otherRooms.filter((r: any) => {
        const currentStatus = r.status || 'available';
        return currentStatus === 'available';
      });

      setAvailableRooms(filtered);
    } catch (err: any) {
      console.error('Failed to load available rooms:', err);
    }
  };

  const loadRoomDetails = async () => {
    if (!roomId) return;

    try {
      setLoadingDetails(true);
      const details = await HotelAPIService.getRoomDetailedStatus(roomId);
      setDetailedStatus(details);

      // Pre-populate date fields with existing room metadata
      if (details.reserved_start_date) setReservedStartDate(details.reserved_start_date);
      if (details.reserved_end_date) setReservedEndDate(details.reserved_end_date);
      if (details.maintenance_start_date) setMaintenanceStartDate(details.maintenance_start_date);
      if (details.maintenance_end_date) setMaintenanceEndDate(details.maintenance_end_date);
      if (details.cleaning_start_date) setCleaningStartDate(details.cleaning_start_date);
      if (details.cleaning_end_date) setCleaningEndDate(details.cleaning_end_date);
      if (details.target_room_id) setTargetRoomId(details.target_room_id.toString());
      if (details.status_notes) setStatusNotes(details.status_notes);

      console.log('Loaded room metadata:', {
        reserved_start_date: details.reserved_start_date,
        reserved_end_date: details.reserved_end_date,
        maintenance_start_date: details.maintenance_start_date,
        maintenance_end_date: details.maintenance_end_date,
        cleaning_start_date: details.cleaning_start_date,
        cleaning_end_date: details.cleaning_end_date,
      });
    } catch (err: any) {
      console.error('Failed to load room details:', err);
    } finally {
      setLoadingDetails(false);
    }
  };

  const handleUpdateStatus = async () => {
    if (!roomId) return;

    console.log('=== handleUpdateStatus called ===');
    console.log('Current state:', {
      newStatus,
      maintenanceStartDate,
      maintenanceEndDate,
      cleaningStartDate,
      cleaningEndDate,
      reservedStartDate,
      reservedEndDate,
      targetRoomId
    });

    // Validation: Cannot change from other status to available
    if (currentStatus && currentStatus !== 'available' && newStatus === 'available') {
      setError('You cannot change room status back to "available". Only system can set rooms to available.');
      return;
    }

    // Validation: Cannot modify occupied rooms UNLESS setting occupied again (to update dates)
    if (currentStatus === 'occupied' && newStatus !== 'occupied') {
      setError('Cannot change occupied room status. Please check out the guest first or use "Room Change" button.');
      return;
    }

    // Validation: Can only change from available to other statuses (exception: occupied can update its dates)
    if (currentStatus !== 'available' && !(currentStatus === 'occupied' && newStatus === 'occupied')) {
      setError('You can only change room status when it is "available".');
      return;
    }

    // Validate required fields based on status
    if (newStatus === 'reserved') {
      if (!reservedStartDate || !reservedEndDate) {
        setError('Reserved status requires both start date and end date.');
        return;
      }
      if (new Date(reservedEndDate) < new Date(reservedStartDate)) {
        setError('End date must be after start date.');
        return;
      }
    }

    if (newStatus === 'occupied') {
      if (!reservedStartDate || !reservedEndDate) {
        setError('Occupied status requires both start date and end date to track when the room will be available.');
        return;
      }
      if (new Date(reservedEndDate) < new Date(reservedStartDate)) {
        setError('End date must be after start date.');
        return;
      }
    }

    if (newStatus === 'maintenance') {
      console.log('Validating maintenance:', { maintenanceStartDate, maintenanceEndDate });
      if (!maintenanceStartDate || maintenanceStartDate.trim() === '' || !maintenanceEndDate || maintenanceEndDate.trim() === '') {
        console.error('Maintenance validation failed:', { maintenanceStartDate, maintenanceEndDate });
        setError('Maintenance status requires both start date and end date.');
        return;
      }
      if (new Date(maintenanceEndDate) < new Date(maintenanceStartDate)) {
        setError('End date must be after start date.');
        return;
      }
    }

    if (newStatus === 'cleaning') {
      if (!cleaningStartDate || cleaningStartDate.trim() === '' || !cleaningEndDate || cleaningEndDate.trim() === '') {
        setError('Cleaning status requires both start date and end date.');
        return;
      }
      if (new Date(cleaningEndDate) < new Date(cleaningStartDate)) {
        setError('End date must be after start date.');
        return;
      }
    }

    try {
      setLoading(true);
      setError(null);

      const statusInput: RoomStatusUpdateInput = {
        status: newStatus,
        notes: statusNotes || undefined,
        reserved_start_date: (newStatus === 'reserved' || newStatus === 'occupied') ? reservedStartDate : undefined,
        reserved_end_date: (newStatus === 'reserved' || newStatus === 'occupied') ? reservedEndDate : undefined,
        maintenance_start_date: newStatus === 'maintenance' ? maintenanceStartDate : undefined,
        maintenance_end_date: newStatus === 'maintenance' ? maintenanceEndDate : undefined,
        cleaning_start_date: newStatus === 'cleaning' ? cleaningStartDate : undefined,
        cleaning_end_date: newStatus === 'cleaning' ? cleaningEndDate : undefined,
      };

      await HotelAPIService.updateRoomStatus(roomId, statusInput);
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to update room status');
    } finally {
      setLoading(false);
    }
  };

  const canChangeStatus = currentStatus === 'available';
  const isOccupied = currentStatus === 'occupied';
  const canEndMaintenance = currentStatus === 'maintenance' || currentStatus === 'cleaning' || currentStatus === 'reserved';

  // Check if we can check in a guest (reserved room with confirmed/pending booking for today or past)
  const canCheckInGuest = currentStatus === 'reserved' &&
    detailedStatus?.current_booking &&
    (detailedStatus.current_booking.status === 'confirmed' || detailedStatus.current_booking.status === 'pending') &&
    (() => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const checkInDate = new Date(detailedStatus.current_booking.check_in_date);
      checkInDate.setHours(0, 0, 0, 0);
      return checkInDate <= today;
    })();

  const handleEndMaintenance = async () => {
    if (!roomId) return;

    try {
      setLoading(true);
      setError(null);

      // Add a brief delay for smooth animation
      await new Promise(resolve => setTimeout(resolve, 300));

      await HotelAPIService.endMaintenance(roomId);

      // Show success animation
      await new Promise(resolve => setTimeout(resolve, 400));

      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to end maintenance');
    } finally {
      setLoading(false);
    }
  };

  const handleRoomChange = async () => {
    console.log('handleRoomChange called', { roomId, targetRoomId });

    if (!roomId || !targetRoomId) {
      console.log('Validation failed - missing roomId or targetRoomId');
      setError('Please select a target room.');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      console.log('Calling executeRoomChange API', { roomId, targetRoomId });
      const result = await HotelAPIService.executeRoomChange(roomId, targetRoomId);
      console.log('Room change result:', result);

      setRoomChangeMode(false);
      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Room change error:', err);
      setError(err.message || 'Failed to execute room change');
    } finally {
      setLoading(false);
    }
  };

  const handleCheckInGuest = async () => {
    if (!roomId || !detailedStatus?.current_booking?.id) {
      setError('No booking found to check in.');
      return;
    }

    const booking = detailedStatus.current_booking;

    try {
      setLoading(true);
      setError(null);

      console.log('Checking in guest:', {
        bookingId: booking.id,
        guestName: booking.guest_name,
        currentStatus: booking.status,
        checkIn: booking.check_in_date,
        checkOut: booking.check_out_date,
      });

      // Call the dedicated check-in endpoint
      await HotelAPIService.checkInGuest(booking.id);

      console.log('Guest checked in successfully');
      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Failed to check in guest:', err);
      const errorMessage = err.message || err.toString() || 'Failed to check in guest';
      setError(`Failed to check in guest: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      TransitionProps={{
        timeout: {
          enter: 400,
          exit: 300,
        },
      }}
      sx={{
        '& .MuiDialog-paper': {
          transition: 'all 0.3s ease-in-out',
        },
      }}
    >
      <DialogTitle>
        <Box display="flex" alignItems="center">
          <SettingsIcon sx={{ mr: 1, color: 'primary.main' }} />
          <Typography variant="h6">
            Room {roomNumber || roomId} - Status Management
          </Typography>
        </Box>
        {currentStatus && (
          <Chip
            label={currentStatus.toUpperCase()}
            color={currentStatus === 'available' ? 'success' : currentStatus === 'occupied' ? 'error' : 'warning'}
            size="small"
            sx={{ mt: 1 }}
          />
        )}
      </DialogTitle>

      <DialogContent dividers>
        {/* Tabs */}
        <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
          <Tabs value={currentTab} onChange={(_, newValue) => setCurrentTab(newValue)}>
            <Tab icon={<SettingsIcon />} label="Change Status" iconPosition="start" />
            <Tab icon={<HistoryIcon />} label="History" iconPosition="start" />
          </Tabs>
        </Box>

        {/* Tab Content */}
        {currentTab === 0 && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {error && (
              <Alert severity="error" onClose={() => setError(null)}>
                {error}
              </Alert>
            )}

          {isOccupied && !roomChangeMode && (
            <Alert severity="info" icon={<InfoIcon />}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                Room is Occupied
              </Typography>
              <Typography variant="body2" sx={{ mb: 2 }}>
                This room is currently occupied. You cannot modify the status while guests are checked in.
              </Typography>
              <Button
                variant="contained"
                color="primary"
                onClick={() => setRoomChangeMode(true)}
                size="small"
                startIcon={<RoomChangeIcon />}
              >
                Change Room
              </Button>
            </Alert>
          )}

          {isOccupied && roomChangeMode && (
            <Box>
              <Alert severity="info" sx={{ mb: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                  Room Change
                </Typography>
                <Typography variant="body2">
                  Select a new room to transfer the guest. This will move the booking to the selected room.
                </Typography>
              </Alert>

              <FormControl fullWidth required sx={{ mb: 2 }}>
                <InputLabel>Target Room</InputLabel>
                <Select
                  value={targetRoomId}
                  onChange={(e) => setTargetRoomId(String(e.target.value))}
                  label="Target Room"
                >
                  {availableRooms.map((room) => (
                    <MenuItem key={room.id} value={String(room.id)}>
                      Room {room.room_number} - {room.room_type}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              {availableRooms.length === 0 ? (
                <Alert severity="warning" sx={{ mb: 2 }}>
                  No rooms available for change. All other rooms are occupied or unavailable.
                </Alert>
              ) : (
                <Alert severity="success" sx={{ mb: 2 }}>
                  {availableRooms.length} room{availableRooms.length !== 1 ? 's' : ''} available
                </Alert>
              )}

              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button
                  variant="outlined"
                  onClick={() => {
                    setRoomChangeMode(false);
                    setTargetRoomId('');
                  }}
                  disabled={loading}
                >
                  Cancel
                </Button>
                <Button
                  variant="contained"
                  color="primary"
                  onClick={() => {
                    console.log('Execute Room Change button clicked!', { roomId, targetRoomId, loading });
                    handleRoomChange();
                  }}
                  disabled={loading || !targetRoomId}
                  startIcon={loading ? <CircularProgress size={20} /> : null}
                >
                  {loading ? 'Changing...' : 'Execute Room Change'}
                </Button>
              </Box>
              {/* Debug info */}
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                Debug: roomId={roomId}, targetRoomId={targetRoomId}, loading={String(loading)}, availableRooms={availableRooms.length}
              </Typography>
            </Box>
          )}

          {canCheckInGuest && (
            <Alert severity="info" icon={<InfoIcon />}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                Guest Ready to Check In
              </Typography>
              <Typography variant="body2" sx={{ mb: 2 }}>
                {detailedStatus?.current_booking?.guest_name} is scheduled to check in today. Use the button below to check in the guest and mark the room as occupied.
              </Typography>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button
                  variant="contained"
                  color="primary"
                  onClick={handleCheckInGuest}
                  disabled={loading}
                  startIcon={loading ? <CircularProgress size={20} /> : <SettingsIcon />}
                  sx={{
                    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                    '&:hover': {
                      transform: 'translateY(-2px)',
                      boxShadow: 4,
                    },
                    '&:active': {
                      transform: 'translateY(0)',
                    },
                    '&.Mui-disabled': {
                      opacity: 0.7,
                    },
                  }}
                >
                  {loading ? 'Checking In...' : 'Check In Guest'}
                </Button>
                <Button
                  variant="outlined"
                  color="error"
                  onClick={handleEndMaintenance}
                  disabled={loading}
                  size="small"
                >
                  Cancel Reservation
                </Button>
              </Box>
            </Alert>
          )}

          {!canChangeStatus && !isOccupied && !canCheckInGuest && canEndMaintenance && (
            <Alert severity="success" icon={<InfoIcon />}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                {currentStatus === 'maintenance' ? 'Maintenance' :
                 currentStatus === 'cleaning' ? 'Cleaning' : 'Reserved'} In Progress
              </Typography>
              <Typography variant="body2">
                This room is currently under {currentStatus}. Use the button below to complete the {currentStatus} and return the room to available status.
              </Typography>
              <Button
                variant="contained"
                color="success"
                onClick={handleEndMaintenance}
                disabled={loading}
                startIcon={loading ? <CircularProgress size={20} /> : <SettingsIcon />}
                sx={{
                  mt: 2,
                  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                  '&:hover': {
                    transform: 'translateY(-2px)',
                    boxShadow: 4,
                  },
                  '&:active': {
                    transform: 'translateY(0)',
                  },
                  '&.Mui-disabled': {
                    opacity: 0.7,
                  },
                }}
              >
                {loading ? 'Ending...' : `End ${
                  currentStatus === 'maintenance' ? 'Maintenance' :
                  currentStatus === 'cleaning' ? 'Cleaning' : 'Reserved Status'
                }`}
              </Button>
            </Alert>
          )}

          {!canChangeStatus && !isOccupied && !canEndMaintenance && (
            <Alert severity="info">
              Room status can only be changed when the room is "available".
            </Alert>
          )}

          {/* Room Details Card */}
          {loadingDetails ? (
            <Box display="flex" justifyContent="center" p={2}>
              <CircularProgress size={30} />
            </Box>
          ) : detailedStatus && (
            <Card elevation={0} sx={{ bgcolor: 'grey.50' }}>
              <CardContent>
                <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 600 }}>
                  Room Details
                </Typography>
                <Grid container spacing={1}>
                  <Grid item xs={6}>
                    <Typography variant="body2" color="text.secondary">Room Type:</Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {detailedStatus.room_type}
                    </Typography>
                  </Grid>
                  {detailedStatus.current_booking && (
                    <>
                      <Grid item xs={6}>
                        <Typography variant="body2" color="text.secondary">Current Guest:</Typography>
                      </Grid>
                      <Grid item xs={6}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {detailedStatus.current_booking.guest_name}
                        </Typography>
                      </Grid>
                      <Grid item xs={6}>
                        <Typography variant="body2" color="text.secondary">Check-in Date:</Typography>
                      </Grid>
                      <Grid item xs={6}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {detailedStatus.current_booking.check_in_date}
                        </Typography>
                      </Grid>
                      <Grid item xs={6}>
                        <Typography variant="body2" color="text.secondary">Check-out Date:</Typography>
                      </Grid>
                      <Grid item xs={6}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {detailedStatus.current_booking.check_out_date}
                        </Typography>
                      </Grid>
                    </>
                  )}
                  {detailedStatus.next_booking && (
                    <>
                      <Grid item xs={6}>
                        <Typography variant="body2" color="text.secondary">Next Booking:</Typography>
                      </Grid>
                      <Grid item xs={6}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {detailedStatus.next_booking.guest_name} - {detailedStatus.next_booking.check_in_date}
                        </Typography>
                      </Grid>
                    </>
                  )}
                </Grid>
              </CardContent>
            </Card>
          )}

          {!isOccupied && canChangeStatus && (
            <>
              <Divider />

              {/* Status Form */}
              <Box>
                <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 600 }}>
                  Change Room Status
                </Typography>
                <Alert severity="info" sx={{ mb: 2 }}>
                  You can only change from "available" to other statuses. To return a room to "available",
                  complete the associated event or use the check-out process.
                </Alert>
                <Grid container spacing={2}>
                  <Grid item xs={12}>
                    <FormControl fullWidth>
                      <InputLabel>New Status</InputLabel>
                      <Select
                        value={newStatus}
                        onChange={(e) => setNewStatus(e.target.value as any)}
                        label="New Status"
                      >
                        <MenuItem value="cleaning">Cleaning</MenuItem>
                        <MenuItem value="maintenance">Maintenance</MenuItem>
                        <MenuItem value="occupied">Occupied</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={12}>
                    <Alert severity="info" sx={{ mt: 0 }}>
                      <Typography variant="body2">
                        <strong>To reserve a room:</strong> Use the "Walk-in Check-in" or "Book Room" options from the room menu.
                        This ensures guest details are properly captured for the reservation.
                      </Typography>
                    </Alert>
                  </Grid>

                  {/* Reserved and Occupied status - show date range */}
                  {(newStatus === 'reserved' || newStatus === 'occupied') && (
                    <>
                      <Grid item xs={12}>
                        <Typography variant="caption" color="primary" sx={{ display: 'block', mb: 1 }}>
                          {newStatus === 'occupied'
                            ? 'Occupied rooms must have defined start and end dates to track availability:'
                            : 'Fill in both dates and times for reservation:'}
                        </Typography>
                      </Grid>
                      <Grid item xs={6}>
                        <TextField
                          fullWidth
                          type="datetime-local"
                          label="Start Date & Time"
                          value={reservedStartDate}
                          onChange={(e) => setReservedStartDate(e.target.value)}
                          InputLabelProps={{ shrink: true }}
                          required
                        />
                      </Grid>
                      <Grid item xs={6}>
                        <TextField
                          fullWidth
                          type="datetime-local"
                          label="End Date & Time"
                          value={reservedEndDate}
                          onChange={(e) => setReservedEndDate(e.target.value)}
                          InputLabelProps={{ shrink: true }}
                          required
                        />
                      </Grid>
                    </>
                  )}

                  {/* Maintenance status - show date range */}
                  {newStatus === 'maintenance' && (
                    <>
                      <Grid item xs={12}>
                        <Typography variant="caption" color="primary" sx={{ display: 'block', mb: 1 }}>
                          Fill in both dates and times for maintenance schedule:
                        </Typography>
                      </Grid>
                      <Grid item xs={6}>
                        <TextField
                          fullWidth
                          type="datetime-local"
                          label="Maintenance Start Date & Time"
                          value={maintenanceStartDate}
                          onChange={(e) => {
                            const newValue = e.target.value;
                            console.log('Maintenance start date changed:', newValue);
                            setMaintenanceStartDate(newValue);
                            setError(null); // Clear error when user starts typing
                          }}
                          InputLabelProps={{ shrink: true }}
                          required
                          error={!maintenanceStartDate && error !== null}
                          helperText={!maintenanceStartDate && error ? "Required" : "When will maintenance start?"}
                        />
                      </Grid>
                      <Grid item xs={6}>
                        <TextField
                          fullWidth
                          type="datetime-local"
                          label="Maintenance End Date & Time"
                          value={maintenanceEndDate}
                          onChange={(e) => {
                            const newValue = e.target.value;
                            console.log('Maintenance end date changed:', newValue);
                            setMaintenanceEndDate(newValue);
                            setError(null); // Clear error when user starts typing
                          }}
                          InputLabelProps={{ shrink: true }}
                          required
                          error={!maintenanceEndDate && error !== null}
                          helperText={!maintenanceEndDate && error ? "Required" : "When will maintenance be completed?"}
                        />
                      </Grid>
                    </>
                  )}

                  {/* Cleaning status - show date range */}
                  {newStatus === 'cleaning' && (
                    <>
                      <Grid item xs={6}>
                        <TextField
                          fullWidth
                          type="datetime-local"
                          label="Cleaning Start Date & Time"
                          value={cleaningStartDate}
                          onChange={(e) => setCleaningStartDate(e.target.value)}
                          InputLabelProps={{ shrink: true }}
                          required
                          helperText="When will the cleaning start?"
                        />
                      </Grid>
                      <Grid item xs={6}>
                        <TextField
                          fullWidth
                          type="datetime-local"
                          label="Cleaning End Date & Time"
                          value={cleaningEndDate}
                          onChange={(e) => setCleaningEndDate(e.target.value)}
                          InputLabelProps={{ shrink: true }}
                          required
                          helperText="When will the cleaning be completed?"
                        />
                      </Grid>
                    </>
                  )}

                  <Grid item xs={12}>
                    <TextField
                      fullWidth
                      label="Status Notes"
                      multiline
                      rows={3}
                      value={statusNotes}
                      onChange={(e) => setStatusNotes(e.target.value)}
                      placeholder="Add notes about why the status is being changed..."
                    />
                  </Grid>
                </Grid>
              </Box>
            </>
          )}
          </Box>
        )}

        {/* History Tab */}
        {currentTab === 1 && roomId && (
          <RoomHistoryTimeline roomId={roomId} />
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        {!isOccupied && canChangeStatus && (
          <Button
            onClick={handleUpdateStatus}
            variant="contained"
            disabled={loading}
            startIcon={loading ? <CircularProgress size={20} /> : <SettingsIcon />}
          >
            {loading ? 'Updating...' : 'Update Status'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default RoomEventDialog;

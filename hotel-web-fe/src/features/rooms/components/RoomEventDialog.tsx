import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
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
import { LogoLoader } from '../../../components';
import { BookingsService, RoomsService } from '../../../api';
import { queryStaleTime } from '../../../api/queryConfig';
import { invalidateBookingDependencies, invalidateRoomDependencies } from '../../../api/queryInvalidation';
import { queryKeys } from '../../../api/queryKeys';
import { Room, RoomDetailedStatus, RoomStatusUpdateInput } from '../../../types';
import RoomHistoryTimeline from './RoomHistoryTimeline';
import { errorMessage } from '../../../utils/errorMessage';
import { useTranslation } from '../../../i18n/useTranslation';
import { formatHotelDate } from '../../../utils/date';
import { getLocalizedStatusLabel } from '../config';

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
  const { t } = useTranslation('rooms');
  const queryClient = useQueryClient();
  const loadedRoomIdRef = useRef<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailedStatus, setDetailedStatus] = useState<RoomDetailedStatus | null>(null);
  const [currentTab, setCurrentTab] = useState(0);

  // Status form state - only change status functionality
  const [newStatus, setNewStatus] = useState<'available' | 'occupied' | 'maintenance' | 'reserved'>('maintenance');
  const [statusNotes, setStatusNotes] = useState('');
  // Enhanced status metadata fields
  const [reservedStartDate, setReservedStartDate] = useState('');
  const [reservedEndDate, setReservedEndDate] = useState('');
  const [maintenanceStartDate, setMaintenanceStartDate] = useState('');
  const [maintenanceEndDate, setMaintenanceEndDate] = useState('');
  const [cleaningStartDate, setCleaningStartDate] = useState('');
  const [cleaningEndDate, setCleaningEndDate] = useState('');
  const [targetRoomId, setTargetRoomId] = useState('');
  const [availableRooms, setAvailableRooms] = useState<Room[]>([]);
  const [roomChangeMode, setRoomChangeMode] = useState(false);

  const loadAvailableRooms = useCallback(async () => {
    try {
      const rooms = await queryClient.ensureQueryData({
        queryKey: queryKeys.rooms.all,
        queryFn: () => RoomsService.getAllRooms(),
        staleTime: queryStaleTime.standard,
      });
      // Filter out the current room
      const otherRooms = rooms.filter((r) => r.id !== roomId);

      // Filter rooms that are truly available for room change
      // Backend requires status === 'available', so we must match that
      const filtered = otherRooms.filter((r) => (r.status || 'available') === 'available');

      // Sort rooms by room number ascending
      const sorted = [...filtered].sort((a, b) => {
        const numA = parseInt(a.room_number, 10);
        const numB = parseInt(b.room_number, 10);
        if (!isNaN(numA) && !isNaN(numB)) {
          return numA - numB;
        }
        return a.room_number.localeCompare(b.room_number);
      });

      setAvailableRooms(sorted);
    } catch (err) {
      console.error('Failed to load available rooms:', err);
    }
  }, [queryClient, roomId]);

  const loadRoomDetails = useCallback(async () => {
    if (!roomId) return;

    try {
      setLoadingDetails(true);
      const details = await queryClient.ensureQueryData({
        queryKey: queryKeys.rooms.detailedStatus(roomId),
        queryFn: () => RoomsService.getRoomDetailedStatus(roomId),
        staleTime: queryStaleTime.realtime,
      });
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
    } catch (err) {
      console.error('Failed to load room details:', err);
    } finally {
      setLoadingDetails(false);
    }
  }, [queryClient, roomId]);

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
  }, [open, roomId, loadRoomDetails]);

  // Load available rooms when room change mode is activated
  useEffect(() => {
    if (roomChangeMode) {
      loadAvailableRooms();
    }
  }, [roomChangeMode, loadAvailableRooms]);

  const handleUpdateStatus = async () => {
    if (!roomId) return;

    // Validation: Cannot change from other status to available
    if (currentStatus && currentStatus !== 'available' && newStatus === 'available') {
      setError(t('roomEvent.errToAvailable'));
      return;
    }

    // Validation: Cannot modify occupied rooms UNLESS setting occupied again (to update dates)
    if (currentStatus === 'occupied' && newStatus !== 'occupied') {
      setError(t('roomEvent.errOccupied'));
      return;
    }

    // Validation: Can only change from available to other statuses (exception: occupied can update its dates)
    if (currentStatus !== 'available' && !(currentStatus === 'occupied' && newStatus === 'occupied')) {
      setError(t('roomEvent.errOnlyAvailable'));
      return;
    }

    // Validate required fields based on status
    if (newStatus === 'reserved') {
      if (!reservedStartDate || !reservedEndDate) {
        setError(t('roomEvent.errReservedDates'));
        return;
      }
      if (new Date(reservedEndDate) < new Date(reservedStartDate)) {
        setError(t('roomEvent.errEndAfterStart'));
        return;
      }
    }

    if (newStatus === 'occupied') {
      if (!reservedStartDate || !reservedEndDate) {
        setError(t('roomEvent.errOccupiedDates'));
        return;
      }
      if (new Date(reservedEndDate) < new Date(reservedStartDate)) {
        setError(t('roomEvent.errEndAfterStart'));
        return;
      }
    }

    if (newStatus === 'maintenance') {
      if (!maintenanceStartDate || maintenanceStartDate.trim() === '' || !maintenanceEndDate || maintenanceEndDate.trim() === '') {
        setError(t('roomEvent.errMaintenanceDates'));
        return;
      }
      if (new Date(maintenanceEndDate) < new Date(maintenanceStartDate)) {
        setError(t('roomEvent.errEndAfterStart'));
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
      };

      await RoomsService.updateRoomStatus(roomId, statusInput);
      invalidateRoomDependencies(queryClient);
      onSuccess();
      onClose();
    } catch (err) {
      setError(errorMessage(err, t('errors.updateStatus')));
    } finally {
      setLoading(false);
    }
  };

  const canChangeStatus = currentStatus === 'available';
  const isOccupied = currentStatus === 'occupied';
  const canEndMaintenance = currentStatus === 'maintenance' || currentStatus === 'reserved' || currentStatus === 'reserved_dirty';

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

      if (currentStatus === 'reserved_dirty') {
        await RoomsService.updateRoomStatus(roomId, {
          status: 'available',
          notes: 'Room cleaned before reserved guest check-in',
        });
      } else {
        await RoomsService.endMaintenance(roomId);
      }
      invalidateRoomDependencies(queryClient);

      // Show success animation
      await new Promise(resolve => setTimeout(resolve, 400));

      onSuccess();
      onClose();
    } catch (err) {
      setError(errorMessage(err, t('errors.endMaintenance')));
    } finally {
      setLoading(false);
    }
  };

  const handleRoomChange = async () => {
    if (!roomId || !targetRoomId) {
      setError(t('roomEvent.selectTarget'));
      return;
    }

    try {
      setLoading(true);
      setError(null);

      await RoomsService.executeRoomChange(roomId, targetRoomId);
      invalidateRoomDependencies(queryClient);

      setRoomChangeMode(false);
      onSuccess();
      onClose();
    } catch (err) {
      console.error('Room change error:', err);
      setError(errorMessage(err, t('errors.executeRoomChange')));
    } finally {
      setLoading(false);
    }
  };

  const handleCheckInGuest = async () => {
    if (!roomId || !detailedStatus?.current_booking?.id) {
      setError(t('roomEvent.noBooking'));
      return;
    }

    const booking = detailedStatus.current_booking;

    try {
      setLoading(true);
      setError(null);

      // Call the dedicated check-in endpoint
      await BookingsService.checkInGuest(booking.id);
      invalidateBookingDependencies(queryClient);

      onSuccess();
      onClose();
    } catch (err) {
      console.error('Failed to check in guest:', err);
      setError(t('errors.checkInDetail', { detail: errorMessage(err, t('errors.unknown')) }));
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
      sx={{
        '& .MuiDialog-paper': {
          transition: 'all 0.3s ease-in-out',
        },
      }}
      slotProps={{
        transition: {
          timeout: {
            enter: 400,
            exit: 300,
          },
        }
      }}
    >
      <DialogTitle>
        <Box
          sx={{
            display: "flex",
            alignItems: "center"
          }}>
          <SettingsIcon sx={{ mr: 1, color: 'primary.main' }} />
          <Typography variant="h6">
            {t('roomEvent.title', { room: roomNumber || roomId })}
          </Typography>
        </Box>
        {currentStatus && (
          <Chip
            label={getLocalizedStatusLabel(t, currentStatus).toUpperCase()}
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
            <Tab icon={<SettingsIcon />} label={t('roomEvent.tabStatus')} iconPosition="start" />
            <Tab icon={<HistoryIcon />} label={t('roomEvent.tabHistory')} iconPosition="start" />
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
                {t('roomEvent.occupiedTitle')}
              </Typography>
              <Typography variant="body2" sx={{ mb: 2 }}>
                {t('roomEvent.occupiedBody')}
              </Typography>
              <Button
                variant="contained"
                color="primary"
                onClick={() => setRoomChangeMode(true)}
                size="small"
                startIcon={<RoomChangeIcon />}
              >
                {t('roomEvent.changeRoom')}
              </Button>
            </Alert>
          )}

          {isOccupied && roomChangeMode && (
            <Box>
              <Alert severity="info" sx={{ mb: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                  {t('roomEvent.changeTitle')}
                </Typography>
                <Typography variant="body2">
                  {t('roomEvent.changeBody')}
                </Typography>
              </Alert>

              <FormControl fullWidth required sx={{ mb: 2 }}>
                <InputLabel>{t('roomEvent.targetRoom')}</InputLabel>
                <Select
                  value={targetRoomId}
                  onChange={(e) => setTargetRoomId(String(e.target.value))}
                  label={t('roomEvent.targetRoom')}
                >
                  {availableRooms.map((room) => (
                    <MenuItem key={room.id} value={String(room.id)}>
                      {t('guestDetails.roomOption', { number: room.room_number, type: room.room_type })}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              {availableRooms.length === 0 ? (
                <Alert severity="warning" sx={{ mb: 2 }}>
                  {t('roomEvent.noRoomsAvailable')}
                </Alert>
              ) : (
                <Alert severity="success" sx={{ mb: 2 }}>
                  {t('roomEvent.roomsAvailable', { count: availableRooms.length })}
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
                  {t('common:actions.cancel')}
                </Button>
                <Button
                  variant="contained"
                  color="primary"
                  onClick={handleRoomChange}
                  disabled={loading || !targetRoomId}
                  startIcon={loading ? <CircularProgress size={20} /> : null}
                >
                  {loading ? t('roomEvent.changing') : t('roomEvent.executeChange')}
                </Button>
              </Box>
            </Box>
          )}

          {canCheckInGuest && (
            <Alert severity="info" icon={<InfoIcon />}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                {t('roomEvent.readyTitle')}
              </Typography>
              <Typography variant="body2" sx={{ mb: 2 }}>
                {t('roomEvent.readyBody', { guest: detailedStatus?.current_booking?.guest_name })}
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
                  {loading ? t('roomEvent.checkingIn') : t('roomEvent.checkInGuest')}
                </Button>
                <Button
                  variant="outlined"
                  color="error"
                  onClick={handleEndMaintenance}
                  disabled={loading}
                  size="small"
                >
                  {t('roomEvent.cancelReservation')}
                </Button>
              </Box>
            </Alert>
          )}

          {!canChangeStatus && !isOccupied && !canCheckInGuest && canEndMaintenance && (
            <Alert severity="success" icon={<InfoIcon />}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                {currentStatus === 'reserved_dirty'
                  ? t('roomEvent.progressTitleReservedDirty')
                  : currentStatus === 'maintenance'
                    ? t('roomEvent.progressTitleMaintenance')
                    : t('roomEvent.progressTitleReserved')}
              </Typography>
              <Typography variant="body2">
                {currentStatus === 'reserved_dirty'
                  ? t('roomEvent.progressBodyReservedDirty')
                  : t('roomEvent.progressBodyOther', { status: getLocalizedStatusLabel(t, currentStatus || '').toLowerCase() })}
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
                {loading ? t('roomEvent.ending') : currentStatus === 'reserved_dirty' ? t('menu.markClean') : currentStatus === 'maintenance' ? t('roomEvent.endMaintenance') : t('roomEvent.endReserved')}
              </Button>
            </Alert>
          )}

          {!canChangeStatus && !isOccupied && !canEndMaintenance && (
            <Alert severity="info">
              {t('roomEvent.onlyAvailableNotice')}
            </Alert>
          )}

          {/* Room Details Card */}
          {loadingDetails ? (
            <LogoLoader variant="page" minHeight={100} />
          ) : detailedStatus && (
            <Card elevation={0} sx={{ bgcolor: 'var(--hotel-surface-raised)' }}>
              <CardContent>
                <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 600 }}>
                  {t('roomEvent.roomDetails')}
                </Typography>
                <Grid container spacing={1}>
                  <Grid size={6}>
                    <Typography variant="body2" sx={{
                      color: "text.secondary"
                    }}>{t('fields.roomType')}:</Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {detailedStatus.room_type}
                    </Typography>
                  </Grid>
                  {detailedStatus.current_booking && (
                    <>
                      <Grid size={6}>
                        <Typography variant="body2" sx={{
                          color: "text.secondary"
                        }}>{t('roomEvent.currentGuest')}:</Typography>
                      </Grid>
                      <Grid size={6}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {detailedStatus.current_booking.guest_name}
                        </Typography>
                      </Grid>
                      <Grid size={6}>
                        <Typography variant="body2" sx={{
                          color: "text.secondary"
                        }}>{t('complimentary.checkInDate')}:</Typography>
                      </Grid>
                      <Grid size={6}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {formatHotelDate(detailedStatus.current_booking.check_in_date)}
                        </Typography>
                      </Grid>
                      <Grid size={6}>
                        <Typography variant="body2" sx={{
                          color: "text.secondary"
                        }}>{t('complimentary.checkOutDate')}:</Typography>
                      </Grid>
                      <Grid size={6}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {formatHotelDate(detailedStatus.current_booking.check_out_date)}
                        </Typography>
                      </Grid>
                    </>
                  )}
                  {detailedStatus.next_booking && (
                    <>
                      <Grid size={6}>
                        <Typography variant="body2" sx={{
                          color: "text.secondary"
                        }}>{t('roomEvent.nextBooking')}:</Typography>
                      </Grid>
                      <Grid size={6}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {t('roomEvent.nextBookingValue', { guest: detailedStatus.next_booking.guest_name, date: formatHotelDate(detailedStatus.next_booking.check_in_date) })}
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
                  {t('roomEvent.changeStatusTitle')}
                </Typography>
                <Alert severity="info" sx={{ mb: 2 }}>
                  {t('roomEvent.changeStatusInfo')}
                </Alert>
                <Grid container spacing={2}>
                  <Grid size={12}>
                    <FormControl fullWidth>
                      <InputLabel>{t('roomEvent.newStatus')}</InputLabel>
                      <Select
                        value={newStatus}
                        onChange={(e) => setNewStatus(e.target.value as typeof newStatus)}
                        label={t('roomEvent.newStatus')}
                      >
                        <MenuItem value="maintenance">{getLocalizedStatusLabel(t, 'maintenance')}</MenuItem>
                        <MenuItem value="occupied">{getLocalizedStatusLabel(t, 'occupied')}</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid size={12}>
                    <Alert severity="info" sx={{ mt: 0 }}>
                      <Typography variant="body2">
                        <strong>{t('roomEvent.reserveHintTitle')}</strong> {t('roomEvent.reserveHintBody')}
                      </Typography>
                    </Alert>
                  </Grid>

                  {/* Reserved and Occupied status - show date range */}
                  {(newStatus === 'reserved' || newStatus === 'occupied') && (
                    <>
                      <Grid size={12}>
                        <Typography variant="caption" color="primary" sx={{ display: 'block', mb: 1 }}>
                          {newStatus === 'occupied'
                            ? t('roomEvent.occupiedDatesHint')
                            : t('roomEvent.reservedDatesHint')}
                        </Typography>
                      </Grid>
                      <Grid size={6}>
                        <TextField
                          fullWidth
                          type="datetime-local"
                          label={t('roomEvent.startDateTime')}
                          value={reservedStartDate}
                          onChange={(e) => setReservedStartDate(e.target.value)}
                          required
                          slotProps={{
                            inputLabel: { shrink: true }
                          }}
                        />
                      </Grid>
                      <Grid size={6}>
                        <TextField
                          fullWidth
                          type="datetime-local"
                          label={t('roomEvent.endDateTime')}
                          value={reservedEndDate}
                          onChange={(e) => setReservedEndDate(e.target.value)}
                          required
                          slotProps={{
                            inputLabel: { shrink: true }
                          }}
                        />
                      </Grid>
                    </>
                  )}

                  {/* Maintenance status - show date range */}
                  {newStatus === 'maintenance' && (
                    <>
                      <Grid size={12}>
                        <Typography variant="caption" color="primary" sx={{ display: 'block', mb: 1 }}>
                          {t('roomEvent.maintenanceDatesHint')}
                        </Typography>
                      </Grid>
                      <Grid size={6}>
                        <TextField
                          fullWidth
                          type="datetime-local"
                          label={t('roomEvent.maintenanceStart')}
                          value={maintenanceStartDate}
                          onChange={(e) => {
                            const newValue = e.target.value;
                            setMaintenanceStartDate(newValue);
                            setError(null); // Clear error when user starts typing
                          }}
                          required
                          error={!maintenanceStartDate && error !== null}
                          helperText={!maintenanceStartDate && error ? t('roomEvent.required') : t('roomEvent.maintenanceStartHint')}
                          slotProps={{
                            inputLabel: { shrink: true }
                          }}
                        />
                      </Grid>
                      <Grid size={6}>
                        <TextField
                          fullWidth
                          type="datetime-local"
                          label={t('roomEvent.maintenanceEnd')}
                          value={maintenanceEndDate}
                          onChange={(e) => {
                            const newValue = e.target.value;
                            setMaintenanceEndDate(newValue);
                            setError(null); // Clear error when user starts typing
                          }}
                          required
                          error={!maintenanceEndDate && error !== null}
                          helperText={!maintenanceEndDate && error ? t('roomEvent.required') : t('roomEvent.maintenanceEndHint')}
                          slotProps={{
                            inputLabel: { shrink: true }
                          }}
                        />
                      </Grid>
                    </>
                  )}

                  <Grid size={12}>
                    <TextField
                      fullWidth
                      label={t('roomEvent.statusNotes')}
                      multiline
                      rows={3}
                      value={statusNotes}
                      onChange={(e) => setStatusNotes(e.target.value)}
                      placeholder={t('roomEvent.statusNotesPlaceholder')}
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
          {t('common:actions.cancel')}
        </Button>
        {!isOccupied && canChangeStatus && (
          <Button
            onClick={handleUpdateStatus}
            variant="contained"
            disabled={loading}
            startIcon={loading ? <CircularProgress size={20} /> : <SettingsIcon />}
          >
            {loading ? t('roomEvent.updating') : t('roomEvent.updateStatus')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default RoomEventDialog;

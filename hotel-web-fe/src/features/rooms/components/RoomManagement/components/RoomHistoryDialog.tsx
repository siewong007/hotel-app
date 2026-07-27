import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Typography,
  IconButton,
  CircularProgress,
  Alert,
  Paper,
  Grid,
  Divider,
  Button,
  Stack,
  Chip,
} from '@mui/material';
import {
  History as HistoryIcon,
  Cancel as CancelIcon,
  Person as PersonIcon,
  Login as LoginIcon,
  CheckCircle as CheckCircleIcon,
  CleaningServices as CleaningIcon,
  Build as MaintenanceIcon,
  EventAvailable as BookingIcon,
} from '@mui/icons-material';
import { Room, RoomHistory, BookingWithDetails } from '../../../../../types';

interface RoomHistoryDialogProps {
  open: boolean;
  onClose: () => void;
  room: Room | null;
  loading: boolean;
  history: RoomHistory[];
  currentBooking?: BookingWithDetails;
  onViewGuestDetails: (guestId: string | number) => void;
}

const RoomHistoryDialog: React.FC<RoomHistoryDialogProps> = ({
  open,
  onClose,
  room,
  loading,
  history,
  currentBooking,
  onViewGuestDetails,
}) => {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ bgcolor: 'primary.main', color: 'white', py: 2, px: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, flexDirection: 'column' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <HistoryIcon sx={{ fontSize: 28 }} />
              <Typography variant="h6" component="span" sx={{ fontWeight: 600 }}>
                Room History - {room?.room_number}
              </Typography>
            </Box>
            <Typography variant="caption" sx={{ opacity: 0.9, ml: 5 }}>
              {room?.room_type} • Current Status: {room?.status || 'Unknown'}
            </Typography>
          </Box>
          <IconButton
            onClick={onClose}
            sx={{ color: 'white' }}
          >
            <CancelIcon />
          </IconButton>
        </Box>
      </DialogTitle>
      <DialogContent sx={{ p: 0 }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
            <CircularProgress />
          </Box>
        ) : history.length === 0 ? (
          <Alert severity="info" sx={{ m: 2 }}>
            No history records found for this room
          </Alert>
        ) : (
          <Box sx={{ p: 2 }}>
            {/* Current Status Section */}
            {room && (
              <Paper sx={{ p: 2, mb: 2, bgcolor: 'primary.50', borderLeft: 4, borderColor: 'primary.main' }}>
                <Typography variant="subtitle2" gutterBottom sx={{
                  fontWeight: 600
                }}>
                  Current Status
                </Typography>
                <Grid container spacing={2}>
                  <Grid size={6}>
                    <Typography variant="caption" sx={{
                      color: "text.secondary"
                    }}>Status</Typography>
                    <Typography variant="body2" sx={{
                      fontWeight: 600
                    }}>
                      {room.status?.toUpperCase() || 'UNKNOWN'}
                    </Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="caption" sx={{
                      color: "text.secondary"
                    }}>Available</Typography>
                    <Typography variant="body2" sx={{
                      fontWeight: 600
                    }}>
                      {room.available ? 'Yes' : 'No'}
                    </Typography>
                  </Grid>
                  {room.status_notes && (
                    <Grid size={12}>
                      <Typography variant="caption" sx={{
                        color: "text.secondary"
                      }}>Notes</Typography>
                      <Typography variant="body2">{room.status_notes}</Typography>
                    </Grid>
                  )}
                  {currentBooking && (
                    <>
                      <Grid size={12}>
                        <Divider sx={{ my: 1 }} />
                      </Grid>
                      <Grid size={6}>
                        <Typography variant="caption" sx={{
                          color: "text.secondary"
                        }}>Guest</Typography>
                        <Typography variant="body2" sx={{
                          fontWeight: 600
                        }}>
                          {currentBooking.guest_name}
                        </Typography>
                      </Grid>
                      <Grid size={6}>
                        <Typography variant="caption" sx={{
                          color: "text.secondary"
                        }}>Booking Period</Typography>
                        <Typography variant="body2">
                          {new Date(currentBooking.check_in_date).toLocaleDateString()} - {new Date(currentBooking.check_out_date).toLocaleDateString()}
                        </Typography>
                      </Grid>
                      <Grid size={12}>
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<PersonIcon />}
                          onClick={() => onViewGuestDetails(currentBooking.guest_id)}
                        >
                          View Guest Details
                        </Button>
                      </Grid>
                    </>
                  )}
                </Grid>
              </Paper>
            )}

            {/* History Timeline */}
            <Typography
              variant="subtitle2"
              gutterBottom
              sx={{
                fontWeight: 600,
                mt: 2,
                mb: 1
              }}>
              History Timeline
            </Typography>
            <Stack spacing={1}>
              {history.map((entry) => {
                const statusIcon = entry.to_status === 'occupied' ? <LoginIcon /> :
                                 entry.to_status === 'available' ? <CheckCircleIcon /> :
                                 entry.to_status === 'cleaning' || entry.to_status === 'reserved_dirty' ? <CleaningIcon /> :
                                 entry.to_status === 'maintenance' ? <MaintenanceIcon /> :
                                 entry.to_status === 'reserved' ? <BookingIcon /> :
                                 <HistoryIcon />;

                const statusColor = entry.to_status === 'occupied' ? '#FFA726' :
                                  entry.to_status === 'available' ? '#66BB6A' :
                                  entry.to_status === 'cleaning' || entry.to_status === 'reserved_dirty' ? '#FFEB3B' :
                                  entry.to_status === 'maintenance' ? '#EF5350' :
                                  entry.to_status === 'reserved' ? '#42A5F5' :
                                  '#BDBDBD';

                return (
                  <Paper
                    key={entry.id}
                    sx={{
                      p: 2,
                      borderLeft: 4,
                      borderColor: statusColor,
                      cursor: entry.guest_id ? 'pointer' : 'default',
                      '&:hover': entry.guest_id ? {
                        bgcolor: 'grey.50',
                        boxShadow: 2,
                      } : {},
                    }}
                    onClick={() => entry.guest_id && onViewGuestDetails(entry.guest_id)}
                  >
                    <Grid container spacing={1} sx={{
                      alignItems: "center"
                    }}>
                      <Grid>
                        <Box
                          sx={{
                            width: 40,
                            height: 40,
                            borderRadius: '50%',
                            bgcolor: statusColor,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'white',
                          }}
                        >
                          {statusIcon}
                        </Box>
                      </Grid>
                      <Grid size="grow">
                        <Typography variant="body2" sx={{
                          fontWeight: 600
                        }}>
                          {entry.from_status ? `${entry.from_status.toUpperCase()} → ${entry.to_status.toUpperCase()}` : entry.to_status.toUpperCase()}
                        </Typography>
                        <Typography variant="caption" sx={{
                          color: "text.secondary"
                        }}>
                          {new Date(entry.created_at).toLocaleString()}
                          {entry.changed_by_name && ` • By: ${entry.changed_by_name}`}
                        </Typography>
                        {entry.guest_name && (
                          <Typography
                            variant="caption"
                            sx={{
                              display: "block",
                              mt: 0.5
                            }}>
                            Guest: {entry.guest_name}
                            {entry.start_date && entry.end_date && (
                              <> • {new Date(entry.start_date).toLocaleDateString()} - {new Date(entry.end_date).toLocaleDateString()}</>
                            )}
                          </Typography>
                        )}
                        {entry.notes && (
                          <Typography
                            variant="caption"
                            sx={{
                              display: "block",
                              color: "text.secondary",
                              mt: 0.5
                            }}>
                            {entry.notes}
                          </Typography>
                        )}
                        {entry.guest_id && (
                          <Chip
                            label="Click to view guest details"
                            size="small"
                            sx={{ mt: 1 }}
                            icon={<PersonIcon />}
                          />
                        )}
                      </Grid>
                    </Grid>
                  </Paper>
                );
              })}
            </Stack>
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2, bgcolor: 'grey.50', borderTop: 1, borderColor: 'divider' }}>
        <Button onClick={onClose} variant="outlined">Close</Button>
      </DialogActions>
    </Dialog>
  );
};

export default RoomHistoryDialog;

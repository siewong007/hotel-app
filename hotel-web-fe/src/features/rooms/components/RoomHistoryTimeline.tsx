import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  Chip,
  CircularProgress,
  Alert,
  Stack,
  Avatar,
} from '@mui/material';
import {
  CalendarToday as ReservedIcon,
  CleaningServices as CleaningIcon,
  Build as MaintenanceIcon,
  SwapHoriz as ChangeRoomIcon,
  Warning as OutOfOrderIcon,
  CheckCircle as AvailableIcon,
  Block as OccupiedIcon,
  AutoMode as AutoIcon,
  Person as PersonIcon,
} from '@mui/icons-material';
import { HotelAPIService } from '../../../api';
import { RoomHistory } from '../../../types';

interface RoomHistoryTimelineProps {
  roomId: string;
}

const RoomHistoryTimeline: React.FC<RoomHistoryTimelineProps> = ({ roomId }) => {
  const [history, setHistory] = useState<RoomHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  const loadHistory = async () => {
    try {
      setLoading(true);
      const data = await HotelAPIService.getRoomHistory(roomId);
      setHistory(data);
      setError(null);
    } catch (err: any) {
      console.error('Failed to load room history:', err);
      // Handle network errors gracefully
      if (err.message && err.message.includes('fetch')) {
        setError('Room history feature is currently unavailable. Please ensure the backend is running and try again.');
      } else {
        setError(err.message || 'Failed to load room history');
      }
    } finally {
      setLoading(false);
    }
  };

  const getStatusIcon = (status: string) => {
    const iconProps = { fontSize: 20 };
    switch (status) {
      case 'available':
        return <AvailableIcon sx={iconProps} />;
      case 'occupied':
        return <OccupiedIcon sx={iconProps} />;
      case 'reserved':
        return <ReservedIcon sx={iconProps} />;
      case 'cleaning':
        return <CleaningIcon sx={iconProps} />;
      case 'maintenance':
        return <MaintenanceIcon sx={iconProps} />;
      case 'change_room':
        return <ChangeRoomIcon sx={iconProps} />;
      case 'out_of_order':
        return <OutOfOrderIcon sx={iconProps} />;
      default:
        return <AvailableIcon sx={iconProps} />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'available':
        return '#4CAF50';
      case 'occupied':
        return '#F44336';
      case 'reserved':
        return '#FFC107';
      case 'cleaning':
        return '#2196F3';
      case 'maintenance':
        return '#FF9800';
      case 'change_room':
        return '#9C27B0';
      case 'out_of_order':
        return '#9E9E9E';
      default:
        return '#9E9E9E';
    }
  };

  const formatStatusLabel = (status: string) => {
    if (status === 'change_room') return 'Room Change';
    if (status === 'out_of_order') return 'Out of Order';
    return status.charAt(0).toUpperCase() + status.slice(1);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" p={3}>
        <CircularProgress size={30} />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ m: 2 }}>
        {error}
      </Alert>
    );
  }

  if (history.length === 0) {
    return (
      <Alert severity="info" sx={{ m: 2 }}>
        No history records found for this room.
      </Alert>
    );
  }

  return (
    <Box sx={{ maxHeight: '500px', overflowY: 'auto', p: 2 }}>
      <Stack spacing={2}>
        {history.map((record, index) => (
          <Box key={record.id} sx={{ display: 'flex', gap: 2 }}>
            {/* Left side - Icon and Connector */}
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 40 }}>
              <Avatar
                sx={{
                  bgcolor: getStatusColor(record.to_status),
                  width: 40,
                  height: 40,
                }}
              >
                {getStatusIcon(record.to_status)}
              </Avatar>
              {index < history.length - 1 && (
                <Box
                  sx={{
                    width: 2,
                    flex: 1,
                    bgcolor: 'grey.300',
                    minHeight: 20,
                    mt: 1,
                  }}
                />
              )}
            </Box>

            {/* Right side - Content */}
            <Box sx={{ flex: 1, pb: 2 }}>
              {/* Timestamp */}
              <Typography variant="caption" color="text.secondary" display="block" mb={1}>
                {formatDate(record.created_at)}
                {record.is_auto_generated && (
                  <Chip
                    icon={<AutoIcon sx={{ fontSize: 14 }} />}
                    label="Auto"
                    size="small"
                    color="primary"
                    sx={{ ml: 1, height: 20 }}
                  />
                )}
              </Typography>

              {/* Main Content Card */}
              <Paper elevation={1} sx={{ p: 2, bgcolor: 'grey.50' }}>
                {/* Status Change */}
                <Box display="flex" alignItems="center" gap={1} mb={1.5}>
                  {record.from_status && (
                    <>
                      <Chip
                        label={formatStatusLabel(record.from_status)}
                        size="small"
                        sx={{
                          bgcolor: getStatusColor(record.from_status),
                          color: 'white',
                          fontWeight: 600,
                        }}
                      />
                      <Typography variant="body2" fontWeight="bold">→</Typography>
                    </>
                  )}
                  <Chip
                    label={formatStatusLabel(record.to_status)}
                    size="small"
                    sx={{
                      bgcolor: getStatusColor(record.to_status),
                      color: 'white',
                      fontWeight: 600,
                    }}
                  />
                </Box>

                {/* Details */}
                <Stack spacing={0.5}>
                  {/* Guest Information */}
                  {record.guest_name && (
                    <Box display="flex" alignItems="center" gap={0.5}>
                      <PersonIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                      <Typography variant="body2">
                        Guest: <strong>{record.guest_name}</strong>
                      </Typography>
                    </Box>
                  )}

                  {/* Booking ID */}
                  {record.booking_id && (
                    <Typography variant="body2" color="text.secondary">
                      Booking: #{record.booking_id}
                    </Typography>
                  )}

                  {/* Reward Used */}
                  {record.reward_name && (
                    <Typography variant="body2" color="text.secondary">
                      Reward: {record.reward_name}
                    </Typography>
                  )}

                  {/* Date Range (for reserved/maintenance) */}
                  {record.start_date && record.end_date && (
                    <Typography variant="body2" color="text.secondary">
                      Period: {new Date(record.start_date).toLocaleDateString()} - {new Date(record.end_date).toLocaleDateString()}
                    </Typography>
                  )}

                  {/* Target Room (for room changes) */}
                  {record.target_room_number && (
                    <Typography variant="body2" color="text.secondary">
                      Moved to: Room {record.target_room_number}
                    </Typography>
                  )}

                  {/* Notes */}
                  {record.notes && (
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ mt: 1, fontStyle: 'italic', borderLeft: '3px solid', borderColor: 'grey.400', pl: 1 }}
                    >
                      "{record.notes}"
                    </Typography>
                  )}

                  {/* Changed By */}
                  {record.changed_by_name && (
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                      Changed by: {record.changed_by_name}
                    </Typography>
                  )}
                </Stack>
              </Paper>
            </Box>
          </Box>
        ))}
      </Stack>
    </Box>
  );
};

export default RoomHistoryTimeline;

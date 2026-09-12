import React, { useMemo, useState } from 'react';
import {
  Box,
  Chip,
  IconButton,
  InputAdornment,
  Paper,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Edit as EditIcon,
  Delete as DeleteIcon,
  Search as SearchIcon,
} from '@mui/icons-material';
import type { BookingWithDetails } from '../../../../types';
import { filterAndSortBookings, getStatusColor, getStatusLabel } from './utils';
import { formatDateRange } from '../../../../utils/formatters';
import type { SortField, SortOrder } from './types';

interface ComplimentaryBookingsTableProps {
  bookings: BookingWithDetails[];
  loading?: boolean;
  onEdit: (booking: BookingWithDetails) => void;
  onRemove: (booking: BookingWithDetails) => void;
}

const ComplimentaryBookingsTable: React.FC<ComplimentaryBookingsTableProps> = ({
  bookings,
  loading = false,
  onEdit,
  onRemove,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const filteredBookings = useMemo(
    () => filterAndSortBookings(bookings, searchQuery, sortField, sortOrder),
    [bookings, searchQuery, sortField, sortOrder]
  );

  const sortableHeader = (field: SortField, label: string) => (
    <TableSortLabel
      active={sortField === field}
      direction={sortField === field ? sortOrder : 'asc'}
      onClick={() => handleSort(field)}
    >
      <strong>{label}</strong>
    </TableSortLabel>
  );

  return (
    <>
      <TextField
        fullWidth
        variant="outlined"
        placeholder="Search by guest, booking number, or room..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        sx={{ mb: 2 }}
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon />
              </InputAdornment>
            ),
          }
        }}
      />

      <TableContainer component={Paper}>
        <Table aria-busy={loading || undefined}>
          <TableHead>
            <TableRow sx={{ bgcolor: 'grey.50' }}>
              <TableCell>{sortableHeader('created_at', 'Booking #')}</TableCell>
              <TableCell>{sortableHeader('guest_name', 'Guest')}</TableCell>
              <TableCell>{sortableHeader('room_number', 'Room')}</TableCell>
              <TableCell><strong>Dates</strong></TableCell>
              <TableCell>{sortableHeader('complimentary_nights', 'Comp. Nights')}</TableCell>
              <TableCell><strong>Reason</strong></TableCell>
              <TableCell>{sortableHeader('status', 'Status')}</TableCell>
              <TableCell><strong>Actions</strong></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={`loading-${i}`}>
                  {Array.from({ length: 8 }).map((_, j) => (
                    <TableCell key={j}>
                      <Skeleton variant="text" width={`${88 - ((i + j) % 3) * 16}%`} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : filteredBookings.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} align="center">
                  <Typography
                    sx={{
                      color: "text.secondary",
                      py: 4
                    }}>
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
                    <Typography variant="caption" sx={{
                      color: "text.secondary"
                    }}>
                      {booking.guest_email}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{booking.room_number}</Typography>
                    <Typography variant="caption" sx={{
                      color: "text.secondary"
                    }}>
                      {booking.room_type}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {new Date(booking.check_in_date).toLocaleDateString()} -{' '}
                      {new Date(booking.check_out_date).toLocaleDateString()}
                    </Typography>
                    {booking.complimentary_start_date && booking.complimentary_end_date && (
                      <Typography variant="caption" sx={{
                        color: "success.main"
                      }}>
                        Comp: {formatDateRange(booking.complimentary_start_date, booking.complimentary_end_date)}
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
                      color={getStatusColor(booking.status as string)}
                    />
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                      <Tooltip title="Edit complimentary details">
                        <IconButton
                          size="small"
                          color="primary"
                          onClick={() => onEdit(booking)}
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Remove complimentary status">
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => onRemove(booking)}
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
    </>
  );
};

export default ComplimentaryBookingsTable;

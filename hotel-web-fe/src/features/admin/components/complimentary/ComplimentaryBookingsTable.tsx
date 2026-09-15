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
import { filterAndSortBookings, getStatusColor } from './utils';
import { formatDateRange } from '../../../../utils/formatters';
import { formatHotelDate } from '../../../../utils/date';
import { statusLabel, useTranslation } from '../../../../i18n';
import type { SortField, SortOrder } from './types';
import { useIsPhone } from '../../../../hooks/useIsPhone';
import { MobileCardRow } from '../../../../components/data-table/MobileCardRow';

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
  const { t } = useTranslation('bookings');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const isPhone = useIsPhone();

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
        placeholder={t('comp.searchPlaceholder')}
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

      {isPhone ? (
        <Paper component="div" sx={{ overflow: 'hidden' }} aria-busy={loading || undefined}>
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <Box key={`loading-${i}`} sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
                <Skeleton variant="text" width="55%" />
                <Skeleton variant="text" width="80%" />
              </Box>
            ))
          ) : filteredBookings.length === 0 ? (
            <Typography sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>
              {t('comp.empty')}
            </Typography>
          ) : (
            filteredBookings.map((booking) => (
              <MobileCardRow
                key={booking.id}
                title={`${booking.guest_name} · ${booking.booking_number}`}
                subtitle={`${t('list.roomNumber', { number: booking.room_number })} ${booking.room_type ?? ''} · ${formatHotelDate(booking.check_in_date)} – ${formatHotelDate(booking.check_out_date)}`}
                meta={
                  booking.complimentary_start_date && booking.complimentary_end_date
                    ? `${t('comp.compNights', { count: booking.complimentary_nights || 0 })} · ${formatDateRange(booking.complimentary_start_date, booking.complimentary_end_date)}`
                    : t('comp.compNights', { count: booking.complimentary_nights || 0 })
                }
                status={
                  <Chip
                    label={statusLabel(t, 'booking', booking.status as string)}
                    size="small"
                    color={getStatusColor(booking.status as string)}
                  />
                }
                footer={
                  <>
                    <Tooltip title={t('comp.editAria')}>
                      <IconButton size="small" color="primary" aria-label={t('comp.editAria')} onClick={() => onEdit(booking)}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={t('comp.removeAria')}>
                      <IconButton size="small" color="error" aria-label={t('comp.removeAria')} onClick={() => onRemove(booking)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </>
                }
              />
            ))
          )}
        </Paper>
      ) : (
      <TableContainer component={Paper}>
        <Table aria-busy={loading || undefined}>
          <TableHead>
            <TableRow sx={{ bgcolor: 'var(--hotel-surface-sunken)' }}>
              <TableCell>{sortableHeader('created_at', t('comp.colBooking'))}</TableCell>
              <TableCell>{sortableHeader('guest_name', t('comp.colGuest'))}</TableCell>
              <TableCell>{sortableHeader('room_number', t('comp.colRoom'))}</TableCell>
              <TableCell><strong>{t('comp.colDates')}</strong></TableCell>
              <TableCell>{sortableHeader('complimentary_nights', t('comp.colCompNights'))}</TableCell>
              <TableCell><strong>{t('comp.colReason')}</strong></TableCell>
              <TableCell>{sortableHeader('status', t('comp.colStatus'))}</TableCell>
              <TableCell><strong>{t('comp.colActions')}</strong></TableCell>
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
                    {t('comp.empty')}
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
                      {formatHotelDate(booking.check_in_date)} -{' '}
                      {formatHotelDate(booking.check_out_date)}
                    </Typography>
                    {booking.complimentary_start_date && booking.complimentary_end_date && (
                      <Typography variant="caption" sx={{
                        color: "success.main"
                      }}>
                        {t('comp.compPrefix', { range: formatDateRange(booking.complimentary_start_date, booking.complimentary_end_date) })}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={t('comp.nights', { count: booking.complimentary_nights || 0 })}
                      size="small"
                      color="success"
                    />
                  </TableCell>
                  <TableCell>
                    <Tooltip title={booking.complimentary_reason || t('comp.noReason')}>
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
                      label={statusLabel(t, 'booking', booking.status as string)}
                      size="small"
                      color={getStatusColor(booking.status as string)}
                    />
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                      <Tooltip title={t('comp.editAria')}>
                        <IconButton
                          size="small"
                          color="primary"
                          onClick={() => onEdit(booking)}
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={t('comp.removeAria')}>
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
      )}
    </>
  );
};

export default ComplimentaryBookingsTable;

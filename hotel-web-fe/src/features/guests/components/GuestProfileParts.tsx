import React from 'react';
import {
  Box,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useCurrency } from '../../../hooks/useCurrency';
import { formatStatusLabel } from '../../../utils/formatters';
import type { GuestProfileBooking } from '../../../types';

/**
 * Shared display primitives for the guest profile aggregate — extracted from
 * GuestProfileDialog so the Guest 360 page (guestRelations) renders the same
 * stays table and metric tiles without duplicating them.
 */

/** Profile dates arrive as `YYYY-MM-DD` (NaiveDate) or full ISO timestamps;
 *  render both in local time rather than via UTC-shifting Date parsing. */
export const formatGuestProfileDate = (value?: string | null) => {
  if (!value) return 'N/A';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(
        Number(value.slice(0, 4)),
        Number(value.slice(5, 7)) - 1,
        Number(value.slice(8, 10))
      )
    : new Date(value);

  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

const formatStatus = (value?: string | null) =>
  formatStatusLabel(value, 'N/A');

export const ProfileMetric = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <Box
    sx={{
      border: '1px solid',
      borderColor: 'divider',
      borderRadius: 1,
      px: 2,
      py: 1.5,
      minHeight: 76,
    }}
  >
    <Typography
      variant="caption"
      sx={{
        color: "text.secondary",
        display: 'block'
      }}>
      {label}
    </Typography>
    <Typography variant="h6" sx={{ fontWeight: 800, mt: 0.5 }}>
      {value}
    </Typography>
  </Box>
);

export const ProfileDetailRow = ({ label, value }: { label: string; value: React.ReactNode }) => {
  const displayValue = value === null || value === undefined || value === '' ? 'N/A' : value;

  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography
        variant="caption"
        sx={{
          color: "text.secondary",
          display: 'block'
        }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
        {displayValue}
      </Typography>
    </Box>
  );
};

interface GuestReservationsTableProps {
  reservations: GuestProfileBooking[];
  /**
   * Optional per-row actions cell (e.g. the Guest 360 stays tab's
   * "Open in Bookings" deep link). The column is omitted entirely when unset.
   */
  renderBookingActions?: (booking: GuestProfileBooking) => React.ReactNode;
}

export const GuestReservationsTable: React.FC<GuestReservationsTableProps> = ({
  reservations,
  renderBookingActions,
}) => {
  const { format: formatCurrency } = useCurrency();
  const columnCount = renderBookingActions ? 6 : 5;

  return (
    <TableContainer sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Booking</TableCell>
            <TableCell>Dates</TableCell>
            <TableCell>Room</TableCell>
            <TableCell>Status</TableCell>
            <TableCell align="right">Balance</TableCell>
            {renderBookingActions && <TableCell align="right">Actions</TableCell>}
          </TableRow>
        </TableHead>
        <TableBody>
          {reservations.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columnCount} align="center" sx={{ py: 4 }}>
                <Typography variant="body2" sx={{
                  color: "text.secondary"
                }}>
                  No reservations found
                </Typography>
              </TableCell>
            </TableRow>
          ) : (
            reservations.map((booking) => (
              <TableRow key={booking.id} hover>
                <TableCell>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    {booking.booking_number || `#${booking.id}`}
                  </Typography>
                  <Typography variant="caption" sx={{
                    color: "text.secondary"
                  }}>
                    {booking.source ? formatStatus(booking.source) : 'Direct'}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2">
                    {formatGuestProfileDate(booking.check_in_date)} - {formatGuestProfileDate(booking.check_out_date)}
                  </Typography>
                  <Typography variant="caption" sx={{
                    color: "text.secondary"
                  }}>
                    {booking.nights} night{booking.nights === 1 ? '' : 's'}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2">Room {booking.room_number}</Typography>
                  <Typography variant="caption" sx={{
                    color: "text.secondary"
                  }}>
                    {booking.room_type || 'N/A'}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Chip label={formatStatus(booking.status)} size="small" variant="outlined" />
                </TableCell>
                <TableCell align="right">
                  <Typography
                    variant="body2"
                    sx={{ fontWeight: 700 }}
                    color={Number(booking.balance_due || 0) > 0 ? 'error.main' : 'success.main'}
                  >
                    {formatCurrency(Number(booking.balance_due || 0))}
                  </Typography>
                </TableCell>
                {renderBookingActions && (
                  <TableCell align="right">
                    {renderBookingActions(booking)}
                  </TableCell>
                )}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
};

export default GuestReservationsTable;

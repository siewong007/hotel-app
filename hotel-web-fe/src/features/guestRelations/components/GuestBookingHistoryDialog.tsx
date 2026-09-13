import React from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Skeleton,
  Typography,
} from '@mui/material';
import type { Guest } from '../../../types';
import { formatStatusLabel } from '../../../utils/formatters';
import { formatHotelDate } from '../../../utils/date';
import { useCurrency } from '../../../hooks/useCurrency';
import { DataTable, type ColumnDef } from '../../../components';
import { useGuestBookings } from '../../guests/hooks/useGuestQueries';

export type GuestBookingHistoryRow = {
  id: string | number;
  booking_number?: string | null;
  check_in_date: string;
  check_out_date: string;
  nights?: number | null;
  status: string;
  total_amount: string | number;
  created_at?: string;
  room_number?: string | null;
  room_type?: string | null;
};

const CHECKED_OUT_BOOKING_STATUSES = new Set(['checked_out', 'completed']);
const VOID_BOOKING_STATUSES = new Set(['voided', 'comp_void']);

const getBookingHistoryDateTime = (value?: string | null) => {
  if (!value) return Number.POSITIVE_INFINITY;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
};

const compareBookingHistoryRows = (a: GuestBookingHistoryRow, b: GuestBookingHistoryRow) => {
  const checkInDiff = getBookingHistoryDateTime(a.check_in_date) - getBookingHistoryDateTime(b.check_in_date);
  if (checkInDiff !== 0) return checkInDiff;

  const checkOutDiff = getBookingHistoryDateTime(a.check_out_date) - getBookingHistoryDateTime(b.check_out_date);
  if (checkOutDiff !== 0) return checkOutDiff;

  return Number(a.id) - Number(b.id);
};

const bookingStatusLabel = (status: string) => {
  const labels: Record<string, string> = {
    checked_out: 'Checked out',
    completed: 'Completed',
    voided: 'Voided',
    comp_void: 'Comp void',
    checked_in: 'Checked in',
    auto_checked_in: 'Checked in',
    confirmed: 'Reserved',
    pending: 'Pending',
  };
  return labels[status] ?? formatStatusLabel(status);
};

const bookingStatusChipColor = (status: string): 'default' | 'success' | 'warning' | 'info' => {
  if (CHECKED_OUT_BOOKING_STATUSES.has(status)) return 'success';
  if (VOID_BOOKING_STATUSES.has(status)) return 'default';
  if (status === 'checked_in' || status === 'auto_checked_in') return 'warning';
  return 'info';
};

// Dates are `YYYY-MM-DD` — formatHotelDate renders the literal calendar date.
const formatBookingHistoryDate = (value: string | null | undefined) => formatHotelDate(value, '—');

interface GuestBookingHistoryDialogProps {
  guest: Guest | null;
  open: boolean;
  onClose: () => void;
}

/** Stay-history dialog — same three-group breakdown the monolith showed in
 * its detail panel (checked out / void / everything else). */
const GuestBookingHistoryDialog: React.FC<GuestBookingHistoryDialogProps> = ({ guest, open, onClose }) => {
  const { format: formatCurrency } = useCurrency();
  const guestBookingsQuery = useGuestBookings(guest?.id, open && !!guest);
  const guestBookings = React.useMemo(
    () => (guestBookingsQuery.data ?? []) as GuestBookingHistoryRow[],
    [guestBookingsQuery.data],
  );
  const loading = guestBookingsQuery.isPending && open;

  const orderedGuestBookings = React.useMemo(
    () => [...guestBookings].sort(compareBookingHistoryRows),
    [guestBookings],
  );
  const checkedOutGuestBookings = React.useMemo(
    () => orderedGuestBookings.filter((booking) => CHECKED_OUT_BOOKING_STATUSES.has(booking.status)),
    [orderedGuestBookings],
  );
  const voidGuestBookings = React.useMemo(
    () => orderedGuestBookings.filter((booking) => VOID_BOOKING_STATUSES.has(booking.status)),
    [orderedGuestBookings],
  );
  const otherGuestBookings = React.useMemo(
    () => orderedGuestBookings.filter((booking) => (
      !CHECKED_OUT_BOOKING_STATUSES.has(booking.status) && !VOID_BOOKING_STATUSES.has(booking.status)
    )),
    [orderedGuestBookings],
  );

  const columns = React.useMemo<ColumnDef<GuestBookingHistoryRow, any>[]>(() => [
    {
      id: 'sequence',
      header: '#',
      accessorFn: (_booking, index) => index + 1,
      enableSorting: false,
      meta: { align: 'right' },
    },
    { id: 'booking_number', header: 'Booking #', accessorFn: (b: GuestBookingHistoryRow) => b.booking_number },
    {
      id: 'room',
      header: 'Room',
      accessorFn: (b: GuestBookingHistoryRow) => (
        b.room_number ? `${b.room_number}${b.room_type ? ` (${b.room_type})` : ''}` : '—'
      ),
    },
    {
      id: 'check_in',
      header: 'Check In',
      accessorFn: (b: GuestBookingHistoryRow) => getBookingHistoryDateTime(b.check_in_date),
      cell: (info) => formatBookingHistoryDate(info.row.original.check_in_date),
    },
    {
      id: 'check_out',
      header: 'Check Out',
      accessorFn: (b: GuestBookingHistoryRow) => getBookingHistoryDateTime(b.check_out_date),
      cell: (info) => formatBookingHistoryDate(info.row.original.check_out_date),
    },
    { id: 'nights', header: 'Nights', accessorFn: (b: GuestBookingHistoryRow) => b.nights ?? 0, meta: { align: 'right' } },
    {
      id: 'status',
      header: 'Status',
      accessorFn: (b: GuestBookingHistoryRow) => b.status,
      cell: (info) => {
        const status = String(info.getValue());
        return <Chip label={bookingStatusLabel(status)} color={bookingStatusChipColor(status)} size="small" />;
      },
    },
    {
      id: 'amount',
      header: 'Amount',
      accessorFn: (b: GuestBookingHistoryRow) => Number.parseFloat(String(b.total_amount)) || 0,
      cell: (info) => formatCurrency(info.getValue() as number),
      meta: { align: 'right' },
    },
  ], [formatCurrency]);

  const renderMobileCard = (b: GuestBookingHistoryRow) => (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {b.booking_number || `#${b.id}`}
        </Typography>
        <Chip label={bookingStatusLabel(b.status)} color={bookingStatusChipColor(b.status)} size="small" />
      </Box>
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>
        {b.room_number ? `${b.room_number}${b.room_type ? ` (${b.room_type})` : ''}` : '—'}
      </Typography>
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
        {formatBookingHistoryDate(b.check_in_date)} → {formatBookingHistoryDate(b.check_out_date)} · {b.nights ?? 0} nights
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 600, mt: 0.5 }}>
        {formatCurrency(Number.parseFloat(String(b.total_amount)) || 0)}
      </Typography>
    </Box>
  );

  const groups: Array<{
    key: string;
    title: string;
    rows: GuestBookingHistoryRow[];
    chipColor: 'success' | 'default' | 'info';
    empty: string;
  }> = [
    { key: 'checked-out', title: 'Checked out bookings', rows: checkedOutGuestBookings, chipColor: 'success', empty: 'No checked out bookings found for this guest.' },
    { key: 'void', title: 'Void bookings', rows: voidGuestBookings, chipColor: 'default', empty: 'No void bookings found for this guest.' },
    { key: 'other', title: 'Other bookings', rows: otherGuestBookings, chipColor: 'info', empty: 'No other bookings found for this guest.' },
  ];

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Booking History: {guest?.nick_name}</DialogTitle>
      <DialogContent>
        {loading ? (
          <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <Skeleton variant="text" width={190} height={26} />
            <Skeleton variant="rounded" height={150} />
          </Box>
        ) : guestBookings.length === 0 ? (
          <Alert severity="info" sx={{ mt: 2 }}>
            No bookings found for this guest.
          </Alert>
        ) : (
          <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
            {groups.map((group) => group.rows.length > 0 && (
              <Box key={group.key}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                    {group.title}
                  </Typography>
                  <Chip label={group.rows.length} size="small" color={group.chipColor} />
                </Box>
                <DataTable<GuestBookingHistoryRow>
                  data={group.rows}
                  columns={columns}
                  emptyMessage={group.empty}
                  getRowId={(row) => String(row.id)}
                  renderMobileCard={renderMobileCard}
                />
              </Box>
            ))}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};

export default GuestBookingHistoryDialog;

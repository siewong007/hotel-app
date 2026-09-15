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
import { statusLabel } from '../../../i18n/statusLabel';
import { useTranslation } from '../../../i18n/useTranslation';
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

const bookingStatusLabel = (t: ReturnType<typeof useTranslation>['t'], status: string) =>
  statusLabel(t, 'booking_history', status);

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
  const { t } = useTranslation('guests');
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
    { id: 'booking_number', header: t('history.cols.bookingNumber'), accessorFn: (b: GuestBookingHistoryRow) => b.booking_number },
    {
      id: 'room',
      header: t('history.cols.room'),
      accessorFn: (b: GuestBookingHistoryRow) => (
        b.room_number ? `${b.room_number}${b.room_type ? ` (${b.room_type})` : ''}` : '—'
      ),
    },
    {
      id: 'check_in',
      header: t('history.cols.checkIn'),
      accessorFn: (b: GuestBookingHistoryRow) => getBookingHistoryDateTime(b.check_in_date),
      cell: (info) => formatBookingHistoryDate(info.row.original.check_in_date),
    },
    {
      id: 'check_out',
      header: t('history.cols.checkOut'),
      accessorFn: (b: GuestBookingHistoryRow) => getBookingHistoryDateTime(b.check_out_date),
      cell: (info) => formatBookingHistoryDate(info.row.original.check_out_date),
    },
    { id: 'nights', header: t('history.cols.nights'), accessorFn: (b: GuestBookingHistoryRow) => b.nights ?? 0, meta: { align: 'right' } },
    {
      id: 'status',
      header: t('history.cols.status'),
      accessorFn: (b: GuestBookingHistoryRow) => b.status,
      cell: (info) => {
        const status = String(info.getValue());
        return <Chip label={bookingStatusLabel(t, status)} color={bookingStatusChipColor(status)} size="small" />;
      },
    },
    {
      id: 'amount',
      header: t('history.cols.amount'),
      accessorFn: (b: GuestBookingHistoryRow) => Number.parseFloat(String(b.total_amount)) || 0,
      cell: (info) => formatCurrency(info.getValue() as number),
      meta: { align: 'right' },
    },
  ], [formatCurrency, t]);

  const renderMobileCard = (b: GuestBookingHistoryRow) => (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {b.booking_number || `#${b.id}`}
        </Typography>
        <Chip label={bookingStatusLabel(t, b.status)} color={bookingStatusChipColor(b.status)} size="small" />
      </Box>
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>
        {b.room_number ? `${b.room_number}${b.room_type ? ` (${b.room_type})` : ''}` : '—'}
      </Typography>
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
        {formatBookingHistoryDate(b.check_in_date)} → {formatBookingHistoryDate(b.check_out_date)} · {t('stays.nights', { count: b.nights ?? 0 })}
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
    { key: 'checked-out', title: t('history.groups.checkedOut'), rows: checkedOutGuestBookings, chipColor: 'success', empty: t('history.groupEmpty.checkedOut') },
    { key: 'void', title: t('history.groups.void'), rows: voidGuestBookings, chipColor: 'default', empty: t('history.groupEmpty.void') },
    { key: 'other', title: t('history.groups.other'), rows: otherGuestBookings, chipColor: 'info', empty: t('history.groupEmpty.other') },
  ];

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{t('history.title', { name: guest?.nick_name ?? '' })}</DialogTitle>
      <DialogContent>
        {loading ? (
          <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <Skeleton variant="text" width={190} height={26} />
            <Skeleton variant="rounded" height={150} />
          </Box>
        ) : guestBookings.length === 0 ? (
          <Alert severity="info" sx={{ mt: 2 }}>
            {t('history.empty')}
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
        <Button onClick={onClose}>{t('common:actions.close')}</Button>
      </DialogActions>
    </Dialog>
  );
};

export default GuestBookingHistoryDialog;

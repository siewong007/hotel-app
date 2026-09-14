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
import { t as i18nT } from '../../../i18n/translate';
import { statusLabel } from '../../../i18n/statusLabel';
import { useTranslation } from '../../../i18n/useTranslation';
import { formatHotelDate } from '../../../utils/date';
import type { GuestProfileBooking } from '../../../types';

/**
 * Shared display primitives for the guest profile aggregate — extracted from
 * GuestProfileDialog so the Guest 360 page (guestRelations) renders the same
 * stays table and metric tiles without duplicating them.
 */

/** Profile dates arrive as `YYYY-MM-DD` (NaiveDate) or full ISO timestamps;
 *  formatHotelDate renders both in the hotel timezone and the active
 *  interface language. Call-time translation (non-React `t`) is safe here —
 *  callers re-render when the locale changes because they hold the hook. */
export const formatGuestProfileDate = (value?: string | null) =>
  formatHotelDate(value, i18nT('common.na', undefined, 'guests'));

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
  const { t } = useTranslation('guests');
  const displayValue = value === null || value === undefined || value === '' ? t('common.na') : value;

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
  const { t } = useTranslation('guests');
  const columnCount = renderBookingActions ? 6 : 5;

  return (
    <TableContainer sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>{t('stays.booking')}</TableCell>
            <TableCell>{t('stays.dates')}</TableCell>
            <TableCell>{t('stays.room')}</TableCell>
            <TableCell>{t('stays.status')}</TableCell>
            <TableCell align="right">{t('stays.balance')}</TableCell>
            {renderBookingActions && <TableCell align="right">{t('stays.actions')}</TableCell>}
          </TableRow>
        </TableHead>
        <TableBody>
          {reservations.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columnCount} align="center" sx={{ py: 4 }}>
                <Typography variant="body2" sx={{
                  color: "text.secondary"
                }}>
                  {t('stays.empty')}
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
                    {booking.source ? statusLabel(t, 'booking_source', booking.source) : t('stays.direct')}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2">
                    {formatGuestProfileDate(booking.check_in_date)} - {formatGuestProfileDate(booking.check_out_date)}
                  </Typography>
                  <Typography variant="caption" sx={{
                    color: "text.secondary"
                  }}>
                    {t('stays.nights', { count: booking.nights })}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2">{t('stays.roomNumber', { number: booking.room_number })}</Typography>
                  <Typography variant="caption" sx={{
                    color: "text.secondary"
                  }}>
                    {booking.room_type || t('common.na')}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Chip label={statusLabel(t, 'booking', booking.status)} size="small" variant="outlined" />
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

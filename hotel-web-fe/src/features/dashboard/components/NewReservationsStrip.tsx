import React, { useEffect, useState } from 'react';
import { Alert, Box, Card, CardContent, Typography } from '@mui/material';
import { Link } from '../../../router';
import {
  BookingsService,
  type NewReservationRow,
} from '../../../api/bookings.service';
import { useTranslation } from '../../../i18n';
import { formatHotelDate } from '../../../utils/date';

/**
 * The only staff surface filtered by `new_reservation_visible_time`.
 * Today's check-ins, the booking list, the room timeline and the room grid
 * are left alone.
 */
export const NewReservationsStrip: React.FC<{ refreshKey?: number }> = ({ refreshKey = 0 }) => {
  const { t } = useTranslation('dashboard');
  const [rows, setRows] = useState<NewReservationRow[]>([]);
  const [visibleFrom, setVisibleFrom] = useState('14:00');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    BookingsService.getNewReservations()
      .then((response) => {
        if (cancelled) return;
        setRows(response.reservations);
        setVisibleFrom(response.visible_from || '14:00');
        setError('');
      })
      .catch(() => {
        if (!cancelled) setError(t('frontDesk.newReservations.loadFailed'));
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey, t]);

  return (
    <Card sx={{ mb: 2, boxShadow: 1 }} data-testid="new-reservations-strip">
      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
        <Typography variant="subtitle2" component="h2" sx={{ fontWeight: 600 }}>
          {t('frontDesk.newReservations.title')}
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
          {t('frontDesk.newReservations.hint', { time: visibleFrom })}
        </Typography>
        {error ? (
          <Alert severity="warning">{error}</Alert>
        ) : rows.length === 0 ? (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {t('frontDesk.newReservations.empty')}
          </Typography>
        ) : (
          <Box>
            {rows.map((row) => (
              <Box
                key={row.id}
                component={Link}
                to={`/bookings/${row.id}`}
                sx={{
                  display: 'block',
                  py: 1,
                  textDecoration: 'none',
                  color: 'inherit',
                  borderBottom: '1px solid var(--hotel-border-subtle)',
                  '&:last-child': { borderBottom: 'none' },
                }}
              >
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {row.room_number
                    ? t('frontDesk.roomPrefix', { number: row.room_number })
                    : row.guest_name}
                  {row.room_number ? ` · ${row.guest_name}` : ''}
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {t('frontDesk.newReservations.stay', {
                    checkIn: formatHotelDate(row.check_in_date),
                    checkOut: formatHotelDate(row.check_out_date),
                  })}
                </Typography>
              </Box>
            ))}
          </Box>
        )}
      </CardContent>
    </Card>
  );
};

export default NewReservationsStrip;

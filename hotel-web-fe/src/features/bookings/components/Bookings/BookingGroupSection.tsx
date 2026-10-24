import { useEffect, useState } from 'react';
import { Box, Chip, Stack, Typography } from '@mui/material';
import { api } from '../../../../api/client';
import { statusLabel, useTranslation } from '../../../../i18n';
import { useCurrency } from '../../../../hooks/useCurrency';
import { toMoneyNumber } from '../../../../utils/money';

export interface StaffBookingGroupRoom {
  booking_id: number;
  booking_number: string;
  room_number?: string | null;
  room_type_name?: string | null;
  adults: number;
  children: number;
  extra_bed_count: number;
  status: string;
  payment_status: string;
  total_amount: string | number;
}

export interface StaffBookingGroup {
  group: {
    id: number;
    group_number: string;
    status: string;
    payment_status: string;
    room_count: number;
    total_amount: string | number;
  } | null;
  rooms: StaffBookingGroupRoom[];
}

export async function fetchBookingGroup(bookingId: number | string): Promise<StaffBookingGroup | null> {
  return await api.get(`bookings/${bookingId}/group`).json<StaffBookingGroup | null>();
}

/** Staff view of the multi-room booking this room belongs to; renders nothing for a single-room booking. */
export function BookingGroupSection({ bookingId }: { bookingId: number | string }) {
  const { t } = useTranslation('bookings');
  const { format: formatCurrency } = useCurrency();
  const [data, setData] = useState<{ id: number | string; value: StaffBookingGroup | null } | null>(null);
  useEffect(() => {
    let live = true;
    fetchBookingGroup(bookingId)
      .then((value) => { if (live) setData({ id: bookingId, value }); })
      .catch(() => { if (live) setData({ id: bookingId, value: null }); });
    return () => { live = false; };
  }, [bookingId]);
  const value = data?.id === bookingId ? data.value : null;
  if (!value?.group) return null;
  const { group, rooms } = value;
  return (
    <Box data-testid="staff-booking-group" sx={{ p: 2.5, borderBottom: '1px solid', borderColor: 'divider' }}>
      <Typography variant="overline" sx={{ color: 'text.secondary', fontWeight: 900 }}>
        {t('details.group.title', { number: group.group_number })}
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {t('details.group.summary', { count: group.room_count, total: formatCurrency(toMoneyNumber(group.total_amount)) })}
      </Typography>
      <Stack spacing={1} sx={{ mt: 1 }}>
        {rooms.map((room) => (
          <Stack key={room.booking_id} direction="row" spacing={1} sx={{ justifyContent: 'space-between', alignItems: 'center', opacity: room.status === 'voided' ? 0.6 : 1 }}>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontWeight: String(room.booking_id) === String(bookingId) ? 800 : 600 }}>
                {room.booking_number}
                {room.room_number ? ` · ${t('details.roomNumber', { number: room.room_number })}` : ''}
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {[room.room_type_name, t('details.group.guests', { adults: room.adults, children: room.children }), room.extra_bed_count > 0 ? t('details.group.extraBeds', { count: room.extra_bed_count }) : null].filter(Boolean).join(' · ')}
              </Typography>
            </Box>
            <Stack sx={{ alignItems: 'flex-end' }}>
              <Chip size="small" label={statusLabel(t, 'booking', room.status)} />
              <Typography variant="body2">{formatCurrency(toMoneyNumber(room.total_amount))}</Typography>
            </Stack>
          </Stack>
        ))}
      </Stack>
    </Box>
  );
}

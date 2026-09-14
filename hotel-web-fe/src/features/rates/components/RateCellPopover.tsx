import { Box, Divider, Popover, Typography } from '@mui/material';

import { useTranslation } from '../../../i18n/useTranslation';
import type { RateCalendarCell } from '../types';
import { formatCurrency } from '../../../utils/currency';
import { formatHotelDate } from '../../../utils/date';

export interface RateCellPopoverProps {
  cell: RateCalendarCell | null;
  roomTypeName: string;
  anchor: HTMLElement | null;
  currency: string;
  onClose(): void;
}

const Row = ({ label, value }: { label: string; value: string }) => (
  <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 3 }}>
    <Typography variant="body2" color="text.secondary">
      {label}
    </Typography>
    <Typography variant="body2" sx={{ fontWeight: 600 }}>
      {value}
    </Typography>
  </Box>
);

/** Read-only resolution breakdown for one calendar cell. */
export const RateCellPopover = ({
  cell,
  roomTypeName,
  anchor,
  currency,
  onClose,
}: RateCellPopoverProps) => {
  const { t } = useTranslation('rates');
  return (
  <Popover
    open={Boolean(anchor && cell)}
    anchorEl={anchor}
    onClose={onClose}
    anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
  >
    {cell && (
      <Box sx={{ p: 2, minWidth: 280 }}>
        <Typography sx={{ fontWeight: 800 }}>
          {roomTypeName} · {formatHotelDate(cell.stay_date)}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {cell.rate_plan_code === 'BASE'
            ? t('popover.baseFallback')
            : t('popover.ratePlan', { code: cell.rate_plan_code })}
        </Typography>
        <Divider sx={{ my: 1.5 }} />
        <Box sx={{ display: 'grid', gap: 0.75 }}>
          <Row label={t('popover.planRate')} value={formatCurrency(cell.plan_rate, currency)} />
          <Row
            label={t('popover.onlineOverride')}
            value={
              cell.custom_price !== null
                ? formatCurrency(cell.custom_price, currency)
                : '—'
            }
          />
          <Row
            label={t('popover.effectiveRate')}
            value={formatCurrency(cell.effective_rate, currency)}
          />
          <Divider sx={{ my: 0.5 }} />
          <Row
            label={t('popover.occupancy')}
            value={`${cell.sold_rooms}/${cell.physical_rooms} (${cell.occupancy_pct}%)`}
          />
          <Row label={t('popover.available')} value={String(cell.available_rooms)} />
          <Row
            label={t('popover.walkInReserved')}
            value={String(cell.walk_in_reserved_rooms)}
          />
          <Row
            label={t('popover.onlineBooking')}
            value={cell.online_booking_enabled ? t('popover.open') : t('popover.stopped')}
          />
        </Box>
      </Box>
    )}
  </Popover>
  );
};

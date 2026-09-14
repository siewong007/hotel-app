import { Box, Divider, Popover, Typography } from '@mui/material';

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
}: RateCellPopoverProps) => (
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
            ? 'Base rate fallback'
            : `Rate plan ${cell.rate_plan_code}`}
        </Typography>
        <Divider sx={{ my: 1.5 }} />
        <Box sx={{ display: 'grid', gap: 0.75 }}>
          <Row label="Plan rate" value={formatCurrency(cell.plan_rate, currency)} />
          <Row
            label="Online override"
            value={
              cell.custom_price !== null
                ? formatCurrency(cell.custom_price, currency)
                : '—'
            }
          />
          <Row
            label="Effective rate"
            value={formatCurrency(cell.effective_rate, currency)}
          />
          <Divider sx={{ my: 0.5 }} />
          <Row
            label="Occupancy"
            value={`${cell.sold_rooms}/${cell.physical_rooms} (${cell.occupancy_pct}%)`}
          />
          <Row label="Available" value={String(cell.available_rooms)} />
          <Row
            label="Walk-in reserved"
            value={String(cell.walk_in_reserved_rooms)}
          />
          <Row
            label="Online booking"
            value={cell.online_booking_enabled ? 'Open' : 'Stopped'}
          />
        </Box>
      </Box>
    )}
  </Popover>
);

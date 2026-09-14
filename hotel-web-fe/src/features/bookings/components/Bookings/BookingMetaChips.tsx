import { alpha, Chip, Tooltip } from '@mui/material';
import PublicIcon from '@mui/icons-material/Public';

import type { BookingChannelInfo } from '../../utils/bookingChannel';

/** Booking metadata chips shared by the list row (desktop) and the detail
 * panel. Per-chip exports let each call site keep its own ordering. */
export const BookingChannelChip = ({ channel }: { channel: BookingChannelInfo }) => (
  <Tooltip title={`Online booking via ${channel.name}`} arrow>
    <Chip
      size="small"
      icon={<PublicIcon />}
      label={channel.abbreviation}
      sx={{
        height: 22,
        minWidth: 60,
        maxWidth: 'none',
        flexShrink: 0,
        fontWeight: 900,
        bgcolor: channel.background,
        color: channel.color,
        border: `1px solid ${alpha(channel.color, 0.2)}`,
        '& .MuiChip-icon': {
          color: channel.color,
          fontSize: 14,
          ml: 0.65,
          mr: -0.35,
        },
        '& .MuiChip-label': {
          px: 0.8,
          overflow: 'visible',
        },
      }}
    />
  </Tooltip>
);

export const BillingChip = ({ label }: { label: string }) => (
  <Chip size="small" label={label} sx={{ height: 22, fontWeight: 800 }} />
);

export const NightAuditChip = () => (
  <Chip size="small" label="Night audit" variant="outlined" sx={{ height: 22, fontWeight: 900 }} />
);

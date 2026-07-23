import { Box, Paper, Stack, Typography, alpha, useTheme } from '@mui/material';
import BedOutlinedIcon from '@mui/icons-material/BedOutlined';
import DoorFrontOutlinedIcon from '@mui/icons-material/DoorFrontOutlined';
import LanguageOutlinedIcon from '@mui/icons-material/LanguageOutlined';

import type { OnlineInventoryAllocation } from '../types';

interface InventorySummaryProps {
  items: OnlineInventoryAllocation[];
}

const SummaryItem = ({
  label,
  value,
  helper,
  icon,
  color,
}: {
  label: string;
  value: number;
  helper: string;
  icon: React.ReactNode;
  color: string;
}) => (
  <Stack direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: 0 }}>
    <Box
      sx={{
        display: 'grid',
        placeItems: 'center',
        width: 42,
        height: 42,
        borderRadius: 2.5,
        color,
        bgcolor: alpha(color, 0.1),
        flex: '0 0 auto',
      }}
    >
      {icon}
    </Box>
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" fontWeight={700} sx={{ letterSpacing: 0.3 }}>
        {label.toUpperCase()}
      </Typography>
      <Stack direction="row" spacing={1} alignItems="baseline">
        <Typography variant="h5" fontWeight={800}>{value}</Typography>
        <Typography variant="body2" color="text.secondary" noWrap>{helper}</Typography>
      </Stack>
    </Box>
  </Stack>
);

export const InventorySummary = ({ items }: InventorySummaryProps) => {
  const theme = useTheme();
  const totals = items.reduce(
    (summary, item) => ({
      physical: summary.physical + item.physical_available_rooms,
      reserved: summary.reserved + item.walk_in_reserved_rooms,
      online: summary.online + (item.online_booking_enabled
        ? Math.max(0, item.physical_available_rooms - item.walk_in_reserved_rooms)
        : 0),
    }),
    { physical: 0, reserved: 0, online: 0 },
  );

  return (
    <Paper
      variant="outlined"
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' },
        gap: { xs: 2, sm: 1 },
        p: 2,
        borderRadius: 3,
      }}
    >
      <SummaryItem label="Physically free" value={totals.physical} helper="rooms" icon={<BedOutlinedIcon />} color={theme.palette.info.main} />
      <SummaryItem label="Held for walk-ins" value={totals.reserved} helper="rooms" icon={<DoorFrontOutlinedIcon />} color={theme.palette.warning.main} />
      <SummaryItem label="Available online" value={totals.online} helper="rooms" icon={<LanguageOutlinedIcon />} color={theme.palette.success.main} />
    </Paper>
  );
};

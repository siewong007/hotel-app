import { Box, Paper, Stack, Typography, alpha, useTheme } from '@mui/material';
import BedOutlinedIcon from '@mui/icons-material/BedOutlined';
import DoorFrontOutlinedIcon from '@mui/icons-material/DoorFrontOutlined';
import LanguageOutlinedIcon from '@mui/icons-material/LanguageOutlined';

export interface SummaryCellCount {
  physical: number;
  held: number;
  online: number;
}

interface InventorySummaryProps {
  cells: SummaryCellCount[];
  /** What the totals cover — "Visible window", "Selected cells", … */
  label?: string;
}

const SummaryItem = ({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: string;
}) => (
  <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', minWidth: 0 }}>
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
      <Typography
        variant="caption"
        sx={{ color: 'text.secondary', fontWeight: 700, letterSpacing: 0.3 }}
      >
        {label.toUpperCase()}
      </Typography>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline' }}>
        <Typography variant="h5" sx={{ fontWeight: 800 }}>{value}</Typography>
        <Typography variant="body2" noWrap sx={{ color: 'text.secondary' }}>
          room-nights
        </Typography>
      </Stack>
    </Box>
  </Stack>
);

/** Totals across a scope — the visible window by default, or the selection. */
export const InventorySummary = ({ cells, label = 'Visible window' }: InventorySummaryProps) => {
  const theme = useTheme();
  const totals = cells.reduce(
    (summary, cell) => ({
      physical: summary.physical + cell.physical,
      held: summary.held + cell.held,
      online: summary.online + cell.online,
    }),
    { physical: 0, held: 0, online: 0 },
  );

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        borderRadius: 3,
      }}
      aria-label={`${label} summary`}
    >
      <Typography
        variant="caption"
        sx={{ color: 'text.secondary', fontWeight: 700, letterSpacing: 0.4, display: 'block', mb: 1 }}
      >
        {label.toUpperCase()}
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' },
          gap: { xs: 2, sm: 1 },
        }}
      >
        <SummaryItem label="Physically free" value={totals.physical} icon={<BedOutlinedIcon />} color={theme.palette.info.main} />
        <SummaryItem label="Held for walk-ins" value={totals.held} icon={<DoorFrontOutlinedIcon />} color={theme.palette.warning.main} />
        <SummaryItem label="Available online" value={totals.online} icon={<LanguageOutlinedIcon />} color={theme.palette.success.main} />
      </Box>
    </Paper>
  );
};

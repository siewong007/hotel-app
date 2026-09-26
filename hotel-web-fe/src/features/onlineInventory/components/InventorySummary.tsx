import { Box, Paper, Stack, Typography, useTheme } from '@mui/material';

import { useTranslation } from '../../../i18n/useTranslation';
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
}) => {
  const { t } = useTranslation('onlineInventory');
  return (
    <Stack direction="row" spacing={{ xs: 0, sm: 1.5 }} sx={{ alignItems: 'center', minWidth: 0 }}>
      <Box
        sx={{
          // Phones show three compact columns — the icon tiles would squeeze
          // the numbers, so they only appear from `sm` up.
          display: { xs: 'none', sm: 'grid' },
          placeItems: 'center',
          width: 42,
          height: 42,
          borderRadius: 2.5,
          color,
          bgcolor: `color-mix(in srgb, ${color} 10%, transparent)`,
          flex: '0 0 auto',
        }}
      >
        {icon}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography
          variant="caption"
          sx={(theme) => ({
            color: 'text.secondary',
            fontWeight: 700,
            letterSpacing: 0.3,
            [theme.breakpoints.down('sm')]: { display: 'block', lineHeight: 1.25, fontSize: '0.66rem' },
          })}
        >
          {label.toUpperCase()}
        </Typography>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline' }}>
          <Typography
            variant="h5"
            component="div"
            sx={(theme) => ({ fontWeight: 800, [theme.breakpoints.down('sm')]: { fontSize: '1.3rem' } })}
          >
            {value}
          </Typography>
          <Typography
            variant="body2"
            noWrap
            sx={{ color: 'text.secondary', display: { xs: 'none', sm: 'block' } }}
          >
            {t('summary.roomNights')}
          </Typography>
        </Stack>
      </Box>
    </Stack>
  );
};

/** Totals across a scope — the visible window by default, or the selection. */
export const InventorySummary = ({ cells, label }: InventorySummaryProps) => {
  const { t } = useTranslation('onlineInventory');
  const theme = useTheme();
  const scopeLabel = label ?? t('summary.visibleWindow');
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
        p: { xs: 1.5, sm: 2 },
        borderRadius: 3,
      }}
      aria-label={t('summary.aria', { label: scopeLabel })}
    >
      <Stack direction="row" spacing={0.75} sx={{ alignItems: 'baseline', mb: 1 }}>
        <Typography
          variant="caption"
          sx={{ color: 'text.secondary', fontWeight: 700, letterSpacing: 0.4, display: 'block' }}
        >
          {scopeLabel.toUpperCase()}
        </Typography>
        {/* Phones drop the per-figure unit; name it once beside the scope. */}
        <Typography
          variant="caption"
          aria-hidden
          sx={{ color: 'text.secondary', display: { xs: 'block', sm: 'none' } }}
        >
          · {t('summary.roomNights')}
        </Typography>
      </Stack>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'repeat(3, minmax(0, 1fr))', sm: 'repeat(3, 1fr)' },
          gap: { xs: 1.5, sm: 1 },
        }}
      >
        <SummaryItem label={t('summary.physical')} value={totals.physical} icon={<BedOutlinedIcon />} color={theme.palette.info.main} />
        <SummaryItem label={t('summary.held')} value={totals.held} icon={<DoorFrontOutlinedIcon />} color={theme.palette.warning.main} />
        <SummaryItem label={t('summary.online')} value={totals.online} icon={<LanguageOutlinedIcon />} color={theme.palette.success.main} />
      </Box>
    </Paper>
  );
};

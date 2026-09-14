import {
  Button,
  Chip,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import KeyboardDoubleArrowLeftIcon from '@mui/icons-material/KeyboardDoubleArrowLeft';
import KeyboardDoubleArrowRightIcon from '@mui/icons-material/KeyboardDoubleArrowRight';
import RefreshIcon from '@mui/icons-material/Refresh';

import { useTranslation } from '../../../i18n/useTranslation';
import { GRID_DAYS } from '../constants';
import { formatLocalDate } from '../../../utils/date';
import { useIsPhone } from '../../../hooks/useIsPhone';
import { shiftDate } from '../utils';

interface GridToolbarProps {
  start: string;
  onStartChange(start: string): void;
  onRefresh(): void;
  refreshing: boolean;
  overridesOnly: boolean;
  onToggleOverrides(): void;
  selectedCount: number;
  /** Phone select-mode state — the Select/Done toggle renders only when both are given. */
  selectMode?: boolean;
  onToggleSelectMode?(): void;
}

const NAV_SX = { border: 1, borderColor: 'divider', borderRadius: 2, minWidth: 44, minHeight: 44 };

/** Date-window navigation + filters above the matrix. */
export const GridToolbar = ({
  start,
  onStartChange,
  onRefresh,
  refreshing,
  overridesOnly,
  onToggleOverrides,
  selectedCount,
  selectMode,
  onToggleSelectMode,
}: GridToolbarProps) => {
  const { t } = useTranslation('onlineInventory');
  const today = formatLocalDate();
  const isPhone = useIsPhone();

  if (isPhone) {
    // One nowrap row on phones: ±1-day nav, the date picker, then actions.
    // The ±GRID_DAYS jumps stay desktop-only — the date field covers them.
    return (
      <Stack
        direction="row"
        spacing={0.75}
        sx={{
          alignItems: 'center',
          flexWrap: 'nowrap',
          overflowX: 'auto',
          scrollbarWidth: 'none',
          '&::-webkit-scrollbar': { display: 'none' },
        }}
        role="toolbar"
        aria-label="Inventory window controls"
      >
        <IconButton
          aria-label="Previous day"
          onClick={() => onStartChange(shiftDate(start, -1))}
          sx={NAV_SX}
        >
          <ChevronLeftIcon />
        </IconButton>
        <IconButton
          aria-label="Next day"
          onClick={() => onStartChange(shiftDate(start, 1))}
          sx={NAV_SX}
        >
          <ChevronRightIcon />
        </IconButton>

        <TextField
          type="date"
          size="small"
          label="Start date"
          value={start}
          onChange={(event) => {
            if (event.target.value) onStartChange(event.target.value);
          }}
          slotProps={{ inputLabel: { shrink: true } }}
          sx={{ flex: 1, minWidth: 0 }}
        />

        {start !== today && (
          <Button
            size="small"
            onClick={() => onStartChange(today)}
            sx={{ minHeight: 44, flexShrink: 0 }}
          >
            Today
          </Button>
        )}

        <IconButton
          aria-label="Refresh"
          onClick={onRefresh}
          disabled={refreshing}
          sx={NAV_SX}
        >
          <RefreshIcon />
        </IconButton>

        <Chip
          label="Overrides only"
          variant={overridesOnly ? 'filled' : 'outlined'}
          color={overridesOnly ? 'primary' : 'default'}
          onClick={onToggleOverrides}
          aria-pressed={overridesOnly}
          sx={{ fontWeight: 700, minHeight: 44, flexShrink: 0 }}
        />

        {selectMode !== undefined && onToggleSelectMode !== undefined && (
          <Button
            size="small"
            variant={selectMode ? 'contained' : 'outlined'}
            aria-pressed={selectMode}
            onClick={onToggleSelectMode}
            sx={{ minHeight: 44, flexShrink: 0 }}
          >
            {selectMode ? 'Done' : 'Select'}
          </Button>
        )}
      </Stack>
    );
  }

  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{ alignItems: 'center', flexWrap: 'wrap' }}
      useFlexGap
      role="toolbar"
      aria-label={t('toolbar.aria')}
    >
      <Tooltip title={t('toolbar.backDays', { days: GRID_DAYS })}>
        <IconButton
          aria-label={t('toolbar.backDays', { days: GRID_DAYS })}
          onClick={() => onStartChange(shiftDate(start, -GRID_DAYS))}
          sx={NAV_SX}
        >
          <KeyboardDoubleArrowLeftIcon />
        </IconButton>
      </Tooltip>
      <Tooltip title={t('toolbar.prevDay')}>
        <IconButton
          aria-label={t('toolbar.prevDay')}
          onClick={() => onStartChange(shiftDate(start, -1))}
          sx={NAV_SX}
        >
          <ChevronLeftIcon />
        </IconButton>
      </Tooltip>

      <TextField
        type="date"
        size="small"
        label={t('toolbar.startDate')}
        value={start}
        onChange={(event) => {
          if (event.target.value) onStartChange(event.target.value);
        }}
        slotProps={{ inputLabel: { shrink: true } }}
        sx={{ width: 168 }}
      />

      <Tooltip title={t('toolbar.nextDay')}>
        <IconButton
          aria-label={t('toolbar.nextDay')}
          onClick={() => onStartChange(shiftDate(start, 1))}
          sx={NAV_SX}
        >
          <ChevronRightIcon />
        </IconButton>
      </Tooltip>
      <Tooltip title={t('toolbar.forwardDays', { days: GRID_DAYS })}>
        <IconButton
          aria-label={t('toolbar.forwardDays', { days: GRID_DAYS })}
          onClick={() => onStartChange(shiftDate(start, GRID_DAYS))}
          sx={NAV_SX}
        >
          <KeyboardDoubleArrowRightIcon />
        </IconButton>
      </Tooltip>

      {start !== today && (
        <Button size="small" onClick={() => onStartChange(today)} sx={{ minHeight: 44 }}>
          {t('toolbar.today')}
        </Button>
      )}

      <Chip
        label={t('toolbar.overridesOnly')}
        variant={overridesOnly ? 'filled' : 'outlined'}
        color={overridesOnly ? 'primary' : 'default'}
        onClick={onToggleOverrides}
        aria-pressed={overridesOnly}
        sx={{ fontWeight: 700, minHeight: 44 }}
      />

      <Button
        size="small"
        startIcon={<RefreshIcon />}
        onClick={onRefresh}
        disabled={refreshing}
        sx={{ minHeight: 44 }}
      >
        {t('common:actions.refresh')}
      </Button>

      {selectedCount > 0 && (
        <Typography variant="body2" sx={{ color: 'text.secondary', ml: 'auto' }}>
          {t('toolbar.selected', { count: selectedCount })}
        </Typography>
      )}
    </Stack>
  );
};

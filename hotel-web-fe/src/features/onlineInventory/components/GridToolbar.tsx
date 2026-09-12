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

import { GRID_DAYS } from '../constants';
import { formatLocalDate } from '../../../utils/date';
import { shiftDate } from '../utils';

interface GridToolbarProps {
  start: string;
  onStartChange(start: string): void;
  onRefresh(): void;
  refreshing: boolean;
  overridesOnly: boolean;
  onToggleOverrides(): void;
  selectedCount: number;
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
}: GridToolbarProps) => {
  const today = formatLocalDate();

  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{ alignItems: 'center', flexWrap: 'wrap' }}
      useFlexGap
      role="toolbar"
      aria-label="Inventory window controls"
    >
      <Tooltip title={`Back ${GRID_DAYS} days`}>
        <IconButton
          aria-label={`Back ${GRID_DAYS} days`}
          onClick={() => onStartChange(shiftDate(start, -GRID_DAYS))}
          sx={NAV_SX}
        >
          <KeyboardDoubleArrowLeftIcon />
        </IconButton>
      </Tooltip>
      <Tooltip title="Previous day">
        <IconButton
          aria-label="Previous day"
          onClick={() => onStartChange(shiftDate(start, -1))}
          sx={NAV_SX}
        >
          <ChevronLeftIcon />
        </IconButton>
      </Tooltip>

      <TextField
        type="date"
        size="small"
        label="Start date"
        value={start}
        onChange={(event) => {
          if (event.target.value) onStartChange(event.target.value);
        }}
        slotProps={{ inputLabel: { shrink: true } }}
        sx={{ width: 168 }}
      />

      <Tooltip title="Next day">
        <IconButton
          aria-label="Next day"
          onClick={() => onStartChange(shiftDate(start, 1))}
          sx={NAV_SX}
        >
          <ChevronRightIcon />
        </IconButton>
      </Tooltip>
      <Tooltip title={`Forward ${GRID_DAYS} days`}>
        <IconButton
          aria-label={`Forward ${GRID_DAYS} days`}
          onClick={() => onStartChange(shiftDate(start, GRID_DAYS))}
          sx={NAV_SX}
        >
          <KeyboardDoubleArrowRightIcon />
        </IconButton>
      </Tooltip>

      {start !== today && (
        <Button size="small" onClick={() => onStartChange(today)} sx={{ minHeight: 44 }}>
          Today
        </Button>
      )}

      <Chip
        label="Overrides only"
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
        Refresh
      </Button>

      {selectedCount > 0 && (
        <Typography variant="body2" sx={{ color: 'text.secondary', ml: 'auto' }}>
          {selectedCount} selected
        </Typography>
      )}
    </Stack>
  );
};

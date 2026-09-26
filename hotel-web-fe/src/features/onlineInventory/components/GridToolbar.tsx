import { useEffect, useState } from 'react';
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
import ChecklistIcon from '@mui/icons-material/Checklist';

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
  /** Inclusive bounds for the window start (YYYY-MM-DD). */
  minStart?: string;
  maxStart?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

interface StartDateFieldProps {
  start: string;
  minStart?: string;
  maxStart?: string;
  onStartChange(start: string): void;
  sx: object;
}

/**
 * The start-date input. Keeps its own draft so a half-typed year ("0002…")
 * never moves the window: only a complete date inside the allowed range is
 * committed; anything else shows an inline hint and snaps back on blur.
 */
const StartDateField = ({ start, minStart, maxStart, onStartChange, sx }: StartDateFieldProps) => {
  const { t } = useTranslation('onlineInventory');
  const [draft, setDraft] = useState(start);
  useEffect(() => setDraft(start), [start]);

  const inRange = (value: string) =>
    ISO_DATE.test(value) &&
    (minStart === undefined || value >= minStart) &&
    (maxStart === undefined || value <= maxStart);
  const outOfRange = draft !== '' && draft !== start && !inRange(draft);

  return (
    <TextField
      type="date"
      size="small"
      label={t('toolbar.startDate')}
      value={draft}
      onChange={(event) => {
        const value = event.target.value;
        setDraft(value);
        if (value && inRange(value)) onStartChange(value);
      }}
      onBlur={() => setDraft(start)}
      error={outOfRange}
      helperText={
        outOfRange && minStart && maxStart
          ? t('toolbar.dateRange', { min: minStart, max: maxStart })
          : undefined
      }
      slotProps={{
        inputLabel: { shrink: true },
        htmlInput: { min: minStart, max: maxStart },
      }}
      sx={sx}
    />
  );
};

const NAV_SX = { border: 1, borderColor: 'divider', borderRadius: 2, minWidth: 44, minHeight: 44 };
// Phone stepper buttons: a hard 44×44 box so four of them plus a readable date
// field still fit a 320px-wide content column.
const PHONE_NAV_SX = { ...NAV_SX, width: 44, height: 44, flexShrink: 0, p: 0 };

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
  minStart,
  maxStart,
}: GridToolbarProps) => {
  const { t } = useTranslation('onlineInventory');
  const today = formatLocalDate();
  const isPhone = useIsPhone();
  // The page clamps a jump that would overshoot; at the edge itself the
  // buttons that lead further out are disabled.
  const atMin = minStart !== undefined && start <= minStart;
  const atMax = maxStart !== undefined && start >= maxStart;

  if (isPhone) {
    // Two rows on phones. Row 1 is a full-width date stepper (±window jumps,
    // ±1 day, and a date field that always keeps a readable width). Row 2
    // wraps the actions so none of them — notably Select, the only way into
    // bulk edit on a phone — can be pushed off-screen by a narrow viewport.
    return (
      <Stack spacing={1} role="toolbar" aria-label={t('toolbar.controlsAria')}>
        <Stack
          direction="row"
          spacing={0.5}
          sx={{ alignItems: 'center' }}
          role="group"
          aria-label={t('toolbar.windowAria')}
        >
          <IconButton
            aria-label={t('toolbar.backDays', { days: GRID_DAYS })}
            onClick={() => onStartChange(shiftDate(start, -GRID_DAYS))}
            disabled={atMin}
            sx={PHONE_NAV_SX}
          >
            <KeyboardDoubleArrowLeftIcon />
          </IconButton>
          <IconButton
            aria-label={t('toolbar.prevDay')}
            onClick={() => onStartChange(shiftDate(start, -1))}
            disabled={atMin}
            sx={PHONE_NAV_SX}
          >
            <ChevronLeftIcon />
          </IconButton>

          <StartDateField
            start={start}
            minStart={minStart}
            maxStart={maxStart}
            onStartChange={onStartChange}
            sx={{
              flex: 1,
              minWidth: 116,
              '& .MuiInputBase-root': { minHeight: 44 },
              '& input': { px: 1, textAlign: 'center' },
            }}
          />

          <IconButton
            aria-label={t('toolbar.nextDay')}
            onClick={() => onStartChange(shiftDate(start, 1))}
            disabled={atMax}
            sx={PHONE_NAV_SX}
          >
            <ChevronRightIcon />
          </IconButton>
          <IconButton
            aria-label={t('toolbar.forwardDays', { days: GRID_DAYS })}
            onClick={() => onStartChange(shiftDate(start, GRID_DAYS))}
            disabled={atMax}
            sx={PHONE_NAV_SX}
          >
            <KeyboardDoubleArrowRightIcon />
          </IconButton>
        </Stack>

        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{ alignItems: 'center', flexWrap: 'wrap' }}
        >
          {selectMode !== undefined && onToggleSelectMode !== undefined && (
            <Button
              size="small"
              variant={selectMode ? 'contained' : 'outlined'}
              aria-pressed={selectMode}
              onClick={onToggleSelectMode}
              startIcon={<ChecklistIcon />}
              sx={{ minHeight: 44, flexShrink: 0 }}
            >
              {selectMode ? t('common:actions.done') : t('toolbar.select')}
            </Button>
          )}

          <Chip
            label={t('toolbar.overridesOnly')}
            variant={overridesOnly ? 'filled' : 'outlined'}
            color={overridesOnly ? 'primary' : 'default'}
            onClick={onToggleOverrides}
            aria-pressed={overridesOnly}
            sx={{ fontWeight: 700, minHeight: 44, borderRadius: 2, flexShrink: 0 }}
          />

          <IconButton
            aria-label={t('toolbar.refresh')}
            onClick={onRefresh}
            disabled={refreshing}
            sx={NAV_SX}
          >
            <RefreshIcon />
          </IconButton>

          {start !== today && (
            <Button
              size="small"
              onClick={() => onStartChange(today)}
              sx={{ minHeight: 44, flexShrink: 0 }}
            >
              {t('common:time.today')}
            </Button>
          )}
        </Stack>
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
        <span>
          <IconButton
            aria-label={t('toolbar.backDays', { days: GRID_DAYS })}
            onClick={() => onStartChange(shiftDate(start, -GRID_DAYS))}
            disabled={atMin}
            sx={NAV_SX}
          >
            <KeyboardDoubleArrowLeftIcon />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title={t('toolbar.prevDay')}>
        <span>
          <IconButton
            aria-label={t('toolbar.prevDay')}
            onClick={() => onStartChange(shiftDate(start, -1))}
            disabled={atMin}
            sx={NAV_SX}
          >
            <ChevronLeftIcon />
          </IconButton>
        </span>
      </Tooltip>

      <StartDateField
        start={start}
        minStart={minStart}
        maxStart={maxStart}
        onStartChange={onStartChange}
        sx={{ width: 168 }}
      />

      <Tooltip title={t('toolbar.nextDay')}>
        <span>
          <IconButton
            aria-label={t('toolbar.nextDay')}
            onClick={() => onStartChange(shiftDate(start, 1))}
            disabled={atMax}
            sx={NAV_SX}
          >
            <ChevronRightIcon />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title={t('toolbar.forwardDays', { days: GRID_DAYS })}>
        <span>
          <IconButton
            aria-label={t('toolbar.forwardDays', { days: GRID_DAYS })}
            onClick={() => onStartChange(shiftDate(start, GRID_DAYS))}
            disabled={atMax}
            sx={NAV_SX}
          >
            <KeyboardDoubleArrowRightIcon />
          </IconButton>
        </span>
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

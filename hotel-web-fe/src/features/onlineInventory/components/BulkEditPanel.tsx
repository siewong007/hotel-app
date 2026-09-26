import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Divider,
  InputAdornment,
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';

import { useTranslation } from '../../../i18n/useTranslation';
import type { CellKey, GridCellView, StagedEdit } from '../types';
import { projectBulkAction, weekdayOf, type BulkAction } from '../utils';
import { useCurrency } from '../../../hooks/useCurrency';

const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const WEEKDAY_COUNT = 7;

// Touch sizing below `md` (phones use this cluster in a bottom sheet, tablets
// under the grid): 44px controls; desktop keeps the compact small size.
const TOUCH_BUTTON_SX = { minHeight: { xs: 44, md: 'auto' }, whiteSpace: 'nowrap' } as const;
const touchFieldSx = (width: number) => ({
  width: { xs: 'auto', sm: width },
  flex: { xs: 1, sm: 'none' },
  '& .MuiInputBase-root': { minHeight: { xs: 44, md: 'auto' } },
});
/** Keeps a field and its action button on one line, even in the phone column. */
const PAIR_SX = { display: 'flex', alignItems: 'center', gap: 1 } as const;

interface BulkEditPanelProps {
  targets: GridCellView[];
  onApply(edits: Map<CellKey, StagedEdit>): void;
  onClear(): void;
}

interface BulkEditFieldsProps {
  targets: GridCellView[];
  onApply(edits: Map<CellKey, StagedEdit>): void;
}

/**
 * Bulk-action bar for the current cell selection. Everything stages edits —
 * nothing is saved until the review dialog confirms.
 */
export const BulkEditPanel = ({ targets, onApply, onClear }: BulkEditPanelProps) => {
  const { t } = useTranslation('onlineInventory');
  if (targets.length === 0) return null;

  return (
    <Paper
      elevation={4}
      sx={{ px: 2.5, py: 2, borderRadius: 3, border: 1, borderColor: 'divider' }}
      role="region"
      aria-label={t('bulk.aria')}
    >
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography sx={{ fontWeight: 800 }}>
            {t('bulk.cellsSelected', { count: targets.length })}
          </Typography>
          <Button size="small" onClick={onClear} sx={{ ml: 'auto', minHeight: { xs: 44, md: 'auto' } }}>
            {t('bulk.clearSelection')}
          </Button>
        </Stack>

        <Divider />

        <BulkEditFields targets={targets} onApply={onApply} />
      </Stack>
    </Paper>
  );
};

/**
 * The bulk-action field cluster: weekday scoping, open/close online, hold,
 * price, percentage/amount adjustments and reset, plus the skipped-cells
 * warning. Extracted so the phone bottom sheet can reuse it; assumes at
 * least one target (callers render nothing on an empty selection).
 */
export const BulkEditFields = ({ targets, onApply }: BulkEditFieldsProps) => {
  const { t } = useTranslation('onlineInventory');
  const { symbol } = useCurrency();
  const [days, setDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [hold, setHold] = useState('');
  const [price, setPrice] = useState('');
  const [percent, setPercent] = useState('');
  const [amount, setAmount] = useState('');
  const [skipped, setSkipped] = useState(0);

  const weekdayFilter = useMemo<ReadonlySet<number> | null>(
    () => (days.length === WEEKDAY_COUNT ? null : new Set(days)),
    [days],
  );
  const activeCount = useMemo(() => {
    if (weekdayFilter === null) return targets.length;
    return targets.filter((t) => weekdayFilter.has(weekdayOf(t.stay_date))).length;
  }, [targets, weekdayFilter]);

  // Same warning the single-cell editor shows: a hold above the rooms that
  // are physically free still stages (online availability just drops to
  // zero), but the user should know on how many days it overshoots.
  const holdValue = Number(hold);
  const overHeldCount = useMemo(() => {
    if (hold.trim() === '' || !Number.isFinite(holdValue)) return 0;
    const rooms = Math.max(0, Math.trunc(holdValue));
    return targets.filter(
      (target) =>
        (weekdayFilter === null || weekdayFilter.has(weekdayOf(target.stay_date))) &&
        rooms > target.physical,
    ).length;
  }, [hold, holdValue, targets, weekdayFilter]);

  const run = (action: BulkAction) => {
    const { edits, skipped: skippedCells } = projectBulkAction(targets, action, weekdayFilter);
    setSkipped(skippedCells);
    onApply(edits);
  };

  const numeric = (raw: string) => {
    const value = Number(raw);
    return raw.trim() === '' || !Number.isFinite(value) ? null : value;
  };

  return (
    <>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <ToggleButtonGroup
          size="small"
          value={days}
          onChange={(_, next: number[]) => setDays(next)}
          aria-label={t('bulk.daysAria')}
        >
          {WEEKDAY_KEYS.map((key, index) => (
            <ToggleButton
              key={key}
              value={index}
              aria-label={t(`bulk.days.${key}`)}
              sx={{ px: 1.25, minHeight: 44 }}
            >
              {t(`bulk.days.${key}`)}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        {weekdayFilter !== null && (
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {t('bulk.inScope', { active: activeCount, total: targets.length })}
          </Typography>
        )}
      </Stack>

      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        sx={{ alignItems: { xs: 'stretch', sm: 'center' }, flexWrap: 'wrap' }}
        useFlexGap
      >
        <Box sx={{ ...PAIR_SX, '& > *': { flex: { xs: 1, sm: 'none' } } }}>
          <Button variant="outlined" size="small" sx={TOUCH_BUTTON_SX} onClick={() => run({ kind: 'set_enabled', enabled: true })}>
            {t('bulk.openOnline')}
          </Button>
          <Button variant="outlined" size="small" sx={TOUCH_BUTTON_SX} onClick={() => run({ kind: 'set_enabled', enabled: false })}>
            {t('bulk.closeOnline')}
          </Button>
        </Box>

        <Divider orientation="vertical" flexItem sx={{ display: { xs: 'none', sm: 'block' } }} />

        <Box sx={PAIR_SX}>
          <TextField
            type="number"
            size="small"
            label={t('bulk.hold')}
            value={hold}
            onChange={(event) => setHold(event.target.value)}
            sx={touchFieldSx(88)}
            slotProps={{ htmlInput: { min: 0, step: 1, 'aria-label': t('bulk.setHold') } }}
          />
          <Button
            variant="outlined"
            size="small"
            sx={TOUCH_BUTTON_SX}
            disabled={numeric(hold) === null}
            onClick={() => run({ kind: 'set_hold', rooms: Number(hold) })}
          >
            {t('bulk.setHold')}
          </Button>
        </Box>

        <Divider orientation="vertical" flexItem sx={{ display: { xs: 'none', sm: 'block' } }} />

        <Box sx={PAIR_SX}>
          <TextField
            type="number"
            size="small"
            label={t('bulk.price')}
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            sx={touchFieldSx(120)}
            slotProps={{
              input: { startAdornment: <InputAdornment position="start">{symbol}</InputAdornment> },
              htmlInput: { min: 0.01, step: 0.01, 'aria-label': t('bulk.setPrice') },
            }}
          />
          <Button
            variant="outlined"
            size="small"
            sx={TOUCH_BUTTON_SX}
            disabled={numeric(price) === null || Number(price) <= 0}
            onClick={() => run({ kind: 'set_price', price: Number(price).toFixed(2) })}
          >
            {t('bulk.setPrice')}
          </Button>
        </Box>

        <Divider orientation="vertical" flexItem sx={{ display: { xs: 'none', sm: 'block' } }} />

        <Box sx={PAIR_SX}>
          <TextField
            type="number"
            size="small"
            label={t('bulk.percentLabel')}
            value={percent}
            onChange={(event) => setPercent(event.target.value)}
            sx={touchFieldSx(88)}
            slotProps={{
              input: { endAdornment: <InputAdornment position="end">%</InputAdornment> },
              htmlInput: { step: 1, 'aria-label': t('bulk.adjustPercentAria') },
            }}
          />
          <Button
            variant="outlined"
            size="small"
            sx={TOUCH_BUTTON_SX}
            disabled={numeric(percent) === null}
            onClick={() => run({ kind: 'adjust_price_percent', percent: Number(percent) })}
          >
            {t('bulk.applyPercent')}
          </Button>
        </Box>
        <Box sx={PAIR_SX}>
          <TextField
            type="number"
            size="small"
            label={t('bulk.amountLabel')}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            sx={touchFieldSx(112)}
            slotProps={{
              input: { startAdornment: <InputAdornment position="start">{symbol}</InputAdornment> },
              htmlInput: { step: 1, 'aria-label': t('bulk.adjustAmountAria') },
            }}
          />
          <Button
            variant="outlined"
            size="small"
            sx={TOUCH_BUTTON_SX}
            disabled={numeric(amount) === null}
            onClick={() => run({ kind: 'adjust_price_amount', amount: Number(amount).toFixed(2) })}
          >
            {t('bulk.applyAmount')}
          </Button>
        </Box>

        <Divider orientation="vertical" flexItem sx={{ display: { xs: 'none', sm: 'block' } }} />

        <Button variant="outlined" size="small" color="warning" sx={TOUCH_BUTTON_SX} onClick={() => run({ kind: 'reset' })}>
          {t('bulk.clearOverrides')}
        </Button>
      </Stack>

      {overHeldCount > 0 && (
        <Alert severity="warning" sx={{ py: 0 }}>
          {t('bulk.overHeld', { count: overHeldCount })}
        </Alert>
      )}

      {skipped > 0 && (
        <Alert severity="warning" sx={{ py: 0 }}>
          {t('bulk.skipped', { count: skipped })}
        </Alert>
      )}
    </>
  );
};

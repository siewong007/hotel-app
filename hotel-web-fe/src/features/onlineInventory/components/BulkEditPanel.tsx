import { useMemo, useState } from 'react';
import {
  Alert,
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

import type { CellKey, GridCellView, StagedEdit } from '../types';
import { projectBulkAction, weekdayOf, type BulkAction } from '../utils';
import { useCurrency } from '../../../hooks/useCurrency';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface BulkEditPanelProps {
  targets: GridCellView[];
  onApply(edits: Map<CellKey, StagedEdit>): void;
  onClear(): void;
}

/**
 * Bulk-action bar for the current cell selection. Everything stages edits —
 * nothing is saved until the review dialog confirms.
 */
export const BulkEditPanel = ({ targets, onApply, onClear }: BulkEditPanelProps) => {
  const { symbol } = useCurrency();
  const [days, setDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [hold, setHold] = useState('');
  const [price, setPrice] = useState('');
  const [percent, setPercent] = useState('');
  const [amount, setAmount] = useState('');
  const [skipped, setSkipped] = useState(0);

  const weekdayFilter = useMemo<ReadonlySet<number> | null>(
    () => (days.length === WEEKDAYS.length ? null : new Set(days)),
    [days],
  );
  const activeCount = useMemo(() => {
    if (weekdayFilter === null) return targets.length;
    return targets.filter((t) => weekdayFilter.has(weekdayOf(t.stay_date))).length;
  }, [targets, weekdayFilter]);

  if (targets.length === 0) return null;

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
    <Paper
      elevation={4}
      sx={{ px: 2.5, py: 2, borderRadius: 3, border: 1, borderColor: 'divider' }}
      role="region"
      aria-label="Bulk edit selected cells"
    >
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography sx={{ fontWeight: 800 }}>
            {targets.length} {targets.length === 1 ? 'cell' : 'cells'} selected
          </Typography>
          <ToggleButtonGroup
            size="small"
            value={days}
            onChange={(_, next: number[]) => setDays(next)}
            aria-label="Limit to weekdays"
          >
            {WEEKDAYS.map((label, index) => (
              <ToggleButton key={label} value={index} aria-label={label} sx={{ px: 1.25, minHeight: 44 }}>
                {label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          {weekdayFilter !== null && (
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {activeCount} of {targets.length} in scope
            </Typography>
          )}
          <Button size="small" onClick={onClear} sx={{ ml: 'auto' }}>
            Clear selection
          </Button>
        </Stack>

        <Divider />

        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }} useFlexGap>
          <Button variant="outlined" size="small" onClick={() => run({ kind: 'set_enabled', enabled: true })}>
            Open online
          </Button>
          <Button variant="outlined" size="small" onClick={() => run({ kind: 'set_enabled', enabled: false })}>
            Close online
          </Button>

          <Divider orientation="vertical" flexItem />

          <TextField
            type="number"
            size="small"
            label="Hold"
            value={hold}
            onChange={(event) => setHold(event.target.value)}
            sx={{ width: 88 }}
            slotProps={{ htmlInput: { min: 0, step: 1, 'aria-label': 'Set hold' } }}
          />
          <Button
            variant="outlined"
            size="small"
            disabled={numeric(hold) === null}
            onClick={() => run({ kind: 'set_hold', rooms: Number(hold) })}
          >
            Set hold
          </Button>

          <Divider orientation="vertical" flexItem />

          <TextField
            type="number"
            size="small"
            label="Price"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            sx={{ width: 120 }}
            slotProps={{
              input: { startAdornment: <InputAdornment position="start">{symbol}</InputAdornment> },
              htmlInput: { min: 0.01, step: 0.01, 'aria-label': 'Set price' },
            }}
          />
          <Button
            variant="outlined"
            size="small"
            disabled={numeric(price) === null || Number(price) <= 0}
            onClick={() => run({ kind: 'set_price', price: Number(price).toFixed(2) })}
          >
            Set price
          </Button>

          <Divider orientation="vertical" flexItem />

          <TextField
            type="number"
            size="small"
            label="±%"
            value={percent}
            onChange={(event) => setPercent(event.target.value)}
            sx={{ width: 88 }}
            slotProps={{
              input: { endAdornment: <InputAdornment position="end">%</InputAdornment> },
              htmlInput: { step: 1, 'aria-label': 'Adjust by percent' },
            }}
          />
          <Button
            variant="outlined"
            size="small"
            disabled={numeric(percent) === null}
            onClick={() => run({ kind: 'adjust_price_percent', percent: Number(percent) })}
          >
            Apply %
          </Button>
          <TextField
            type="number"
            size="small"
            label="± amount"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            sx={{ width: 112 }}
            slotProps={{
              input: { startAdornment: <InputAdornment position="start">{symbol}</InputAdornment> },
              htmlInput: { step: 1, 'aria-label': 'Adjust by amount' },
            }}
          />
          <Button
            variant="outlined"
            size="small"
            disabled={numeric(amount) === null}
            onClick={() => run({ kind: 'adjust_price_amount', amount: Number(amount).toFixed(2) })}
          >
            Apply amount
          </Button>

          <Divider orientation="vertical" flexItem />

          <Button variant="outlined" size="small" color="warning" onClick={() => run({ kind: 'reset' })}>
            Clear overrides
          </Button>
        </Stack>

        {skipped > 0 && (
          <Alert severity="warning" sx={{ py: 0 }}>
            {skipped} {skipped === 1 ? 'cell' : 'cells'} skipped — the adjustment would make the
            price zero or negative.
          </Alert>
        )}
      </Stack>
    </Paper>
  );
};

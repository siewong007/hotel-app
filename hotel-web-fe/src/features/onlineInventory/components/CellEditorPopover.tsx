import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Divider,
  IconButton,
  InputAdornment,
  Popover,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';

import type { CellKey, EditableCell, GridCellView, StagedEdit } from '../types';
import { useCurrency } from '../../../hooks/useCurrency';

const FULL_DATE = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

interface CellEditorPopoverProps {
  view: GridCellView | null;
  anchorEl: HTMLElement | null;
  onClose(): void;
  onApply(key: CellKey, edit: StagedEdit): void;
  formatPrice(value: string): string;
}

/** Per-cell editor — edits a local draft and stages it; nothing saves here. */
export const CellEditorPopover = ({
  view,
  anchorEl,
  onClose,
  onApply,
  formatPrice,
}: CellEditorPopoverProps) => {
  const { symbol } = useCurrency();
  const [draft, setDraft] = useState<EditableCell>({
    walk_in_reserved_rooms: 0,
    online_booking_enabled: true,
    custom_price: null,
  });

  // Re-seed the draft whenever a different cell opens the editor.
  useEffect(() => {
    if (view) setDraft({ ...view.current });
  }, [view]);

  if (!view) return null;

  const priceInvalid =
    draft.custom_price !== null &&
    (!Number.isFinite(Number(draft.custom_price)) || Number(draft.custom_price) <= 0);
  const overHeld = draft.walk_in_reserved_rooms > view.physical;

  const apply = () => {
    if (priceInvalid) return;
    onApply(view.key, { type: 'set', value: draft });
    onClose();
  };

  return (
    <Popover
      open={anchorEl !== null}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      transformOrigin={{ vertical: 'top', horizontal: 'center' }}
      slotProps={{ paper: { sx: { p: 2.5, width: 320, borderRadius: 3 } } }}
    >
      <Stack spacing={2}>
        <Box>
          <Typography sx={{ fontWeight: 800 }}>{view.room_type_name}</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {FULL_DATE.format(new Date(`${view.stay_date}T12:00:00`))}
          </Typography>
        </Box>

        <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <Box>
            <Typography sx={{ fontWeight: 700 }}>Bookable online</Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {draft.online_booking_enabled ? 'Guests can book this date' : 'Hidden from online booking'}
            </Typography>
          </Box>
          <Switch
            checked={draft.online_booking_enabled}
            onChange={(event) =>
              setDraft((d) => ({ ...d, online_booking_enabled: event.target.checked }))
            }
            color="success"
            slotProps={{ input: { 'aria-label': 'Bookable online' } }}
          />
        </Stack>

        <Divider />

        <Box>
          <Typography sx={{ fontWeight: 700, mb: 0.75 }}>Hold for walk-ins</Typography>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <IconButton
              aria-label="Decrease walk-in hold"
              size="small"
              sx={{ border: 1, borderColor: 'divider' }}
              disabled={draft.walk_in_reserved_rooms <= 0}
              onClick={() =>
                setDraft((d) => ({ ...d, walk_in_reserved_rooms: Math.max(0, d.walk_in_reserved_rooms - 1) }))
              }
            >
              <RemoveIcon fontSize="small" />
            </IconButton>
            <TextField
              type="number"
              size="small"
              value={draft.walk_in_reserved_rooms}
              onChange={(event) =>
                setDraft((d) => ({
                  ...d,
                  walk_in_reserved_rooms: Math.max(0, Math.trunc(Number(event.target.value) || 0)),
                }))
              }
              sx={{ width: 84, '& input': { textAlign: 'center', fontWeight: 800 } }}
              slotProps={{ htmlInput: { min: 0, 'aria-label': 'Walk-in hold' } }}
            />
            <IconButton
              aria-label="Increase walk-in hold"
              size="small"
              sx={{ border: 1, borderColor: 'divider' }}
              onClick={() =>
                setDraft((d) => ({ ...d, walk_in_reserved_rooms: d.walk_in_reserved_rooms + 1 }))
              }
            >
              <AddIcon fontSize="small" />
            </IconButton>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              of {view.physical} free
            </Typography>
          </Stack>
          {overHeld && (
            <Typography variant="caption" sx={{ color: 'error.main', display: 'block', mt: 0.5 }}>
              Higher than the physical availability for this date.
            </Typography>
          )}
        </Box>

        <TextField
          type="number"
          size="small"
          label="Custom online price"
          value={draft.custom_price ?? ''}
          onChange={(event) =>
            setDraft((d) => ({ ...d, custom_price: event.target.value || null }))
          }
          error={priceInvalid}
          helperText={
            priceInvalid
              ? 'Enter a price greater than zero.'
              : `Standard rate for this date: ${formatPrice(view.standard_price)} — leave blank to use it.`
          }
          slotProps={{
            input: { startAdornment: <InputAdornment position="start">{symbol}</InputAdornment> },
            htmlInput: { min: 0.01, step: 0.01, 'aria-label': 'Custom online price' },
          }}
        />

        <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
          {view.is_override && (
            <Button
              size="small"
              color="inherit"
              sx={{ mr: 'auto' }}
              onClick={() => {
                onApply(view.key, { type: 'reset' });
                onClose();
              }}
            >
              Reset to standard rules
            </Button>
          )}
          <Button size="small" onClick={onClose}>Cancel</Button>
          <Button size="small" variant="contained" onClick={apply} disabled={priceInvalid}>
            Apply
          </Button>
        </Stack>
      </Stack>
    </Popover>
  );
};

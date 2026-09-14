import {
  Box,
  Divider,
  IconButton,
  InputAdornment,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';

import type { EditableCell, GridCellView } from '../types';
import { useCurrency } from '../../../hooks/useCurrency';

interface CellEditorFormProps {
  view: GridCellView;
  draft: EditableCell;
  onDraftChange(patch: Partial<EditableCell>): void;
  priceInvalid: boolean;
  overHeld: boolean;
  formatPrice(value: string): string;
}

/**
 * The editable cell fields shared by the popover editor (desktop) and the
 * bottom-sheet editor (phone). Presentational only — the host owns the draft,
 * the validation flags, and the apply/reset actions.
 */
export const CellEditorForm = ({
  view,
  draft,
  onDraftChange,
  priceInvalid,
  overHeld,
  formatPrice,
}: CellEditorFormProps) => {
  const { symbol } = useCurrency();

  return (
    <Stack spacing={2}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Box>
          <Typography sx={{ fontWeight: 700 }}>Bookable online</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {draft.online_booking_enabled ? 'Guests can book this date' : 'Hidden from online booking'}
          </Typography>
        </Box>
        <Switch
          checked={draft.online_booking_enabled}
          onChange={(event) => onDraftChange({ online_booking_enabled: event.target.checked })}
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
              onDraftChange({
                walk_in_reserved_rooms: Math.max(0, draft.walk_in_reserved_rooms - 1),
              })
            }
          >
            <RemoveIcon fontSize="small" />
          </IconButton>
          <TextField
            type="number"
            size="small"
            value={draft.walk_in_reserved_rooms}
            onChange={(event) =>
              onDraftChange({
                walk_in_reserved_rooms: Math.max(0, Math.trunc(Number(event.target.value) || 0)),
              })
            }
            sx={{ width: 84, '& input': { textAlign: 'center', fontWeight: 800 } }}
            slotProps={{ htmlInput: { min: 0, 'aria-label': 'Walk-in hold' } }}
          />
          <IconButton
            aria-label="Increase walk-in hold"
            size="small"
            sx={{ border: 1, borderColor: 'divider' }}
            onClick={() =>
              onDraftChange({ walk_in_reserved_rooms: draft.walk_in_reserved_rooms + 1 })
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
        onChange={(event) => onDraftChange({ custom_price: event.target.value || null })}
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
    </Stack>
  );
};

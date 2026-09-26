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

import { useTranslation } from '../../../i18n/useTranslation';
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
  const { t } = useTranslation('onlineInventory');
  const { symbol } = useCurrency();

  return (
    <Stack spacing={2}>
      {/* The whole row is the label, so the text is a tap target too — the
          bare switch is only ~38px tall on a phone. */}
      <Stack
        component="label"
        direction="row"
        sx={{ alignItems: 'center', justifyContent: 'space-between', minHeight: 44, cursor: 'pointer' }}
      >
        <Box>
          <Typography sx={{ fontWeight: 700 }}>{t('editor.bookable')}</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {draft.online_booking_enabled ? t('editor.bookableOn') : t('editor.bookableOff')}
          </Typography>
        </Box>
        <Switch
          checked={draft.online_booking_enabled}
          onChange={(event) => onDraftChange({ online_booking_enabled: event.target.checked })}
          color="success"
          slotProps={{ input: { 'aria-label': t('editor.bookable') } }}
        />
      </Stack>

      <Divider />

      <Box>
        <Typography sx={{ fontWeight: 700, mb: 0.75 }}>{t('editor.holdWalkins')}</Typography>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <IconButton
            aria-label={t('editor.decrease')}
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
            slotProps={{ htmlInput: { min: 0, 'aria-label': t('editor.holdAria') } }}
          />
          <IconButton
            aria-label={t('editor.increase')}
            size="small"
            sx={{ border: 1, borderColor: 'divider' }}
            onClick={() =>
              onDraftChange({ walk_in_reserved_rooms: draft.walk_in_reserved_rooms + 1 })
            }
          >
            <AddIcon fontSize="small" />
          </IconButton>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {t('editor.ofFree', { count: view.physical })}
          </Typography>
        </Stack>
        {overHeld && (
          <Typography variant="caption" sx={{ color: 'error.main', display: 'block', mt: 0.5 }}>
            {t('editor.overHeld')}
          </Typography>
        )}
      </Box>

      <TextField
        type="number"
        size="small"
        label={t('editor.customPrice')}
        value={draft.custom_price ?? ''}
        onChange={(event) => onDraftChange({ custom_price: event.target.value || null })}
        error={priceInvalid}
        helperText={
          priceInvalid
            ? t('editor.priceInvalid')
            : t('editor.standardRate', { price: formatPrice(view.standard_price) })
        }
        slotProps={{
          input: { startAdornment: <InputAdornment position="start">{symbol}</InputAdornment> },
          htmlInput: { min: 0.01, step: 0.01, 'aria-label': t('editor.customPrice') },
        }}
      />
    </Stack>
  );
};

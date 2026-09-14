import { Box, Button, Popover, Stack, Typography } from '@mui/material';

import type { CellKey, GridCellView, StagedEdit } from '../types';
import { FULL_DATE } from '../constants';
import { useCellEditorDraft } from '../hooks/useCellEditorDraft';
import { CellEditorForm } from './CellEditorForm';

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
  const { draft, patchDraft, priceInvalid, overHeld } = useCellEditorDraft(view);

  if (!view) return null;

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

        <CellEditorForm
          view={view}
          draft={draft}
          onDraftChange={patchDraft}
          priceInvalid={priceInvalid}
          overHeld={overHeld}
          formatPrice={formatPrice}
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

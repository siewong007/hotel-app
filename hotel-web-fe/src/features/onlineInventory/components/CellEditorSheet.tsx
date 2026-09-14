import { useEffect, useState } from 'react';
import { Button, Stack } from '@mui/material';

import { BottomSheet } from '../../../components/common/BottomSheet';
import { useCurrency } from '../../../hooks/useCurrency';
import type { CellKey, EditableCell, GridCellView, StagedEdit } from '../types';
import { CellEditorForm } from './CellEditorForm';

const FULL_DATE = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

interface CellEditorSheetProps {
  view: GridCellView | null;
  onClose(): void;
  onApply(key: CellKey, edit: StagedEdit): void;
}

/**
 * The phone counterpart of `CellEditorPopover`: the same per-cell editor
 * hosted in a `BottomSheet`. Owns the draft, the price/over-hold validation
 * flags, and the Reset / Cancel / Apply footer — it stages edits via
 * `onApply`; nothing is saved here.
 */
export const CellEditorSheet = ({ view, onClose, onApply }: CellEditorSheetProps) => {
  const { format } = useCurrency();
  const formatPrice = (value: string) => format(Number(value));

  const [draft, setDraft] = useState<EditableCell>({
    walk_in_reserved_rooms: 0,
    online_booking_enabled: true,
    custom_price: null,
  });

  // Re-seed the draft whenever a different cell opens the editor.
  useEffect(() => {
    if (view) setDraft({ ...view.current });
  }, [view]);

  const priceInvalid =
    draft.custom_price !== null &&
    (!Number.isFinite(Number(draft.custom_price)) || Number(draft.custom_price) <= 0);
  const overHeld = view !== null && draft.walk_in_reserved_rooms > view.physical;

  const apply = () => {
    if (view === null || priceInvalid) return;
    onApply(view.key, { type: 'set', value: draft });
    onClose();
  };

  const reset = () => {
    if (view === null) return;
    onApply(view.key, { type: 'reset' });
    onClose();
  };

  return (
    <BottomSheet
      open={view !== null}
      onClose={onClose}
      title={
        view === null
          ? undefined
          : `${view.room_type_name} · ${FULL_DATE.format(new Date(`${view.stay_date}T12:00:00`))}`
      }
    >
      {view !== null && (
        <>
          <CellEditorForm
            view={view}
            draft={draft}
            onDraftChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
            priceInvalid={priceInvalid}
            overHeld={overHeld}
            formatPrice={formatPrice}
          />
          <Stack direction="row" spacing={1.5} sx={{ mt: 2.5, '& > *': { flex: 1 } }}>
            {view.is_override && (
              <Button
                variant="outlined"
                color="inherit"
                aria-label="Reset to standard rules"
                sx={{ minHeight: 44 }}
                onClick={reset}
                fullWidth
              >
                Reset
              </Button>
            )}
            <Button variant="outlined" sx={{ minHeight: 44 }} onClick={onClose} fullWidth>
              Cancel
            </Button>
            <Button
              variant="contained"
              sx={{ minHeight: 44 }}
              onClick={apply}
              disabled={priceInvalid}
              fullWidth
            >
              Apply
            </Button>
          </Stack>
        </>
      )}
    </BottomSheet>
  );
};

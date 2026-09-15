import { Button, Stack } from '@mui/material';

import { BottomSheet } from '../../../components/common/BottomSheet';
import { useCurrency } from '../../../hooks/useCurrency';
import { useTranslation } from '../../../i18n/useTranslation';
import type { CellKey, GridCellView, StagedEdit } from '../types';
import { FULL_DATE } from '../constants';
import { useCellEditorDraft } from '../hooks/useCellEditorDraft';
import { CellEditorForm } from './CellEditorForm';

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
  const { t } = useTranslation('onlineInventory');
  const { format } = useCurrency();
  const formatPrice = (value: string) => format(Number(value));

  const { draft, patchDraft, priceInvalid, overHeld } = useCellEditorDraft(view);

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
            onDraftChange={patchDraft}
            priceInvalid={priceInvalid}
            overHeld={overHeld}
            formatPrice={formatPrice}
          />
          <Stack direction="row" spacing={1.5} sx={{ mt: 2.5, '& > *': { flex: 1 } }}>
            {view.is_override && (
              <Button
                variant="outlined"
                color="inherit"
                aria-label={t('editor.resetAria')}
                sx={{ minHeight: 44 }}
                onClick={reset}
                fullWidth
              >
                {t('editor.reset')}
              </Button>
            )}
            <Button variant="outlined" sx={{ minHeight: 44 }} onClick={onClose} fullWidth>
              {t('common:actions.cancel')}
            </Button>
            <Button
              variant="contained"
              sx={{ minHeight: 44 }}
              onClick={apply}
              disabled={priceInvalid}
              fullWidth
            >
              {t('common:actions.apply')}
            </Button>
          </Stack>
        </>
      )}
    </BottomSheet>
  );
};

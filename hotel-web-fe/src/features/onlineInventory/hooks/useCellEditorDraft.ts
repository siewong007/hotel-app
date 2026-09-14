import { useEffect, useState } from 'react';

import type { EditableCell, GridCellView } from '../types';
import { DEFAULT_EDIT } from '../utils';

/**
 * Draft state shared by `CellEditorPopover` and `CellEditorSheet`: seeds from
 * the cell being edited, re-seeds when a different cell opens, and exposes the
 * price/over-hold validation flags both hosts use.
 */
export const useCellEditorDraft = (view: GridCellView | null) => {
  const [draft, setDraft] = useState<EditableCell>({ ...DEFAULT_EDIT });

  // Re-seed the draft whenever a different cell opens the editor.
  useEffect(() => {
    if (view) setDraft({ ...view.current });
  }, [view]);

  const patchDraft = (patch: Partial<EditableCell>) =>
    setDraft((d) => ({ ...d, ...patch }));

  const priceInvalid =
    draft.custom_price !== null &&
    (!Number.isFinite(Number(draft.custom_price)) || Number(draft.custom_price) <= 0);
  const overHeld = view !== null && draft.walk_in_reserved_rooms > view.physical;

  return { draft, patchDraft, priceInvalid, overHeld };
};

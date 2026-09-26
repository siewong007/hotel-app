import { useEffect, useState } from 'react';

import type { EditableCell, GridCellView } from '../types';
import { DEFAULT_EDIT, PRICE_PATTERN } from '../utils';

/** Why the draft price is rejected, or `null` when it is acceptable. */
export type PriceError = 'positive' | 'decimals' | null;

export const priceErrorOf = (price: string | null): PriceError => {
  if (price === null) return null;
  const trimmed = price.trim();
  const numeric = Number(trimmed);
  if (trimmed === '' || !Number.isFinite(numeric) || numeric <= 0) return 'positive';
  // Same rule the server enforces: a plain decimal with at most 2 places —
  // no exponent ("1e3"), no third decimal ("199.999").
  return PRICE_PATTERN.test(trimmed) ? null : 'decimals';
};

/**
 * Draft state shared by `CellEditorPopover` and `CellEditorSheet`: seeds from
 * the cell being edited, re-seeds when a different cell opens, and exposes the
 * price/over-hold validation flags both hosts use. Prices are validated
 * inline (2 decimals max, > 0) rather than silently rounded on Apply.
 */
export const useCellEditorDraft = (view: GridCellView | null) => {
  const [draft, setDraft] = useState<EditableCell>({ ...DEFAULT_EDIT });

  // Re-seed the draft whenever a different cell opens the editor.
  useEffect(() => {
    if (view) setDraft({ ...view.current });
  }, [view]);

  const patchDraft = (patch: Partial<EditableCell>) =>
    setDraft((d) => ({ ...d, ...patch }));

  const priceError = priceErrorOf(draft.custom_price);
  const priceInvalid = priceError !== null;
  const overHeld = view !== null && draft.walk_in_reserved_rooms > view.physical;

  return { draft, patchDraft, priceInvalid, priceError, overHeld };
};

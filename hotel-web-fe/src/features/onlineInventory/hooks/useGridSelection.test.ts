// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useGridSelection } from './useGridSelection';

const IDS = [1, 2, 3];
const DATES = ['2026-09-12', '2026-09-13', '2026-09-14'];

const renderSelection = () =>
  renderHook(() => useGridSelection(IDS, DATES));

describe('useGridSelection', () => {
  it('selects a single cell and records the anchor', () => {
    const { result } = renderSelection();
    act(() => result.current.selectCell('1:2026-09-12', false));

    expect(result.current.selected.has('1:2026-09-12')).toBe(true);
    expect(result.current.selected.size).toBe(1);
    expect(result.current.anchor).toBe('1:2026-09-12');
    expect(result.current.focused).toBe('1:2026-09-12');
  });

  it('extends to a rectangle on shift-select', () => {
    const { result } = renderSelection();
    act(() => result.current.selectCell('1:2026-09-12', false));
    act(() => result.current.selectCell('2:2026-09-13', true));

    expect(result.current.selected).toEqual(
      new Set(['1:2026-09-12', '1:2026-09-13', '2:2026-09-12', '2:2026-09-13']),
    );
    // anchor stays put so a second shift-click re-anchors the far corner only
    expect(result.current.anchor).toBe('1:2026-09-12');
  });

  it('selects a whole row and a whole column', () => {
    const { result } = renderSelection();
    act(() => result.current.selectRow(2));
    expect(result.current.selected.size).toBe(3);
    expect(result.current.selected.has('2:2026-09-14')).toBe(true);

    act(() => result.current.selectColumn('2026-09-13'));
    expect(result.current.selected.size).toBe(3);
    expect([...result.current.selected].every((k) => k.endsWith(':2026-09-13'))).toBe(true);
  });

  it('moveFocus only extends the selection when extend is set', () => {
    const { result } = renderSelection();
    act(() => result.current.selectCell('1:2026-09-12', false));
    act(() => result.current.moveFocus('3:2026-09-12', false));
    expect(result.current.focused).toBe('3:2026-09-12');
    expect(result.current.selected.size).toBe(1);

    act(() => result.current.moveFocus('3:2026-09-14', true));
    expect(result.current.selected.size).toBe(9); // 3 rows x 3 dates
  });

  it('clears selection and anchor', () => {
    const { result } = renderSelection();
    act(() => result.current.selectRow(1));
    act(() => result.current.clear());
    expect(result.current.selected.size).toBe(0);
    expect(result.current.anchor).toBeNull();
  });
});

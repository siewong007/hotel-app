// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { EditSummaryGroup } from '../utils';
import { ReviewChangesDialog } from './ReviewChangesDialog';

const groups: EditSummaryGroup[] = [
  {
    roomTypeId: 1,
    name: 'Deluxe King',
    code: 'DLXK',
    runs: [
      { from: '2026-09-12', to: '2026-09-14', lines: ['Price → RM 250.00 (standard RM 280.00)'] },
      { from: '2026-09-20', to: '2026-09-20', lines: ['Close online'] },
    ],
  },
  {
    roomTypeId: 2,
    name: 'Standard Queen',
    code: 'STDQ',
    runs: [{ from: '2026-09-12', to: '2026-09-12', lines: ['Reset to standard rules'] }],
  },
];

const renderDialog = (overrides: Partial<Parameters<typeof ReviewChangesDialog>[0]> = {}) => {
  const props = {
    open: true,
    groups,
    totalCount: 4,
    isSaving: false,
    onClose: vi.fn(),
    onConfirm: vi.fn(),
    ...overrides,
  };
  render(<ReviewChangesDialog {...props} />);
  return props;
};

describe('ReviewChangesDialog', () => {
  afterEach(cleanup);

  it('lists every change grouped by room type', () => {
    renderDialog();
    expect(screen.getByText('Deluxe King')).toBeTruthy();
    expect(screen.getByText('Standard Queen')).toBeTruthy();
    expect(screen.getByText(/Price → RM 250\.00/)).toBeTruthy();
    expect(screen.getByText(/Close online/)).toBeTruthy();
    expect(screen.getByText(/Reset to standard rules/)).toBeTruthy();
  });

  it('collapses a contiguous run into a date range', () => {
    renderDialog();
    expect(screen.getByText(/2026-09-12 – 2026-09-14/)).toBeTruthy();
  });

  it('confirms with the total staged count', () => {
    const props = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Apply 4 changes' }));
    expect(props.onConfirm).toHaveBeenCalled();
  });

  it('disables confirm while saving', () => {
    renderDialog({ isSaving: true });
    expect(screen.getByRole('button', { name: /saving/i })).toHaveProperty('disabled', true);
  });
});

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { InventorySummary } from './InventorySummary';

const labels = ['Physically free', 'Held for walk-ins', 'Available online'];

function valueFor(label: string): number {
  const labelEl = screen.getByText(label.toUpperCase());
  const stack = labelEl.parentElement!.parentElement!;
  return Number(
    stack.textContent!.replace(label.toUpperCase(), '').replace('room-nights', ''),
  );
}

describe('InventorySummary', () => {
  afterEach(cleanup);

  it('sums physical, held, and online room-nights across cells', () => {
    render(
      <InventorySummary
        cells={[
          { physical: 5, held: 2, online: 3 },
          { physical: 4, held: 1, online: 3 },
        ]}
      />,
    );

    expect(valueFor(labels[0])).toBe(9);
    expect(valueFor(labels[1])).toBe(3);
    expect(valueFor(labels[2])).toBe(6);
  });

  it('treats closed cells as zero online', () => {
    render(
      <InventorySummary
        cells={[
          { physical: 5, held: 2, online: 3 },
          { physical: 7, held: 0, online: 0 },
        ]}
      />,
    );

    expect(valueFor(labels[0])).toBe(12);
    expect(valueFor(labels[1])).toBe(2);
    expect(valueFor(labels[2])).toBe(3);
  });

  it('labels the scope it summarizes', () => {
    render(<InventorySummary cells={[]} label="Selected cells" />);
    expect(screen.getByText('SELECTED CELLS')).toBeTruthy();
  });
});

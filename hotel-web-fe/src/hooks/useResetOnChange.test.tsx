import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useState } from 'react';
import { useResetOnChange } from './useResetOnChange';

function Probe({ open, seed }: { open: boolean; seed: string }) {
  const [value, setValue] = useState('stale');
  const [runs, setRuns] = useState(0);
  useResetOnChange([open, seed], () => {
    setRuns((n) => n + 1);
    if (open) setValue(seed);
  });
  return <div data-testid="out">{`${value}|${runs}`}</div>;
}

describe('useResetOnChange', () => {
  it('runs on mount and only when a dep changes', () => {
    const { rerender } = render(<Probe open={false} seed="a" />);
    expect(screen.getByTestId('out').textContent).toBe('stale|1');
    rerender(<Probe open={false} seed="a" />);
    expect(screen.getByTestId('out').textContent).toBe('stale|1');
    rerender(<Probe open seed="a" />);
    expect(screen.getByTestId('out').textContent).toBe('a|2');
    rerender(<Probe open seed="b" />);
    expect(screen.getByTestId('out').textContent).toBe('b|3');
  });
});

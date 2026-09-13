import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BottomSheet } from './BottomSheet';

describe('BottomSheet', () => {
  afterEach(cleanup);

  it('renders title and children when open', () => {
    render(
      <BottomSheet open onClose={vi.fn()} title="Filters">
        <div>sheet body</div>
      </BottomSheet>,
    );
    expect(screen.getByText('Filters')).toBeTruthy();
    expect(screen.getByText('sheet body')).toBeTruthy();
  });

  it('calls onClose from the close button', () => {
    const onClose = vi.fn();
    render(
      <BottomSheet open onClose={onClose} title="Filters">
        <div>body</div>
      </BottomSheet>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders the optional header action', () => {
    render(
      <BottomSheet open onClose={vi.fn()} title="Filters" headerAction={<button>Reset</button>}>
        <div>body</div>
      </BottomSheet>,
    );
    expect(screen.getByRole('button', { name: 'Reset' })).toBeTruthy();
  });
});

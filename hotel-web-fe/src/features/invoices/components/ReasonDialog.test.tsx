import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ReasonDialog from './ReasonDialog';

function renderDialog(overrides: Partial<React.ComponentProps<typeof ReasonDialog>> = {}) {
  const props = {
    open: true,
    title: 'Void payment',
    message: 'The record is kept on the folio, shown as voided.',
    confirmText: 'Void payment',
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  render(<ReasonDialog {...props} />);
  const dialog = screen.getByRole('dialog', { name: props.title });
  return { props, dialog };
}

describe('ReasonDialog', () => {
  afterEach(() => cleanup());

  it('keeps confirm disabled until a trimmed reason of at least 3 characters is typed', () => {
    const { props, dialog } = renderDialog();
    const confirm = within(dialog).getByRole('button', { name: 'Void payment' }) as HTMLButtonElement;
    const input = within(dialog).getByTestId('reason-dialog-input');

    expect(confirm.disabled).toBe(true);
    fireEvent.change(input, { target: { value: '   ab   ' } });
    expect(confirm.disabled).toBe(true);
    expect(within(dialog).getByText(/at least 3 characters/i)).toBeDefined();

    fireEvent.change(input, { target: { value: '  wrong amount  ' } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    expect(props.onConfirm).toHaveBeenCalledWith('wrong amount');
  });

  it('cancels without confirming', () => {
    const { props, dialog } = renderDialog();
    fireEvent.change(within(dialog).getByTestId('reason-dialog-input'), { target: { value: 'typo fix' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(props.onCancel).toHaveBeenCalled();
    expect(props.onConfirm).not.toHaveBeenCalled();
  });

  it('blocks both actions while busy', () => {
    const { props, dialog } = renderDialog({ busy: true });
    fireEvent.change(within(dialog).getByTestId('reason-dialog-input'), { target: { value: 'typo fix' } });
    const buttons = within(dialog).getAllByRole('button') as HTMLButtonElement[];
    buttons.forEach((b) => expect(b.disabled).toBe(true));
    expect(props.onConfirm).not.toHaveBeenCalled();
  });
});

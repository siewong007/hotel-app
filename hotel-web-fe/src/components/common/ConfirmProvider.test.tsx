import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider, useConfirm } from './ConfirmProvider';
import type { ConfirmOptions } from './ConfirmDialog';

/**
 * Fires a prompt on click and reports what the promise settled to, so each test
 * can assert on the resolved value rather than on internal state.
 */
function Harness({
  options,
  onSettled,
}: {
  options: ConfirmOptions;
  onSettled: (confirmed: boolean) => void;
}) {
  const confirm = useConfirm();
  return (
    <button
      type="button"
      onClick={() => {
        void confirm(options).then(onSettled);
      }}
    >
      trigger
    </button>
  );
}

function renderHarness(options: ConfirmOptions) {
  const onSettled = vi.fn();
  render(
    <ConfirmProvider>
      <Harness options={options} onSettled={onSettled} />
    </ConfirmProvider>,
  );
  return onSettled;
}

describe('ConfirmProvider / useConfirm', () => {
  afterEach(cleanup);

  it('shows nothing until a prompt is requested', () => {
    renderHarness({ message: 'Delete this payment record?' });

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders the title, message, and custom button labels', async () => {
    renderHarness({
      title: 'Delete payment record',
      message: 'This cannot be undone.',
      confirmText: 'Delete payment',
      cancelText: 'Keep it',
      severity: 'error',
    });

    fireEvent.click(screen.getByRole('button', { name: 'trigger' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Delete payment record');
    expect(dialog.textContent).toContain('This cannot be undone.');
    expect(screen.getByRole('button', { name: 'Delete payment' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Keep it' })).toBeTruthy();
  });

  it('resolves true and closes when the confirm button is pressed', async () => {
    const onSettled = renderHarness({ message: 'Proceed?', confirmText: 'Yes' });

    fireEvent.click(screen.getByRole('button', { name: 'trigger' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Yes' }));

    await waitFor(() => expect(onSettled).toHaveBeenCalledWith(true));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('resolves false when cancelled', async () => {
    const onSettled = renderHarness({ message: 'Proceed?' });

    fireEvent.click(screen.getByRole('button', { name: 'trigger' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(onSettled).toHaveBeenCalledWith(false));
  });

  it('resolves false when dismissed with Escape', async () => {
    const onSettled = renderHarness({ message: 'Proceed?' });

    fireEvent.click(screen.getByRole('button', { name: 'trigger' }));
    fireEvent.keyDown(await screen.findByRole('dialog'), { key: 'Escape' });

    await waitFor(() => expect(onSettled).toHaveBeenCalledWith(false));
  });

  it('declines a superseded prompt so its caller is never left awaiting', async () => {
    const onSettled = vi.fn();
    render(
      <ConfirmProvider>
        <Harness options={{ message: 'First?', confirmText: 'Yes' }} onSettled={onSettled} />
      </ConfirmProvider>,
    );

    const trigger = screen.getByRole('button', { name: 'trigger' });
    fireEvent.click(trigger);
    await screen.findByRole('dialog');
    fireEvent.click(trigger);

    // The first prompt resolves false immediately; the second is still open.
    await waitFor(() => expect(onSettled).toHaveBeenCalledWith(false));
    expect(onSettled).toHaveBeenCalledTimes(1);

    fireEvent.click(await screen.findByRole('button', { name: 'Yes' }));
    await waitFor(() => expect(onSettled).toHaveBeenCalledTimes(2));
    expect(onSettled).toHaveBeenLastCalledWith(true);
  });

  it('declines a pending prompt when the provider unmounts', async () => {
    const onSettled = vi.fn();
    const { unmount } = render(
      <ConfirmProvider>
        <Harness options={{ message: 'Proceed?' }} onSettled={onSettled} />
      </ConfirmProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'trigger' }));
    await screen.findByRole('dialog');
    unmount();

    await waitFor(() => expect(onSettled).toHaveBeenCalledWith(false));
  });

  it('throws when used outside the provider', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => render(<Harness options={{ message: 'x' }} onSettled={vi.fn()} />)).toThrow(
        /ConfirmProvider/,
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});

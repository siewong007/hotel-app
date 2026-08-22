import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AccountDeactivation from './AccountDeactivation';

const openDialog = async () => {
  // The page-level button and the dialog's confirm button share a label;
  // scope every later query to the dialog.
  fireEvent.click(screen.getByRole('button', { name: 'Deactivate Account' }));
  await screen.findByLabelText('Reason (Optional)');
  return screen.getByRole('dialog');
};

describe('AccountDeactivation', () => {
  const onDeactivate = vi.fn(async (_reason?: string) => {});
  const onReactivate = vi.fn(async () => {});

  beforeEach(() => {
    onDeactivate.mockClear();
    onReactivate.mockClear();
  });

  afterEach(cleanup);

  it('opens a confirmation dialog and passes an optional reason through', async () => {
    render(<AccountDeactivation onDeactivate={onDeactivate} />);

    const dialog = await openDialog();
    fireEvent.change(screen.getByLabelText('Reason (Optional)'), {
      target: { value: 'Leaving the hotel' },
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: /Deactivate/ }),
    );

    await waitFor(() =>
      expect(onDeactivate).toHaveBeenCalledWith('Leaving the hotel'),
    );
  });

  it('sends undefined when no reason is entered', async () => {
    render(<AccountDeactivation onDeactivate={onDeactivate} />);

    const dialog = await openDialog();
    fireEvent.click(
      within(dialog).getByRole('button', { name: /Deactivate/ }),
    );

    await waitFor(() => expect(onDeactivate).toHaveBeenCalledWith(undefined));
  });

  it('surfaces backend failures inside the dialog instead of closing it', async () => {
    onDeactivate.mockImplementationOnce(async () => {
      throw new Error('Outstanding balance must be settled first');
    });

    render(<AccountDeactivation onDeactivate={onDeactivate} />);

    const dialog = await openDialog();
    fireEvent.click(
      within(dialog).getByRole('button', { name: /Deactivate/ }),
    );

    expect(
      await screen.findByText('Outstanding balance must be settled first'),
    ).toBeTruthy();
    // The dialog stays open so the user can retry.
    expect(screen.getByLabelText('Reason (Optional)')).toBeTruthy();
  });

  it('shows the reactivate surface once the account is deactivated', async () => {
    render(
      <AccountDeactivation
        onDeactivate={onDeactivate}
        isDeactivated
        onReactivate={onReactivate}
      />,
    );

    fireEvent.click(screen.getByText(/Reactivate Account/));
    await waitFor(() => expect(onReactivate).toHaveBeenCalledTimes(1));
  });

  it('cancels without calling the API', async () => {
    render(<AccountDeactivation onDeactivate={onDeactivate} />);

    await openDialog();
    fireEvent.click(screen.getByText('Cancel'));

    expect(onDeactivate).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByLabelText('Reason (Optional)')).toBeNull(),
    );
  });
});

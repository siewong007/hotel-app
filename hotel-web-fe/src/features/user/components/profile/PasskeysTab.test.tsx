import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PasskeyInfo } from '../../../../types';
import type { ApiNotificationSeverity } from '../../../../utils/apiNotifications';
import PasskeysTabDefault, { MAX_PASSKEYS } from './PasskeysTab';
const PasskeysTab = PasskeysTabDefault;

const passkey = (overrides: Partial<PasskeyInfo> = {}): PasskeyInfo =>
  ({
    id: 'pk-1',
    device_name: 'MacBook Pro',
    created_at: '2026-08-01T09:00:00Z',
    last_used_at: '2026-08-20T18:30:00Z',
    ...overrides,
  }) as PasskeyInfo;

describe('PasskeysTab', () => {
  const onAdd = vi.fn();
  const onDelete = vi.fn();
  const onRename = vi.fn<(id: string, deviceName: string) => Promise<void>>(
    async () => undefined,
  );
  const notify = vi.fn<(message: string, severity: ApiNotificationSeverity) => void>();

  beforeEach(() => {
    onAdd.mockClear();
    onDelete.mockClear();
    onRename.mockClear();
    notify.mockClear();
  });

  afterEach(cleanup);

  it('shows the empty state with a first-passkey CTA when none are registered', () => {
    render(
      <PasskeysTab passkeys={[]} onAdd={onAdd} onDelete={onDelete} onRename={onRename} notify={notify} />,
    );

    expect(screen.getByText('No passkeys registered')).toBeTruthy();
    expect(screen.getByText(/Registered Passkeys \(0\/10\)/)).toBeTruthy();

    fireEvent.click(screen.getByText('Register Your First Passkey'));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('lists registered devices and disables Add at the ten-passkey limit', () => {
    const all = Array.from({ length: MAX_PASSKEYS }, (_, i) => passkey({ id: `pk-${i}`, device_name: `Device ${i}` }));

    render(
      <PasskeysTab passkeys={all} onAdd={onAdd} onDelete={onDelete} onRename={onRename} notify={notify} />,
    );

    expect(screen.getByText(/Registered Passkeys \(10\/10\)/)).toBeTruthy();
    expect(screen.getByText('Device 3')).toBeTruthy();
    const add = screen.getByText('Add Passkey').closest('button')!;
    expect((add as HTMLButtonElement).disabled).toBe(true);
  });

  it('renames through the inline editor and rejects blank names', async () => {
    render(
      <PasskeysTab
        passkeys={[passkey()]}
        onAdd={onAdd}
        onDelete={onDelete}
        onRename={onRename}
        notify={notify}
      />,
    );

    fireEvent.click(screen.getByTitle('Edit passkey name'));
    const input = screen.getByPlaceholderText(/Device name/);
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.click(screen.getByTitle('Save'));

    await waitFor(() => expect(notify).toHaveBeenCalledWith('Passkey name cannot be empty', 'warning'));
    expect(onRename).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: 'YubiKey 5' } });
    fireEvent.click(screen.getByTitle('Save'));

    await waitFor(() => expect(onRename).toHaveBeenCalledWith('pk-1', 'YubiKey 5'));
  });

  it('cancel discards an in-progress rename without notifying', () => {
    render(
      <PasskeysTab
        passkeys={[passkey()]}
        onAdd={onAdd}
        onDelete={onDelete}
        onRename={onRename}
        notify={notify}
      />,
    );

    fireEvent.click(screen.getByTitle('Edit passkey name'));
    fireEvent.change(screen.getByPlaceholderText(/Device name/), { target: { value: 'draft' } });
    fireEvent.click(screen.getByTitle('Cancel'));

    expect(screen.getByText('MacBook Pro')).toBeTruthy();
    expect(onRename).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('deletes a passkey through its icon control', () => {
    render(
      <PasskeysTab
        passkeys={[passkey()]}
        onAdd={onAdd}
        onDelete={onDelete}
        onRename={onRename}
        notify={notify}
      />,
    );

    fireEvent.click(screen.getByTitle('Delete passkey'));
    expect(onDelete).toHaveBeenCalledWith('pk-1');
  });
});

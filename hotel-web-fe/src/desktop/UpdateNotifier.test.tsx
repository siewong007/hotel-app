import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesktopUpdateInfo } from './runtimeApi';

const api = vi.hoisted(() => ({
  isDesktopUpdaterEnabled: vi.fn(),
  checkForUpdates: vi.fn(),
  installUpdate: vi.fn(),
  restartApp: vi.fn(),
}));

vi.mock('./runtimeApi', () => ({ ...api }));

import { UpdateNotifier } from './UpdateNotifier';

const availableUpdate: DesktopUpdateInfo = {
  available: true,
  version: '1.5.0',
  current_version: '1.4.2',
  notes: 'Bug fixes and improvements',
};

const upToDate: DesktopUpdateInfo = {
  available: false,
  version: '1.4.2',
  current_version: '1.4.2',
  notes: null,
};

describe('UpdateNotifier', () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    api.isDesktopUpdaterEnabled.mockReturnValue(true);
    api.checkForUpdates.mockResolvedValue(availableUpdate);
    api.installUpdate.mockResolvedValue({ installed: true, version: '1.5.0' });
    api.restartApp.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders nothing and issues no IPC when the updater is off', async () => {
    api.isDesktopUpdaterEnabled.mockReturnValue(false);
    const { container } = render(<UpdateNotifier initialDelayMs={0} />);
    expect(container.firstChild).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(api.checkForUpdates).not.toHaveBeenCalled();
  });

  it('waits for the initial delay, then checks and re-checks on the interval', async () => {
    vi.useFakeTimers();
    api.checkForUpdates.mockResolvedValue(upToDate);
    render(<UpdateNotifier initialDelayMs={1000} intervalMs={5000} />);

    await act(() => vi.advanceTimersByTimeAsync(999));
    expect(api.checkForUpdates).not.toHaveBeenCalled();

    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(api.checkForUpdates).toHaveBeenCalledTimes(1);

    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(api.checkForUpdates).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/is available/)).toBeNull();
  });

  it('stays silent when the background check fails', async () => {
    api.checkForUpdates.mockRejectedValue('network unreachable');
    render(<UpdateNotifier initialDelayMs={0} />);
    await waitFor(() => expect(api.checkForUpdates).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('network unreachable')).toBeNull();
  });

  it('announces an available update with its notes', async () => {
    render(<UpdateNotifier initialDelayMs={0} />);
    expect(await screen.findByText('Version 1.5.0 is available.')).toBeTruthy();
    expect(screen.getByText('Bug fixes and improvements')).toBeTruthy();
  });

  it('installs from the snackbar and offers a restart', async () => {
    render(<UpdateNotifier initialDelayMs={0} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Install update' }));

    expect(
      await screen.findByText('Update installed. Restart to apply version 1.5.0.')
    ).toBeTruthy();
    expect(api.installUpdate).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Restart now' }));
    expect(api.restartApp).toHaveBeenCalledTimes(1);
  });

  it('shows the install error and keeps the install action available', async () => {
    api.installUpdate.mockRejectedValue('signature verification failed');
    render(<UpdateNotifier initialDelayMs={0} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Install update' }));

    expect(await screen.findByText('signature verification failed')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Install update' })).toBeTruthy();
  });

  it('hides a dismissed version on later checks but shows a newer one', async () => {
    vi.useFakeTimers();
    render(<UpdateNotifier initialDelayMs={0} intervalMs={1000} />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByText('Version 1.5.0 is available.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(api.checkForUpdates).toHaveBeenCalledTimes(2);
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(screen.queryByRole('button', { name: 'Install update' })).toBeNull();

    api.checkForUpdates.mockResolvedValue({ ...availableUpdate, version: '1.6.0' });
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(screen.getByText('Version 1.6.0 is available.')).toBeTruthy();
  });

  it('stops checking once the user defers the restart', async () => {
    vi.useFakeTimers();
    render(<UpdateNotifier initialDelayMs={0} intervalMs={1000} />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    fireEvent.click(screen.getByRole('button', { name: 'Install update' }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));

    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(api.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Install update' })).toBeNull();
  });
});

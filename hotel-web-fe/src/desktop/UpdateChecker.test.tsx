import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesktopAppStatus, DesktopUpdateInfo } from './runtimeApi';

const api = vi.hoisted(() => ({
  shouldUseDesktopRuntime: vi.fn(() => true),
  isDesktopUpdaterEnabled: vi.fn(),
  getDesktopStatus: vi.fn(),
  checkForUpdates: vi.fn(),
  installUpdate: vi.fn(),
  restartApp: vi.fn(),
}));

vi.mock('./runtimeApi', () => ({ ...api }));

import { UpdateChecker } from './UpdateChecker';

const status: DesktopAppStatus = {
  backend_running: true,
  backend_starting: false,
  backend_url: 'http://127.0.0.1:3030',
  data_directory: '/data',
  version: '1.4.2',
};

const availableUpdate: DesktopUpdateInfo = {
  available: true,
  version: '1.5.0',
  current_version: '1.4.2',
  notes: 'Bug fixes and improvements',
};

describe('UpdateChecker', () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    api.shouldUseDesktopRuntime.mockReturnValue(true);
    // Delegate so the runtime gate and the flag gate exercise the same
    // composition the real isDesktopUpdaterEnabled() performs.
    api.isDesktopUpdaterEnabled.mockImplementation(() => api.shouldUseDesktopRuntime());
    api.getDesktopStatus.mockResolvedValue(status);
    api.checkForUpdates.mockResolvedValue(availableUpdate);
    api.installUpdate.mockResolvedValue({ installed: true, version: '1.5.0' });
    api.restartApp.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it('renders nothing when the updater flag is off and issues no IPC', () => {
    api.isDesktopUpdaterEnabled.mockReturnValue(false);
    const { container } = render(<UpdateChecker />);
    expect(container.firstChild).toBeNull();
    expect(api.getDesktopStatus).not.toHaveBeenCalled();
  });

  it('renders nothing outside the desktop runtime and issues no IPC', () => {
    api.shouldUseDesktopRuntime.mockReturnValue(false);
    const { container } = render(<UpdateChecker />);
    expect(container.firstChild).toBeNull();
    expect(api.getDesktopStatus).not.toHaveBeenCalled();
  });

  it('shows the current version and checks for updates', async () => {
    render(<UpdateChecker />);

    expect(await screen.findByText('v1.4.2')).toBeTruthy();
    expect(screen.getByText('App updates')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));

    expect(await screen.findByText('Version 1.5.0 is available.')).toBeTruthy();
    expect(screen.getByText('Bug fixes and improvements')).toBeTruthy();
    expect(api.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('installs an available update and offers restart', async () => {
    render(<UpdateChecker />);
    fireEvent.click(await screen.findByRole('button', { name: 'Check for updates' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Install update' }));

    expect(
      await screen.findByText('Update installed. Restart to apply version 1.5.0.'),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Restart now' }));
    await waitFor(() => expect(api.restartApp).toHaveBeenCalledTimes(1));
  });

  it('dismisses the restart prompt when Later is chosen', async () => {
    render(<UpdateChecker />);
    fireEvent.click(await screen.findByRole('button', { name: 'Check for updates' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Install update' }));
    await screen.findByText('Update installed. Restart to apply version 1.5.0.');

    fireEvent.click(screen.getByRole('button', { name: 'Later' }));

    expect(screen.queryByRole('button', { name: 'Restart now' })).toBeNull();
    expect(api.restartApp).not.toHaveBeenCalled();
  });

  it('keeps the installing state when the install promise never resolves', async () => {
    // Windows path: the updater exits the process mid-call, so a dropped
    // promise is success-in-progress — the card must not surface an error.
    api.installUpdate.mockReturnValue(new Promise(() => {}));
    render(<UpdateChecker />);
    fireEvent.click(await screen.findByRole('button', { name: 'Check for updates' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Install update' }));

    expect(await screen.findByText('Downloading and installing…')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reports when the app is already up to date', async () => {
    api.checkForUpdates.mockResolvedValue({
      available: false,
      version: '1.4.2',
      current_version: '1.4.2',
      notes: null,
    });
    render(<UpdateChecker />);
    fireEvent.click(await screen.findByRole('button', { name: 'Check for updates' }));

    expect(
      await screen.findByText("You're on the latest version (1.4.2)."),
    ).toBeTruthy();
  });

  it('shows a check failure inline and keeps the check action available', async () => {
    api.checkForUpdates.mockRejectedValue('endpoint unreachable');
    render(<UpdateChecker />);
    fireEvent.click(await screen.findByRole('button', { name: 'Check for updates' }));

    expect(await screen.findByText('endpoint unreachable')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Check for updates' })).toBeTruthy();
  });
});

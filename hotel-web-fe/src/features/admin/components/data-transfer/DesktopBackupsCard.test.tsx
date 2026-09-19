import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesktopBackupInfo } from '../../../../desktop/runtimeApi';

const api = vi.hoisted(() => ({
  listBackups: vi.fn(),
  backupNow: vi.fn(),
  restoreDatabase: vi.fn(),
  openBackupsFolder: vi.fn(),
  shouldUseDesktopRuntime: vi.fn(() => true),
}));

const auth = vi.hoisted(() => ({
  hasPermission: vi.fn((permission: string) => permission === 'data_transfer:import'),
}));

vi.mock('../../../../desktop/runtimeApi', () => ({ ...api }));

vi.mock('../../../../auth/AuthContext', () => ({
  useAuth: () => ({ hasPermission: auth.hasPermission }),
}));

import DesktopBackupsCard from './DesktopBackupsCard';

const backups: DesktopBackupInfo[] = [
  {
    filename: 'hotel-backup-20260918-120000.dump',
    timestamp: '2026-09-18T12:00:00+00:00',
    size_bytes: 2 * 1024 * 1024,
    uploads_filename: 'hotel-backup-20260918-120000-uploads.tar.gz',
  },
  {
    filename: 'hotel-backup-20260917-120000.dump',
    timestamp: '2026-09-17T12:00:00+00:00',
    size_bytes: 512 * 1024,
    uploads_filename: null,
  },
];

const renderCard = (notify = vi.fn()) => render(<DesktopBackupsCard notify={notify} />);

describe('DesktopBackupsCard', () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    api.shouldUseDesktopRuntime.mockReturnValue(true);
    api.listBackups.mockResolvedValue([]);
    api.openBackupsFolder.mockResolvedValue(undefined);
    auth.hasPermission
      .mockReset()
      .mockImplementation((permission: string) => permission === 'data_transfer:import');
  });

  afterEach(cleanup);

  it('renders nothing outside the desktop runtime and issues no IPC', () => {
    api.shouldUseDesktopRuntime.mockReturnValue(false);
    const { container } = renderCard();
    expect(container.firstChild).toBeNull();
    expect(api.listBackups).not.toHaveBeenCalled();
  });

  it('renders nothing without data_transfer:import and issues no IPC', () => {
    auth.hasPermission.mockReturnValue(false);
    const { container } = renderCard();
    expect(container.firstChild).toBeNull();
    expect(auth.hasPermission).toHaveBeenCalledWith('data_transfer:import');
    expect(api.listBackups).not.toHaveBeenCalled();
  });

  it('lists managed backups with size and uploads badge', async () => {
    api.listBackups.mockResolvedValue(backups);
    renderCard();

    expect(await screen.findByText('hotel-backup-20260918-120000.dump')).toBeTruthy();
    expect(screen.getByText('hotel-backup-20260917-120000.dump')).toBeTruthy();
    // formatBytes: 2 MiB -> "2.0 MB", 512 KiB -> "512.0 KB" (meta line: "date · size").
    expect(screen.getByText(/2\.0 MB/)).toBeTruthy();
    expect(screen.getByText(/512\.0 KB/)).toBeTruthy();
    // Only the paired row carries the uploads badge.
    expect(screen.getAllByText('includes uploaded files')).toHaveLength(1);
  });

  it('shows the empty state when no managed backups exist yet', async () => {
    renderCard();
    expect(await screen.findByText(/No backups yet/)).toBeTruthy();
  });

  it('Back up now calls backupNow, refetches the list, and notifies', async () => {
    api.backupNow.mockResolvedValue('/data/backups/hotel-backup-20260918-130000.dump');
    const notify = vi.fn();
    renderCard(notify);
    await screen.findByText(/No backups yet/);

    // The refetch after the backup resolves shows the new row.
    api.listBackups.mockResolvedValue(backups);
    fireEvent.click(screen.getByRole('button', { name: 'Back up now' }));

    await waitFor(() => expect(api.backupNow).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(api.listBackups).toHaveBeenCalledTimes(2));
    await screen.findByText('hotel-backup-20260918-120000.dump');
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining('hotel-backup-20260918-130000.dump'),
    );
  });

  it('restore requires the data-loss confirmation before invoking restoreDatabase', async () => {
    api.listBackups.mockResolvedValue(backups);
    api.restoreDatabase.mockResolvedValue({
      restored_backup: backups[0].filename,
      restored_uploads: backups[0].uploads_filename,
      safety_backup: 'hotel-backup-20260918-140000.dump',
    });
    const notify = vi.fn();
    renderCard(notify);

    await screen.findByText('hotel-backup-20260918-120000.dump');
    fireEvent.click(screen.getAllByRole('button', { name: 'Restore' })[0]);

    // The explicit confirm (data loss + safety-backup wording) gates the call.
    expect(await screen.findByText('Restore this backup?')).toBeTruthy();
    expect(screen.getByText(/Data changed after that point is lost/)).toBeTruthy();
    expect(screen.getByText(/safety backup is taken first/)).toBeTruthy();
    expect(api.restoreDatabase).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Restore and restart' }));
    await waitFor(() =>
      expect(api.restoreDatabase).toHaveBeenCalledWith('hotel-backup-20260918-120000.dump'),
    );
    // Settling while still mounted notifies and refetches (in production the
    // service-gate remount is what refetches instead).
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        expect.stringContaining('hotel-backup-20260918-120000.dump'),
      ),
    );
  });

  it('cancelling the restore dialog never calls restoreDatabase', async () => {
    api.listBackups.mockResolvedValue(backups);
    renderCard();

    await screen.findByText('hotel-backup-20260918-120000.dump');
    fireEvent.click(screen.getAllByRole('button', { name: 'Restore' })[1]);
    expect(await screen.findByText('Restore this backup?')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Restore this backup?')).toBeNull());
    expect(api.restoreDatabase).not.toHaveBeenCalled();
  });

  it('opens the backups folder on demand', async () => {
    api.listBackups.mockResolvedValue(backups);
    renderCard();

    await screen.findByText('hotel-backup-20260918-120000.dump');
    fireEvent.click(screen.getByRole('button', { name: 'Open backups folder' }));
    await waitFor(() => expect(api.openBackupsFolder).toHaveBeenCalledTimes(1));
  });
});

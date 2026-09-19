import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  user: { id: 'u1', username: 'admin' } as Record<string, unknown>,
}));

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({ hasPermission: mocks.hasPermission, user: mocks.user }),
}));

vi.mock('../../../api', () => ({
  DataTransferService: {
    previewExport: vi.fn(),
    exportData: vi.fn(),
    stepUp: vi.fn(),
    transferHistory: vi.fn(() => Promise.resolve({ entries: [], total: 0 })),
    uploadBackup: vi.fn(),
    previewImport: vi.fn(),
    executeImport: vi.fn(),
    getImportJob: vi.fn(),
    deleteUpload: vi.fn(),
  },
}));

vi.mock('../../../hooks/useIsPhone', () => ({
  useIsPhone: () => false,
}));

import DataTransferPage from './DataTransferPage';
import { DataTransferService } from '../../../api';
import { expectNoCriticalAxeViolations } from '../../../test/axe';

const ALL_PERMISSIONS = [
  'data_transfer:view',
  'data_transfer:export',
  'data_transfer:export_sensitive',
  'data_transfer:import',
  'data_transfer:import_sensitive',
  'data_transfer:override',
  'data_transfer:restore',
];

const grant = (...permissions: string[]) => {
  const held = new Set(permissions);
  // Mirror `hasPermission`'s manage-derivation: `data_transfer:manage` unlocks
  // every data_transfer:* action.
  mocks.hasPermission.mockImplementation(
    (p: string) => held.has(p) || (held.has('data_transfer:manage') && p.startsWith('data_transfer:')),
  );
};

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DataTransferPage />
    </QueryClientProvider>,
  );

describe('DataTransferPage', () => {
  beforeEach(() => {
    mocks.hasPermission.mockReset().mockReturnValue(false);
    mocks.user = { id: 'u1', username: 'admin' };
  });

  afterEach(cleanup);

  it('denies access without data_transfer:view', () => {
    grant('data_transfer:export', 'data_transfer:import');
    renderPage();
    expect(screen.queryByRole('button', { name: /download/i })).toBeNull();
    expect(screen.getByText(/do not have permission/i)).toBeTruthy();
  });

  it('renders all three sections for a fully privileged account', () => {
    grant(...ALL_PERMISSIONS);
    renderPage();
    expect(screen.getByRole('button', { name: 'Export' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Import' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'History' })).toBeTruthy();
    // All three export tiers render their download actions.
    expect(screen.getAllByRole('button', { name: /download/i })).toHaveLength(3);
  });

  it('manage implies every data_transfer action', () => {
    grant('data_transfer:manage');
    renderPage();
    expect(screen.getByRole('button', { name: 'Export' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Import' })).toBeTruthy();
  });

  it('shows export + history only when import is not granted', () => {
    grant('data_transfer:view', 'data_transfer:export');
    renderPage();
    expect(screen.getByRole('button', { name: 'Export' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Import' })).toBeNull();
    expect(screen.getByRole('button', { name: 'History' })).toBeTruthy();
    // Standard tier is actionable; the sensitive tiers show their permission requirement.
    expect(screen.getAllByRole('button', { name: /download/i })).toHaveLength(1);
    expect(screen.getAllByText(/data_transfer:export_sensitive/)).toHaveLength(2);
  });

  it('shows history only for a view-only account', () => {
    grant('data_transfer:view');
    renderPage();
    expect(screen.queryByRole('button', { name: 'Export' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Import' })).toBeNull();
    expect(screen.getByText('Transfer History')).toBeTruthy();
  });

  it('shows import + history for an import-only account', () => {
    grant('data_transfer:view', 'data_transfer:import');
    renderPage();
    expect(screen.queryByRole('button', { name: 'Export' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Import' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'History' })).toBeTruthy();
  });

  it('switches to the import wizard when the Import tab is clicked', async () => {
    grant(...ALL_PERMISSIONS);
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));

    expect(await screen.findByText('Select a backup file to import')).toBeTruthy();
    // The tabs own the content area exclusively — the export panel unmounted.
    expect(screen.queryByText('Standard export')).toBeNull();
  });

  it('switches to the transfer history when the History tab is clicked', async () => {
    vi.mocked(DataTransferService.transferHistory).mockResolvedValue({
      entries: [
        {
          id: 11,
          action: 'data_export',
          userId: 1,
          username: 'admin.test',
          createdAt: '2026-09-17T10:00:00Z',
          details: { export_type: 'standard', record_count: 42, export_id: 'exp-abc123' },
        },
      ],
      total: 1,
    });
    grant(...ALL_PERMISSIONS);
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'History' }));

    // Server-backed row projected through mapServerHistoryEntry.
    expect(await screen.findByText('Standard export')).toBeTruthy();
    expect(screen.getByText('admin.test')).toBeTruthy();
    expect(screen.getByText('42')).toBeTruthy();
    expect(screen.getByText('Success')).toBeTruthy();
  });

  it('reports no critical axe violations', async () => {
    grant(...ALL_PERMISSIONS);
    const { container } = renderPage();
    await expectNoCriticalAxeViolations(container);
  });
});

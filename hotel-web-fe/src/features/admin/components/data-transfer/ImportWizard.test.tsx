import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportJobStatus, ImportPreview } from '../../../../types';

const svc = vi.hoisted(() => ({
  uploadBackup: vi.fn(),
  previewImport: vi.fn(),
  executeImport: vi.fn(),
  getImportJob: vi.fn(),
  deleteUpload: vi.fn(),
  previewExport: vi.fn(),
  exportData: vi.fn(),
  stepUp: vi.fn(),
  transferHistory: vi.fn(),
}));

const auth = vi.hoisted(() => ({
  hasPermission: vi.fn(),
}));

vi.mock('../../../../api', () => ({
  DataTransferService: { ...svc },
}));

vi.mock('../../../../auth/AuthContext', () => ({
  useAuth: () => ({ hasPermission: auth.hasPermission }),
}));

vi.mock('../../../../hooks/useIsPhone', () => ({
  useIsPhone: () => false,
}));

import ImportWizard from './ImportWizard';

const previewPayload: ImportPreview = {
  uploadId: 'u1',
  format: 'v1',
  version: 3,
  exportType: 'full',
  sensitive: true,
  requiresPermissions: ['data_transfer:import_sensitive'],
  exportedAt: '2026-09-14T08:00:00Z',
  sourceEnvironment: 'production',
  applicationVersion: '1.2.3',
  entities: [{ name: 'public.guests', rows: 10, new: 8, existing: 2, skipped: 0 }],
  unsupportedEntities: [],
  validationErrors: [],
  relationshipProblems: [],
  warnings: [],
  totalRows: 10,
};

const standardPreview: ImportPreview = {
  ...previewPayload,
  exportType: 'standard',
  sensitive: false,
  requiresPermissions: [],
};

const succeededJob: ImportJobStatus = {
  status: 'succeeded',
  progress: { entity: 'public.guests', rowsApplied: 10, totalRows: 10 },
  result: {
    inserted: 8,
    updated: 0,
    skipped: 2,
    report: {
      entities: [{ entity: 'public.guests', inserted: 8, updated: 0, skipped: 2 }],
      relationshipProblems: [],
      unsupportedEntities: [],
    },
  },
};

const renderWizard = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ImportWizard notify={vi.fn()} onFinished={vi.fn()} pollIntervalMs={10} />
    </QueryClientProvider>,
  );

const pickFile = (file: File) =>
  fireEvent.change(screen.getByLabelText('Choose backup file'), { target: { files: [file] } });

const stageFile = async (preview: ImportPreview = previewPayload) => {
  svc.uploadBackup.mockResolvedValue({ uploadId: 'u1', bytes: 4, detectedFormat: 'v1' });
  svc.previewImport.mockResolvedValue(preview);
  pickFile(new File(['{}'], 'backup.json', { type: 'application/json' }));
  await screen.findByRole('button', { name: /review & import/i });
};

describe('ImportWizard', () => {
  beforeEach(() => {
    Object.values(svc).forEach((fn) => fn.mockReset());
    svc.deleteUpload.mockResolvedValue(undefined);
    auth.hasPermission.mockReset().mockReturnValue(true);
  });

  afterEach(cleanup);

  it('rejects an oversize file before any upload happens', async () => {
    renderWizard();
    const big = new File(['{}'], 'big.json');
    Object.defineProperty(big, 'size', { value: 257 * 1024 * 1024 });

    pickFile(big);

    expect(svc.uploadBackup).not.toHaveBeenCalled();
    expect((await screen.findByRole('alert')).textContent).toMatch(/limited to 256 MB/);
  });

  it('uploads the file then renders the preview with the sensitive warning', async () => {
    renderWizard();
    await stageFile();

    expect(svc.uploadBackup).toHaveBeenCalledTimes(1);
    expect(svc.previewImport).toHaveBeenCalledWith('u1');
    // Entity table: short name, row diff columns.
    expect(screen.getByText('guests')).toBeTruthy();
    expect(screen.getByText(/from production/)).toBeTruthy();
    // Sensitive file → the warning banner renders.
    expect(screen.getByText(/contains sensitive business data/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /review & import/i })).toBeTruthy();
  });

  it('blocks the import when the preview reports validation errors', async () => {
    renderWizard();
    await stageFile({ ...previewPayload, validationErrors: ['Unsupported backup version 99'] });

    expect(await screen.findByText(/cannot be imported/i)).toBeTruthy();
    expect(screen.getByText('Unsupported backup version 99')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: /review & import/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('blocks the import when the file needs a permission the account lacks', async () => {
    auth.hasPermission.mockImplementation((p: string) => p !== 'data_transfer:import_sensitive');
    renderWizard();
    await stageFile();

    expect(await screen.findByText('Additional permission required')).toBeTruthy();
    // The sensitive banner and the missing-permission alert both name it.
    expect((await screen.findAllByText(/data_transfer:import_sensitive/)).length).toBe(2);
    expect(
      (screen.getByRole('button', { name: /review & import/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('disables the restore mode without data_transfer:restore', async () => {
    auth.hasPermission.mockImplementation((p: string) => p !== 'data_transfer:restore');
    renderWizard();
    await stageFile(standardPreview);

    const restore = screen.getByRole('button', { name: /restore — replace existing data/i });
    expect((restore as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/requires the data_transfer:restore permission/i)).toBeTruthy();
  });

  it('disables the update conflict policy without data_transfer:override', async () => {
    auth.hasPermission.mockImplementation((p: string) => p !== 'data_transfer:override');
    renderWizard();
    await stageFile(standardPreview);

    const update = screen.getByLabelText(/Update — overwrite the existing row/);
    expect((update as HTMLInputElement).disabled).toBe(true);
  });

  it('shows one inline error surface when the upload fails', async () => {
    renderWizard();
    svc.uploadBackup.mockRejectedValue(new Error('backend exploded'));

    pickFile(new File(['{}'], 'backup.json'));

    const alerts = await screen.findAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].textContent).toContain('backend exploded');
    // And the flow is back at the file picker for a retry.
    expect(screen.getByLabelText('Choose backup file')).toBeTruthy();
  });

  it('runs file → preview → confirm → execute → result', async () => {
    renderWizard();
    await stageFile();

    fireEvent.click(screen.getByRole('button', { name: /review & import/i }));
    fireEvent.click(await screen.findByLabelText('Acknowledge import warning'));
    svc.executeImport.mockResolvedValue({ jobId: 'job-1' });
    svc.getImportJob.mockResolvedValue(succeededJob);
    fireEvent.click(screen.getByRole('button', { name: /start import/i }));

    await waitFor(() => expect(svc.executeImport).toHaveBeenCalledWith(
      {
        uploadId: 'u1',
        mode: 'merge',
        onConflict: 'skip',
      },
      undefined,
    ));
    expect(await screen.findByText('Import complete')).toBeTruthy();
    expect(screen.getByText('8 inserted')).toBeTruthy();
  });

  it('polls a running job until it reaches a terminal state', async () => {
    renderWizard();
    await stageFile();

    fireEvent.click(screen.getByRole('button', { name: /review & import/i }));
    fireEvent.click(await screen.findByLabelText('Acknowledge import warning'));
    svc.executeImport.mockResolvedValue({ jobId: 'job-2' });
    svc.getImportJob
      .mockResolvedValueOnce({
        status: 'running',
        progress: { entity: 'public.guests', rowsApplied: 4, totalRows: 10 },
      })
      .mockResolvedValue(succeededJob);
    fireEvent.click(screen.getByRole('button', { name: /start import/i }));

    expect(await screen.findByText(/Import running/i)).toBeTruthy();
    expect(await screen.findByText('Import complete')).toBeTruthy();
    expect(svc.getImportJob.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(svc.getImportJob).toHaveBeenCalledWith('job-2');
  });

  it('restore mode hides conflict policy and routes through step-up before executing', async () => {
    renderWizard();
    await stageFile();

    fireEvent.click(screen.getByRole('button', { name: /restore — replace existing data/i }));
    expect(screen.queryByRole('radiogroup', { name: 'Conflict policy' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /review & import/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/deletes existing data first/i)).toBeTruthy();
    expect(within(dialog).getByText(/Export a fresh backup first/i)).toBeTruthy();

    fireEvent.click(within(dialog).getByLabelText('Acknowledge import warning'));
    fireEvent.click(within(dialog).getByRole('button', { name: /restore & import/i }));

    // Restore goes through re-authentication first.
    const passwordField = await screen.findByLabelText(/Password/);
    fireEvent.change(passwordField, { target: { value: 'hunter2' } });
    svc.stepUp.mockResolvedValue({ stepUpToken: 'step-tok', expiresAt: '2026-09-15T00:02:00Z' });
    svc.executeImport.mockResolvedValue({ jobId: 'job-3' });
    svc.getImportJob.mockResolvedValue(succeededJob);
    fireEvent.click(screen.getByRole('button', { name: /verify & continue/i }));

    await waitFor(() => expect(svc.stepUp).toHaveBeenCalledWith({ password: 'hunter2' }));
    await waitFor(() =>
      expect(svc.executeImport).toHaveBeenCalledWith(
        expect.objectContaining({ mode: 'restore', onConflict: undefined }),
        'step-tok',
      ),
    );
    expect(await screen.findByText('Import complete')).toBeTruthy();
  });
});

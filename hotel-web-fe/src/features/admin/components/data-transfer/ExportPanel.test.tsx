import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExportPreview } from '../../../../types';

const svc = vi.hoisted(() => ({
  previewExport: vi.fn(),
  exportData: vi.fn(),
  stepUp: vi.fn(),
}));

const auth = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  user: { id: 1, username: 'admin.test', is_super_admin: false } as Record<string, unknown>,
}));

vi.mock('../../../../api', () => ({
  DataTransferService: { ...svc },
}));

vi.mock('../../../../auth/AuthContext', () => ({
  useAuth: () => ({ hasPermission: auth.hasPermission, user: auth.user }),
}));

import ExportPanel from './ExportPanel';

const previewPayload: ExportPreview = {
  generated_at: '2026-09-18T00:00:00Z',
  counts: { 'public.rooms': 42, 'public.rate_plans': 7 },
  total_records: 49,
  tables: [
    { name: 'public.rooms', count: 42, dependencies: [] },
    { name: 'public.rate_plans', count: 7, dependencies: [] },
  ],
  entities: [
    { name: 'public.rooms', primaryKey: ['id'], columns: ['id', 'name'] },
    { name: 'public.rate_plans', primaryKey: ['id'], columns: ['id', 'name'] },
  ],
  exclusions: [
    { name: 'public.sessions', reason: 'session_or_token_material' },
    { name: 'public.users', reason: 'credentials_and_auth_state' },
  ],
};

const renderPanel = (notify = vi.fn()) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ExportPanel notify={notify} />
    </QueryClientProvider>,
  );

/** Scope cards are unlabeled `Paper`s — locate one through its title text. */
const card = (title: string) => {
  const el = screen.getByText(title).closest('.MuiPaper-root');
  if (!el) throw new Error(`no scope card found for "${title}"`);
  return within(el as HTMLElement);
};

/** Shared tail of every gated export: the step-up dialog mints the token the
 * download is sent with. (MUI renders required-field labels as "Password *",
 * so the queries anchor on a prefix regex.) */
const verifyStepUp = async () => {
  const password = await screen.findByLabelText(/^Password/);
  fireEvent.change(password, { target: { value: 'hunter2' } });
  fireEvent.click(screen.getByRole('button', { name: /verify & continue/i }));
  await waitFor(() => expect(svc.stepUp).toHaveBeenCalledWith({ password: 'hunter2' }));
};

describe('ExportPanel', () => {
  beforeEach(() => {
    Object.values(svc).forEach((fn) => fn.mockReset());
    svc.previewExport.mockResolvedValue(previewPayload);
    svc.exportData.mockResolvedValue({ filename: 'saliminn-backup-x.json', bytes: 128 });
    svc.stepUp.mockResolvedValue({ stepUpToken: 'step-token-1', expiresAt: '2026-09-18T00:02:00Z' });
    auth.hasPermission.mockReset().mockReturnValue(true);
    auth.user = { id: 1, username: 'admin.test', is_super_admin: false };
  });

  afterEach(cleanup);

  it('renders one card per scope and hides the system tier from non-super-admins', () => {
    renderPanel();
    expect(screen.getByText('Standard export')).toBeTruthy();
    expect(screen.getByText('Full export')).toBeTruthy();
    expect(screen.getByText('Migration backup')).toBeTruthy();
    expect(screen.queryByText('Full system backup')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Download' })).toHaveLength(3);
    // The sensitive tiers advertise their extra gates up front.
    expect(screen.getByText('Restricted')).toBeTruthy();
    expect(screen.getByText('Highly restricted')).toBeTruthy();
    expect(screen.getAllByText('Re-authentication required')).toHaveLength(2);
  });

  it('locks the sensitive tiers behind data_transfer:export_sensitive', () => {
    auth.hasPermission.mockImplementation((p: string) => p === 'data_transfer:export');
    renderPanel();
    // Only the standard card keeps its actions; the rest name what they need.
    expect(screen.getAllByRole('button', { name: 'Download' })).toHaveLength(1);
    expect(screen.getAllByText('Requires data_transfer:export_sensitive')).toHaveLength(2);
  });

  it('previews a scope and renders the manifest inside its card', async () => {
    renderPanel();
    fireEvent.click(card('Standard export').getByRole('button', { name: 'Preview counts' }));

    await waitFor(() => expect(svc.previewExport).toHaveBeenCalledWith('standard'));
    const standard = card('Standard export');
    expect(await standard.findByText('49 records · 2 entities')).toBeTruthy();
    expect(standard.getByText('Never included — 2 protected tables')).toBeTruthy();
    expect(standard.getByText('rooms')).toBeTruthy();
    expect(standard.getByText('rate_plans')).toBeTruthy();
  });

  it('exports the standard scope directly with no step-up gate', async () => {
    const notify = vi.fn();
    renderPanel(notify);
    fireEvent.click(card('Standard export').getByRole('button', { name: 'Download' }));

    await waitFor(() =>
      expect(svc.exportData).toHaveBeenCalledWith('standard', undefined, undefined),
    );
    expect(svc.stepUp).not.toHaveBeenCalled();
    expect(screen.queryByText('Confirm your identity')).toBeNull();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('saliminn-backup-x.json'));
  });

  it('routes the backup scope through sensitive-confirm and step-up before downloading', async () => {
    const notify = vi.fn();
    renderPanel(notify);
    fireEvent.click(card('Migration backup').getByRole('button', { name: 'Download' }));

    // Confidential-data acknowledgement gate — Confirm stays disabled until
    // the warning is acknowledged.
    expect(await screen.findByText('This export contains confidential data')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(await screen.findByLabelText('Acknowledge sensitive export warning'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(svc.exportData).not.toHaveBeenCalled();

    // Step-up re-authentication — the fresh token goes on the download.
    await verifyStepUp();
    await waitFor(() =>
      expect(svc.exportData).toHaveBeenCalledWith('backup', 'step-token-1', undefined),
    );
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('saliminn-backup-x.json'));
  });

  it('collects a passphrase before a system export', async () => {
    const notify = vi.fn();
    auth.user = { id: 1, username: 'root.test', is_super_admin: true };
    renderPanel(notify);
    fireEvent.click(card('Full system backup').getByRole('button', { name: 'Download' }));

    fireEvent.click(await screen.findByLabelText('Acknowledge sensitive export warning'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    // The system file is always encrypted — Continue stays disabled until the
    // passphrase is long enough and both entries match.
    fireEvent.change(await screen.findByLabelText(/^Passphrase/), {
      target: { value: 'sup3r-s3cret' },
    });
    fireEvent.change(screen.getByLabelText(/^Confirm passphrase/), {
      target: { value: 'typo-pass!!' },
    });
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.change(screen.getByLabelText(/^Confirm passphrase/), {
      target: { value: 'sup3r-s3cret' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(svc.exportData).not.toHaveBeenCalled();

    await verifyStepUp();
    await waitFor(() =>
      expect(svc.exportData).toHaveBeenCalledWith('system', 'step-token-1', 'sup3r-s3cret'),
    );
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('saliminn-backup-x.json'));
  });

  it('surfaces an export failure inline and never notifies', async () => {
    const notify = vi.fn();
    svc.exportData.mockRejectedValue(new Error('disk full'));
    renderPanel(notify);
    fireEvent.click(card('Standard export').getByRole('button', { name: 'Download' }));

    expect(await screen.findByText('disk full')).toBeTruthy();
    expect(notify).not.toHaveBeenCalled();
  });
});

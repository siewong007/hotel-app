import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ConfirmProvider } from '../../../components/common/ConfirmProvider';
import type { NightAuditPreview, NightAuditRun } from '../../../api';
import { formatLocalDate } from '../../../utils/date';

const preview: NightAuditPreview = {
  audit_date: '2026-09-14',
  can_run: true,
  already_run: false,
  unposted_bookings: [
    {
      booking_id: 5,
      booking_number: 'BK-1',
      guest_name: 'Jee Jap Khong',
      room_number: '101',
      check_in_date: '2026-09-13',
      check_out_date: '2026-09-15',
      status: 'checked_in',
      total_amount: 215.8,
      payment_method: 'cash',
      source: 'walk_in',
    },
  ],
  total_unposted: 1,
  estimated_revenue: 215.8,
  room_snapshot: { total: 33, available: 20, occupied: 12, reserved: 0, maintenance: 1, dirty: 0 },
  payment_method_breakdown: [],
  booking_channel_breakdown: [],
  journal_sections: [],
};

// One completed audit, for a day other than the date picker's (today).
const pastAudit: NightAuditRun = {
  id: 7,
  audit_date: '2026-10-03',
  run_at: '2026-10-03T23:55:00Z',
  run_by_username: 'night.manager',
  status: 'completed',
  total_bookings_posted: 4,
  total_checkins: 2,
  total_checkouts: 1,
  total_revenue: 820,
  occupancy_rate: 48,
  rooms_available: 15,
  rooms_occupied: 16,
  rooms_reserved: 1,
  rooms_maintenance: 1,
  rooms_dirty: 0,
  notes: null,
  created_at: '2026-10-03T23:55:00Z',
  payment_method_breakdown: [],
  booking_channel_breakdown: [],
};

// What the signed-in staff member may do, and the history the page lists.
const access = { permissions: new Set<string>() };
let history: NightAuditRun[] = [];

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({ hasPermission: (permission: string) => access.permissions.has(permission) }),
}));

const runMutate = vi.fn().mockResolvedValue({
  audit_run: { id: 11 },
  message: 'Night audit completed',
});
const detailsFetcher = vi.fn().mockResolvedValue({ journal_sections: [] });
const previewRefetch = vi.fn().mockResolvedValue(undefined);
const historyRefetch = vi.fn().mockResolvedValue(undefined);

vi.mock('../hooks/useNightAuditQueries', () => ({
  useNightAuditPreview: () => ({
    data: preview,
    isPending: false,
    isFetching: false,
    error: null,
    refetch: previewRefetch,
  }),
  useNightAuditRuns: () => ({
    data: { data: history, total: history.length },
    isPending: false,
    error: null,
    refetch: historyRefetch,
  }),
  useNightAuditDetailsFetcher: () => detailsFetcher,
  useRunNightAudit: () => ({ mutateAsync: runMutate, isPending: false }),
}));

import NightAuditPage from './NightAuditPage';

const renderPage = () =>
  render(
    <ConfirmProvider>
      <NightAuditPage />
    </ConfirmProvider>,
  );

describe('NightAuditPage', () => {
  beforeEach(() => {
    access.permissions = new Set(['night_audit:read', 'night_audit:execute']);
    history = [];
    runMutate.mockClear();
    previewRefetch.mockClear();
    historyRefetch.mockClear();
  });

  it('shows the pending preview with a run action', async () => {
    renderPage();
    // The preview renders both an inline and a sticky-footer run button.
    const runButtons = await screen.findAllByRole('button', { name: 'Run Night Audit' });
    expect(runButtons.length).toBeGreaterThan(0);
  });

  it('confirms then runs the audit for the selected date', async () => {
    renderPage();
    const runButtons = await screen.findAllByRole('button', { name: 'Run Night Audit' });
    fireEvent.click(runButtons[runButtons.length - 1]);
    expect(await screen.findByText('Confirm Night Audit')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Run Audit' }));
    await waitFor(() => expect(runMutate).toHaveBeenCalledTimes(1));
    expect(runMutate.mock.calls[0][0]).toMatchObject({
      audit_date: formatLocalDate(),
      force: false,
    });
    expect(await screen.findByText('Night audit completed')).toBeTruthy();
    expect(previewRefetch).toHaveBeenCalled();
    expect(historyRefetch).toHaveBeenCalled();
  });

  it('cancelling the confirmation dialog does not run the audit', async () => {
    renderPage();
    const runButtons = await screen.findAllByRole('button', { name: 'Run Night Audit' });
    fireEvent.click(runButtons[runButtons.length - 1]);
    await screen.findByText('Confirm Night Audit');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByText('Confirm Night Audit')).toBeNull(),
    );
    expect(runMutate).not.toHaveBeenCalled();
  });

  it('switches to the history tab', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: 'Audit History' }));
    expect(await screen.findByText(/audits? found/i)).toBeTruthy();
  });

  it('shows the preview without run controls to staff who may not run the audit', async () => {
    access.permissions = new Set(['night_audit:read']);
    renderPage();
    expect(await screen.findByText('You have read-only access to the night audit.')).toBeTruthy();
    expect(screen.getByText('Jee Jap Khong')).toBeTruthy(); // the preview itself still shows
    expect(screen.queryAllByRole('button', { name: 'Run Night Audit' })).toHaveLength(0);
  });

  it('reruns a past audit from history for that audit’s own date', async () => {
    history = [pastAudit];
    renderPage();
    expect(screen.queryByText('You have read-only access to the night audit.')).toBeNull();
    fireEvent.click(await screen.findByRole('tab', { name: 'Audit History' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Expand audit details' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Rerun Audit' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Rerun audit' }));
    await waitFor(() => expect(runMutate).toHaveBeenCalledTimes(1));
    // Not the date picker's day (today): that would run a different audit
    // from the one on screen.
    expect(runMutate.mock.calls[0][0]).toMatchObject({ audit_date: '2026-10-03', force: true });
  });

  it('offers no rerun in history to staff who may not run the audit', async () => {
    access.permissions = new Set(['night_audit:read']);
    history = [pastAudit];
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: 'Audit History' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Expand audit details' }));
    expect(await screen.findByRole('button', { name: 'Export PDF' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Rerun Audit' })).toBeNull();
  });
});

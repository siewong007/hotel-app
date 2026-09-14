import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ConfirmProvider } from '../../../components/common/ConfirmProvider';
import type { NightAuditPreview } from '../../../api';
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
    data: { data: [], total: 0 },
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
});

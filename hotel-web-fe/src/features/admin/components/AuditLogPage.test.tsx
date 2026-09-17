import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderPage } from '../../../test/renderPage';
import { expectNoCriticalAxeViolations } from '../../../test/axe';
import type { AuditLogEntry } from '../../../types/audit.types';

const makeEntry = (over: Partial<AuditLogEntry> = {}): AuditLogEntry => ({
  id: 1,
  user_id: 7,
  username: 'receptionist.one',
  action: 'booking_updated',
  resource_type: 'booking',
  category: 'bookings',
  resource_id: 42,
  display_ref: 'BK-4471',
  details: { old_status: 'reserved', new_status: 'confirmed' },
  ip_address: '10.0.0.8',
  user_agent: 'staff-terminal',
  created_at: '2026-09-14T09:30:00Z',
  ...over,
});

const entries: AuditLogEntry[] = [
  makeEntry({ id: 1, action: 'booking_updated' }),
  makeEntry({ id: 2, action: 'report_exported', resource_type: 'report', username: null, user_id: null, resource_id: null, display_ref: null, details: null }),
];

let capturedQuery: unknown = null;
const exportCsv = vi.fn().mockResolvedValue(undefined);
const exportPdf = vi.fn().mockResolvedValue(undefined);

vi.mock('../hooks/useAuditQueries', () => ({
  useAuditLogs: (q: unknown) => {
    capturedQuery = q;
    return {
      data: { data: entries, total: entries.length, page: 1, page_size: 25, total_pages: 1 },
      isPending: false,
      isFetching: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    };
  },
  useAuditCategoryCounts: () => ({
    data: { rooms: 3, guests: 2, bookings: 9, system: 1, reports: 4, other: 1, total: 20 },
    refetch: vi.fn(),
  }),
  useAuditUsers: () => ({ data: [{ id: 7, username: 'receptionist.one' }] }),
  useAuditActions: () => ({ data: ['booking_updated', 'report_exported'] }),
  useAuditResourceTypes: () => ({ data: ['booking', 'report'] }),
  useExportAuditCsv: () => ({ mutateAsync: exportCsv, isPending: false }),
  useExportAuditPdf: () => ({ mutateAsync: exportPdf, isPending: false }),
}));

import AuditLogPage from './AuditLogPage';

const renderIt = (route = '/audit-log') => renderPage(<AuditLogPage />, { route });

describe('AuditLogPage', () => {
  beforeEach(() => {
    capturedQuery = null;
    exportCsv.mockClear();
    exportPdf.mockClear();
  });

  it('renders stream cards including All and Other, and grouped entries', async () => {
    renderIt();
    for (const name of [
      'All activity',
      'Room Activity',
      'Guest Activity',
      'Booking Activity',
      'System Configuration',
      'Report Activity',
      'Other',
    ]) {
      expect(await screen.findAllByText(name)).not.toHaveLength(0);
    }
    expect(screen.getAllByText('Booking Updated').length).toBeGreaterThan(0);
    expect(screen.getByText('BK-4471')).toBeTruthy();
  });

  it('defaults the query to the all-activity stream', async () => {
    renderIt();
    await screen.findAllByText('All activity');
    expect((capturedQuery as { category: string }).category).toBe('all');
  });

  it('switches the query category when a rail card is tapped', async () => {
    renderIt();
    await screen.findAllByText('Guest Activity');
    fireEvent.click(screen.getAllByText('Guest Activity')[0]);
    await waitFor(() =>
      expect((capturedQuery as { category: string }).category).toBe('guests'),
    );
  });

  it('expands a row to show event details and field changes', async () => {
    renderIt();
    const rowLabel = await screen.findAllByText('Booking Updated');
    fireEvent.click(rowLabel[0]);
    expect(await screen.findByText('Event details')).toBeTruthy();
    expect(screen.getByText('Status')).toBeTruthy();
    expect(screen.getByText('reserved')).toBeTruthy();
    expect(screen.getByText('confirmed')).toBeTruthy();
  });

  it('calls the CSV export mutation with the active category', async () => {
    renderIt();
    await screen.findAllByText('All activity');
    fireEvent.click(screen.getByRole('button', { name: /^Export$/ }));
    await waitFor(() => expect(exportCsv).toHaveBeenCalledTimes(1));
    expect(exportCsv.mock.calls[0][0]).toMatchObject({ category: 'all' });
  });

  it('reports no critical axe violations', async () => {
    const { container } = renderIt();
    await screen.findAllByText('All activity');
    await expectNoCriticalAxeViolations(container);
  });
});

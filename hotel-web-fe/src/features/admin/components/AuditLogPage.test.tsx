import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ConfirmProvider } from '../../../components/common/ConfirmProvider';
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
  details: { old_status: 'reserved', new_status: 'confirmed' },
  ip_address: '10.0.0.8',
  user_agent: 'staff-terminal',
  created_at: '2026-09-14T09:30:00Z',
  ...over,
});

const entries: AuditLogEntry[] = [
  makeEntry({ id: 1, action: 'booking_updated' }),
  makeEntry({ id: 2, action: 'report_exported', resource_type: 'report', username: null, user_id: null, resource_id: null, details: null }),
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
      refetch: vi.fn(),
    };
  },
  useAuditCategoryCounts: () => ({
    data: { rooms: 3, guests: 2, bookings: 9, system: 1, reports: 4 },
    refetch: vi.fn(),
  }),
  useExportAuditCsv: () => ({ mutateAsync: exportCsv, isPending: false }),
  useExportAuditPdf: () => ({ mutateAsync: exportPdf, isPending: false }),
}));

import AuditLogPage from './AuditLogPage';

const renderPage = () =>
  render(
    <ConfirmProvider>
      <AuditLogPage />
    </ConfirmProvider>,
  );

describe('AuditLogPage', () => {
  beforeEach(() => {
    capturedQuery = null;
    exportCsv.mockClear();
    exportPdf.mockClear();
  });

  it('renders the five category cards with counts and grouped entries', async () => {
    renderPage();
    for (const name of [
      'Room Activity',
      'Guest Activity',
      'Booking Activity',
      'System Configuration',
      'Report Activity',
    ]) {
      expect(await screen.findAllByText(name)).not.toHaveLength(0);
    }
    // Day-grouped entries render inside the panel body.
    expect(screen.getAllByText('Booking Updated').length).toBeGreaterThan(0);
    expect(screen.getByText('#42')).toBeTruthy();
  });

  it('switches the query category when a rail card is tapped', async () => {
    renderPage();
    await screen.findAllByText('Guest Activity');
    expect((capturedQuery as { category: string }).category).toBe('rooms');
    fireEvent.click(screen.getAllByText('Guest Activity')[0]);
    await waitFor(() =>
      expect((capturedQuery as { category: string }).category).toBe('guests'),
    );
  });

  it('filters the visible rows when a verb pill is selected', async () => {
    renderPage();
    await screen.findAllByText('Booking Updated');
    // Verb pills derive from fetched rows: Updated + Exported here.
    const exported = await screen.findByRole('button', { name: 'Exported' });
    fireEvent.click(exported);
    expect(screen.queryByText('Booking Updated')).toBeNull();
    expect(screen.getAllByText('Report Exported').length).toBeGreaterThan(0);
  });

  it('expands a row to show event details and field changes', async () => {
    renderPage();
    const rowLabel = await screen.findAllByText('Booking Updated');
    fireEvent.click(rowLabel[0]);
    expect(await screen.findByText('Event details')).toBeTruthy();
    expect(screen.getByText('status')).toBeTruthy();
    expect(screen.getByText('reserved')).toBeTruthy();
    expect(screen.getByText('confirmed')).toBeTruthy();
  });

  it('calls the CSV export mutation with the active category', async () => {
    renderPage();
    await screen.findAllByText('Room Activity');
    fireEvent.click(screen.getByRole('button', { name: /^Export$/ }));
    await waitFor(() => expect(exportCsv).toHaveBeenCalledTimes(1));
    expect(exportCsv.mock.calls[0][0]).toMatchObject({ category: 'rooms' });
  });

  it('reports no critical axe violations', async () => {
    const { container } = renderPage();
    await screen.findAllByText('Room Activity');
    await expectNoCriticalAxeViolations(container);
  });
});

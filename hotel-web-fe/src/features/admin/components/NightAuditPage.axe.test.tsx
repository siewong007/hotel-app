import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '../../../components/common/ConfirmProvider';
import { expectNoCriticalAxeViolations } from '../../../test/axe';
import type { NightAuditPreview } from '../../../api';

const preview: NightAuditPreview = {
  audit_date: '2026-09-14',
  can_run: true,
  already_run: false,
  unposted_bookings: [],
  total_unposted: 0,
  estimated_revenue: 0,
  room_snapshot: { total: 33, available: 20, occupied: 12, reserved: 0, maintenance: 1, dirty: 0 },
  payment_method_breakdown: [],
  booking_channel_breakdown: [],
  journal_sections: [],
};

vi.mock('../hooks/useNightAuditQueries', () => ({
  useNightAuditPreview: () => ({ data: preview, isPending: false, isFetching: false, error: null }),
  useNightAuditRuns: () => ({
    data: { data: [], total: 0 },
    isPending: false,
    error: null,
  }),
  useNightAuditDetailsFetcher: () => vi.fn(),
  useRunNightAudit: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import NightAuditPage from './NightAuditPage';

describe('NightAuditPage accessibility', () => {
  it('reports no critical axe violations', async () => {
    const { container } = render(
      <ConfirmProvider>
        <NightAuditPage />
      </ConfirmProvider>,
    );
    await screen.findAllByText(/Night Audit/i);
    await expectNoCriticalAxeViolations(container);
  });
});

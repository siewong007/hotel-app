import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BookingTimelineEntry, BookingWithDetails, PaymentWorkflowSummary } from '../../../../../types';

vi.mock('../../../../../hooks/useCurrency', () => ({
  useCurrency: () => ({ format: (value: number) => `RM${Number(value).toFixed(2)}` }),
}));

vi.mock('../../../../../router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children?: React.ReactNode }) => (
    <a href={to} {...rest}>{children}</a>
  ),
}));

import WorkflowDialog from './WorkflowDialog';

const booking = { id: 7, booking_number: 'BK-7' } as unknown as BookingWithDetails;

function event(overrides: Partial<BookingTimelineEntry>): BookingTimelineEntry {
  return {
    id: '1',
    source: 'payments',
    event_type: 'booking',
    title: 'Payment recorded',
    status_to: 'completed',
    created_at: '2026-10-04T00:00:00.000Z',
    ...overrides,
  };
}

function renderTimeline(timeline: BookingTimelineEntry[]) {
  render(
    <WorkflowDialog
      open
      booking={booking}
      summary={null as PaymentWorkflowSummary | null}
      timeline={timeline}
      loading={false}
      onClose={() => undefined}
    />,
  );
}

describe('WorkflowDialog payment claims', () => {
  afterEach(cleanup);

  it('labels a guest bank-transfer claim as pending approval, not a recorded payment', () => {
    renderTimeline([
      event({
        id: 'claim',
        title: 'Payment pending approval',
        status_to: 'pending',
      }),
    ]);

    // Title and the event chip. The legend still has a generic Payment key.
    expect(screen.getAllByText('Payment pending approval').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('Payment recorded')).toBeNull();
  });

  it('keeps a completed staff payment titled Payment recorded', () => {
    renderTimeline([event({ id: 'desk', title: 'Payment recorded', status_to: 'completed' })]);

    expect(screen.getByText('Payment recorded')).toBeTruthy();
    expect(screen.queryByText('Payment pending approval')).toBeNull();
  });
});

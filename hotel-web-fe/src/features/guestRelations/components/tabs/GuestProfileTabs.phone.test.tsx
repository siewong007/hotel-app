// The guest profile's five inner tables (topic subscriptions, recent
// deliveries, loyalty redemptions, vouchers, support conversations) become
// MobileCardRow lists on a phone, and stay tables everywhere else.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ isPhone: false }));

vi.mock('../../../../hooks/useIsPhone', () => ({ useIsPhone: () => mocks.isPhone }));

vi.mock('../../../../router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children?: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

const loaded = <T,>(data: T) => ({ data, isPending: false, isError: false, error: null, refetch: vi.fn() });

vi.mock('../../hooks/useGuestRelationsQueries', () => ({
  useGuestCommunications: () =>
    loaded({
      marketing_opt_in: true,
      communication_preference: 'email',
      language_preference: 'en',
      email_suppressed: false,
      subscriptions: [
        { channel: 'email', topic: 'announcements', subscribed: true, updated_at: '2026-10-01T03:00:00Z' },
      ],
      recent_deliveries: [
        { id: 41, kind: 'campaign', subject: 'Weekend offer', status: 'sent', created_at: '2026-10-02T03:00:00Z' },
      ],
    }),
  useGuestLoyalty: () =>
    loaded({
      member_number: 'LM-1',
      status: 'active',
      tier_name: 'Gold',
      tier_code: 'gold',
      available_points: 626,
      lifetime_points: 12400,
      qualifying_nights: 18,
      recent_redemptions: [
        { id: 51, reward_name: 'Free Night', points: 500, status: 'approved', created_at: '2026-10-03T03:00:00Z' },
      ],
    }),
  useGuestVouchers: () =>
    loaded([
      {
        id: 61,
        code: 'VCH-0007',
        promotion_id: 3,
        promotion_name: 'Member voucher',
        source: 'loyalty',
        status: 'available',
        expires_at: '2099-01-01',
        redeemed_at: null,
      },
    ]),
  useGuestSupportConversations: () =>
    loaded([
      {
        id: 71,
        conversation_number: 'SUP-0001',
        category: 'service_request',
        status: 'waiting_staff',
        priority: 'normal',
        assigned_to_name: null,
        is_sla_at_risk: false,
        is_sla_breached: false,
        first_response_at: null,
        first_response_due_at: '2026-10-20T04:47:00Z',
        resolution_due_at: null,
        last_activity_at: '2026-10-20T03:47:00Z',
      },
    ]),
  useGuestReviews: () => loaded([]),
  useRespondToReview: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import CommunicationTab from './CommunicationTab';
import LoyaltyVouchersTab from './LoyaltyVouchersTab';
import SupportFeedbackTab from './SupportFeedbackTab';

const renderTab = (ui: ReactElement) =>
  render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

const tabs: Array<[string, () => ReactElement, string[]]> = [
  [
    'Communication',
    () => <CommunicationTab guestId={1} guestName="Aisha" canManageConsent={false} />,
    ['Weekend offer'],
  ],
  ['Loyalty & Vouchers', () => <LoyaltyVouchersTab guestId={1} />, ['Free Night', 'VCH-0007']],
  [
    'Support & Feedback',
    () => (
      <SupportFeedbackTab
        guestId={1}
        reservations={[]}
        canWriteSupport
        canViewReviews={false}
        canRespondToReviews={false}
        onNewConversation={vi.fn()}
      />
    ),
    ['SUP-0001'],
  ],
];

describe('guest profile tabs on a phone', () => {
  beforeEach(() => {
    mocks.isPhone = false;
  });
  afterEach(cleanup);

  it.each(tabs)('%s lists its rows as cards on a phone, not a table', (_name, ui, rowTexts) => {
    mocks.isPhone = true;
    renderTab(ui());
    expect(screen.queryAllByRole('table')).toHaveLength(0);
    for (const text of rowTexts) expect(screen.getByText(text)).toBeTruthy();
  });

  it.each(tabs)('%s keeps its tables everywhere else', (_name, ui, rowTexts) => {
    renderTab(ui());
    expect(screen.queryAllByRole('table').length).toBeGreaterThan(0);
    for (const text of rowTexts) expect(screen.getByText(text)).toBeTruthy();
  });
});

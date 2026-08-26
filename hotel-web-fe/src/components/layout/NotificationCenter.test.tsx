import React from 'react';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  hasPermission: true,
  serverUnread: 3,
  items: [] as Array<Record<string, unknown>>,
}));

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1 },
    hasPermission: () => mocks.hasPermission,
  }),
}));

vi.mock('../../features/notifications/hooks/useDeliveryFeed', () => ({
  useDeliveryFeed: (params?: { tier?: string }) => {
    const all = [
        {
          id: 11,
          campaign_id: null,
          kind: 'checkout_receipt',
          guest_id: 5,
          topic: 'checkout_receipt',
          recipient_masked: 'j•••@example.com',
          subject: 'Your receipt for booking BK-1',
          status: 'sent',
          attempts: 1,
          last_error: null,
          sent_at: null,
          created_at: new Date().toISOString(),
          tier: 'transactional',
        },
        {
          id: 12,
          campaign_id: 7,
          kind: 'campaign',
          guest_id: 5,
          topic: 'announcement',
          recipient_masked: 'b•••@example.com',
          subject: 'Summer promo',
          status: 'sent',
          attempts: 1,
          last_error: null,
          sent_at: null,
          created_at: new Date().toISOString(),
          tier: 'marketing',
        },
    ];
    const items = !params?.tier || params.tier === 'all'
      ? all
      : all.filter((i) => i.tier === params.tier);
    return {
      data: {
        items,
        total: items.length,
        unread: mocks.serverUnread,
        page: 1,
        page_size: 10,
      },
      isPending: false,
    };
  },
}));

vi.mock('../../utils/notificationStore', () => ({
  useNotifications: () => ({ items: [], unreadCount: 0 }),
  markAllRead: vi.fn(),
  clearAll: vi.fn(),
  removeNotification: vi.fn(),
}));

import { NotificationCenter } from './NotificationCenter';

describe('NotificationCenter', () => {
  beforeEach(() => {
    mocks.hasPermission = true;
    mocks.serverUnread = 3;
  });

  afterEach(cleanup);

  it('shows the server unread count on the badge for staff with feed access', () => {
    render(<NotificationCenter />);

    const bell = screen.getByLabelText('Notifications (3 unread)');
    expect(bell).toBeTruthy();
  });

  it('falls back to in-app alerts count without communications:read', () => {
    mocks.hasPermission = false;

    render(<NotificationCenter />);

    // No server unread -> alerts count (0) means no "(N unread)" suffix.
    expect(screen.getByLabelText('Notifications')).toBeTruthy();
  });

  it('groups the outbox feed into priority tabs and filters by tier', () => {
    render(<NotificationCenter />);

    fireEvent.click(screen.getByRole('button', { name: /^Notifications/ }));

    // Alerts tab is default; switch to Transactional.
    fireEvent.click(screen.getByRole('tab', { name: 'Transactional' }));
    expect(screen.getByText('Your receipt for booking BK-1')).toBeTruthy();
    expect(screen.queryByText('Summer promo')).toBeNull();

    // Marketing tab shows only the campaign mail.
    fireEvent.click(screen.getByRole('tab', { name: 'Marketing' }));
    expect(screen.getByText('Summer promo')).toBeTruthy();
    expect(screen.queryByText(/receipt for booking/)).toBeNull();
  });
});

import React from 'react';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  hasPermission: true,
  feed: {
    items: [] as Array<{ id: number; subject: string; status: string }>,
    total: 0,
    unread: 0,
    page: 1,
    page_size: 20,
  },
}));

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({ hasPermission: () => mocks.hasPermission }),
}));

vi.mock('../hooks/useDeliveryFeed', () => ({
  useDeliveryFeed: () => ({
    data: mocks.feed,
    isPending: false,
  }),
}));

import NotificationsPage from './NotificationsPage';

describe('NotificationsPage', () => {
  beforeEach(() => {
    mocks.hasPermission = true;
    mocks.feed = { items: [], total: 0, unread: 0, page: 1, page_size: 20 };
  });

  afterEach(cleanup);

  it('renders a friendly empty state without feed permission', () => {
    mocks.hasPermission = false;

    render(<NotificationsPage />);

    expect(
      screen.getByText(/do not have permission/i),
    ).toBeTruthy();
  });

  it('lists deliveries and exposes the status filter', () => {
    mocks.feed = {
      ...mocks.feed,
      items: [{ id: 31, subject: 'Receipt BK-9', status: 'sent' }],
      total: 1,
    };

    render(<NotificationsPage />);

    expect(screen.getByText('Receipt BK-9')).toBeTruthy();

    // MUI Select is a combobox: open it, then pick an option.
    fireEvent.mouseDown(screen.getByRole('combobox'));
    fireEvent.click(screen.getByRole('option', { name: 'failed' }));
    expect(screen.getAllByRole('option', { hidden: true }).length).toBeGreaterThan(0);
  });

  it('shows an empty message for the active tab when nothing matches', () => {
    render(<NotificationsPage />);

    fireEvent.click(screen.getByRole('tab', { name: 'Marketing' }));
    expect(screen.getByText('Marketing: nothing here yet')).toBeTruthy();
  });
});

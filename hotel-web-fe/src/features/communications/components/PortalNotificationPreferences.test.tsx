import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getPreferences: vi.fn(),
  updatePreferences: vi.fn(),
}));

vi.mock('../api', () => ({
  PortalCommunicationsApi: {
    getPreferences: (...args: unknown[]) => mocks.getPreferences(...args),
    updatePreferences: (...args: unknown[]) => mocks.updatePreferences(...args),
  },
}));

import PortalNotificationPreferences from './PortalNotificationPreferences';

const initialPreferences = {
  subscriptions: [
    { topic: 'announcement' as const, subscribed: false },
    { topic: 'promotion' as const, subscribed: false },
    { topic: 'birthday_voucher' as const, subscribed: true },
  ],
};

function renderPreferences() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, ...render(<PortalNotificationPreferences />, { wrapper }) };
}

function switchForTopic(label: string): HTMLInputElement {
  const row = screen.getByText(label).parentElement;
  const toggle = row?.querySelector('input[role="switch"]');
  if (!(toggle instanceof HTMLInputElement)) {
    throw new Error(`No switch rendered for ${label}`);
  }
  return toggle;
}

describe('PortalNotificationPreferences', () => {
  beforeEach(() => {
    mocks.getPreferences.mockReset();
    mocks.updatePreferences.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('saves a single-topic opt-in and displays the server-confirmed preference', async () => {
    mocks.getPreferences.mockResolvedValue(initialPreferences);
    mocks.updatePreferences.mockResolvedValue({
      subscriptions: initialPreferences.subscriptions.map(subscription =>
        subscription.topic === 'promotion' ? { ...subscription, subscribed: true } : subscription
      ),
    });

    renderPreferences();

    await screen.findByText('Promotions and offers');
    const promotionToggle = switchForTopic('Promotions and offers');
    expect((promotionToggle as HTMLInputElement).checked).toBe(false);

    fireEvent.click(promotionToggle);

    await waitFor(() =>
      expect(mocks.updatePreferences).toHaveBeenCalledWith({
        subscriptions: [{ topic: 'promotion', subscribed: true }],
      })
    );
    await waitFor(() => expect((promotionToggle as HTMLInputElement).checked).toBe(true));
  });

  it('keeps the existing preference and shows a recoverable error when the update fails', async () => {
    mocks.getPreferences.mockResolvedValue(initialPreferences);
    mocks.updatePreferences.mockRejectedValue(new Error('Unable to save email preferences'));

    renderPreferences();

    await screen.findByText('Hotel announcements');
    const announcementToggle = switchForTopic('Hotel announcements');
    fireEvent.click(announcementToggle);

    await waitFor(() => expect(screen.getByText('Unable to save email preferences')).toBeTruthy());
    expect((announcementToggle as HTMLInputElement).checked).toBe(false);
  });
});

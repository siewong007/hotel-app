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

function renderPreferences(token = 'guest-token') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, ...render(<PortalNotificationPreferences token={token} />, { wrapper }) };
}

function switchForTopic(label: string): HTMLInputElement {
  const topic = {
    'Hotel announcements': 'announcement',
    'Promotions and offers': 'promotion',
    'Birthday voucher': 'birthday_voucher',
  }[label];
  if (!topic) throw new Error(`Unknown notification topic: ${label}`);
  return screen.getByRole('switch', { name: `toggle ${topic} emails` }) as HTMLInputElement;
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
      }, 'guest-token')
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

  it('shows a retry action instead of a blank panel when preferences cannot load', async () => {
    mocks.getPreferences.mockRejectedValue(new Error('Preferences are unavailable'));

    renderPreferences();

    expect(await screen.findByText('Preferences are unavailable')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(mocks.getPreferences).toHaveBeenCalledTimes(2));
    expect(mocks.getPreferences).toHaveBeenLastCalledWith('guest-token');
  });
});

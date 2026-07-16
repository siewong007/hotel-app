import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  unsubscribeAll: vi.fn(),
  unsubscribeTopic: vi.fn(),
  view: vi.fn(),
}));

vi.mock('../api', () => ({
  PublicCommunicationsApi: {
    unsubscribeAll: (...args: unknown[]) => mocks.unsubscribeAll(...args),
    unsubscribeTopic: (...args: unknown[]) => mocks.unsubscribeTopic(...args),
    view: (...args: unknown[]) => mocks.view(...args),
  },
}));

import UnsubscribePage from './UnsubscribePage';

const initialPreferences = {
  subscriptions: [
    { topic: 'announcement' as const, subscribed: true },
    { topic: 'promotion' as const, subscribed: true },
    { topic: 'birthday_voucher' as const, subscribed: true },
  ],
};

function renderPage(token = 'unsubscribe-token') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<UnsubscribePage token={token} />, { wrapper });
}

function switchForTopic(label: string): HTMLInputElement {
  const row = screen.getByText(label).parentElement;
  const toggle = row?.querySelector('input[role="switch"]');
  if (!(toggle instanceof HTMLInputElement)) {
    throw new Error(`No switch rendered for ${label}`);
  }
  return toggle;
}

describe('UnsubscribePage', () => {
  beforeEach(() => {
    mocks.unsubscribeAll.mockReset();
    mocks.unsubscribeTopic.mockReset();
    mocks.view.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('unsubscribes only the selected topic and renders the confirmed response', async () => {
    mocks.view.mockResolvedValue(initialPreferences);
    mocks.unsubscribeTopic.mockResolvedValue({
      subscriptions: initialPreferences.subscriptions.map(subscription =>
        subscription.topic === 'promotion' ? { ...subscription, subscribed: false } : subscription
      ),
    });

    renderPage('signed-token');

    await screen.findByText('Promotions and offers');
    const promotionToggle = switchForTopic('Promotions and offers');
    fireEvent.click(promotionToggle);

    await waitFor(() =>
      expect(mocks.unsubscribeTopic).toHaveBeenCalledWith('signed-token', 'promotion')
    );
    await waitFor(() => expect(screen.getByText('Your preferences were updated.')).toBeTruthy());
    expect((promotionToggle as HTMLInputElement).checked).toBe(false);
    expect((promotionToggle as HTMLInputElement).disabled).toBe(true);
  });

  it('uses the global endpoint when the guest chooses to unsubscribe from every topic', async () => {
    mocks.view.mockResolvedValue(initialPreferences);
    mocks.unsubscribeAll.mockResolvedValue({
      subscriptions: initialPreferences.subscriptions.map(subscription => ({
        ...subscription,
        subscribed: false,
      })),
    });

    renderPage('signed-token');

    await screen.findByText('Email preferences');
    fireEvent.click(screen.getByRole('button', { name: 'Unsubscribe from all emails' }));

    await waitFor(() => expect(mocks.unsubscribeAll).toHaveBeenCalledWith('signed-token'));
    await waitFor(() => expect(screen.getByText('Your preferences were updated.')).toBeTruthy());
    expect(switchForTopic('Hotel announcements').disabled).toBe(true);
  });

  it('shows a safe error state for an invalid or expired unsubscribe link', async () => {
    mocks.view.mockRejectedValue(new Error('Invalid token'));

    renderPage();

    expect(
      await screen.findByText(/this unsubscribe link is invalid or no longer available/i)
    ).toBeTruthy();
    expect(mocks.unsubscribeTopic).not.toHaveBeenCalled();
    expect(mocks.unsubscribeAll).not.toHaveBeenCalled();
  });
});

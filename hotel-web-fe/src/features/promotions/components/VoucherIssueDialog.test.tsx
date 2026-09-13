import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Guest } from '../../../types/guest.types';
import type { Promotion } from '../types';

const getGuestsPage = vi.fn();

vi.mock('../../../api/guests.service', () => ({
  GuestsService: {
    getGuestsPage: (...args: unknown[]) => getGuestsPage(...args),
  },
}));

import { VoucherIssueDialog } from './VoucherIssueDialog';

function buildPromotion(overrides: Partial<Promotion> = {}): Promotion {
  return {
    id: 2,
    slug: 'stay-longer',
    name: 'Stay longer',
    status: 'published',
    promotion_kind: 'voucher',
    discount_type: 'percentage',
    discount_value: 15,
    currency: 'USD',
    claimed_count: 0,
    per_guest_limit: 1,
    is_public: true,
    room_type_ids: [],
    version: 1,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

const guestFixture: Guest = {
  id: 9,
  nick_name: 'Aisha',
  is_active: true,
  guest_type: 'non_member',
  created_at: '2026-01-01T00:00:00Z',
} as Guest;

function renderDialog(
  overrides: Partial<React.ComponentProps<typeof VoucherIssueDialog>> = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const props = {
    open: true,
    promotions: [buildPromotion()],
    isSaving: false,
    onClose: vi.fn(),
    onIssue: vi.fn(),
    ...overrides,
  };
  render(<VoucherIssueDialog {...props} />, { wrapper });
  return props;
}

async function chooseGuest(name: string) {
  const guestInput = screen.getByLabelText('Guest');
  fireEvent.mouseDown(guestInput);
  const option = await screen.findByText(name);
  fireEvent.click(option);
}

describe('VoucherIssueDialog', () => {
  beforeEach(() => {
    getGuestsPage.mockReset();
    getGuestsPage.mockResolvedValue({
      data: [guestFixture],
      total: 1,
      page: 1,
      page_size: 10,
    });
  });

  afterEach(() => cleanup());

  it('disables offers that cannot issue vouchers with the reason shown', () => {
    renderDialog({
      promotions: [
        buildPromotion(),
        buildPromotion({
          id: 7,
          name: 'Closed offer',
          claim_ends_at: '2000-01-01T00:00:00Z',
        }),
      ],
    });
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Offer' }));
    const closed = screen.getByText('Closed offer').closest('[role="option"]');
    expect(closed?.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText(/Claim window closed/)).toBeTruthy();
  });

  it('requires a guest before issuing', async () => {
    const { onIssue } = renderDialog();
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Offer' }));
    fireEvent.click(await screen.findByText('Stay longer'));
    fireEvent.click(screen.getByRole('button', { name: 'Issue voucher' }));
    expect(await screen.findByText(/Choose a guest/)).toBeTruthy();
    expect(onIssue).not.toHaveBeenCalled();
  });

  it('rejects an expiry in the past', async () => {
    const { onIssue } = renderDialog();
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Offer' }));
    fireEvent.click(await screen.findByText('Stay longer'));
    await chooseGuest('Aisha');
    fireEvent.change(screen.getByLabelText('Expires at'), {
      target: { value: '2020-01-01T00:00' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Issue voucher' }));
    expect(
      await screen.findByText(/Expiry must be in the future/),
    ).toBeTruthy();
    expect(onIssue).not.toHaveBeenCalled();
  });

  it('issues with the normalized custom code and expiry', async () => {
    const { onIssue } = renderDialog();
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Offer' }));
    fireEvent.click(await screen.findByText('Stay longer'));
    await chooseGuest('Aisha');
    fireEvent.change(screen.getByLabelText('Custom voucher code'), {
      target: { value: 'ab-12 34cd' },
    });
    fireEvent.change(screen.getByLabelText('Expires at'), {
      target: { value: '2099-06-01T10:30' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Issue voucher' }));
    await waitFor(() => expect(onIssue).toHaveBeenCalled());
    expect(onIssue).toHaveBeenCalledWith({
      promotion_id: 2,
      guest_id: 9,
      code: 'AB1234CD',
      expires_at: new Date('2099-06-01T10:30').toISOString(),
    });
  });
});

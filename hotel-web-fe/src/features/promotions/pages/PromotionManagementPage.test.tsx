import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PromotionManagementPage />
    </QueryClientProvider>,
  );

const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  promotions: {
    data: { items: [], total: 0 } as { items: unknown[]; total: number } | undefined,
    isLoading: false,
    error: null as unknown,
    refetch: vi.fn(),
  },
  vouchers: {
    data: { items: [], total: 0 } as { items: unknown[]; total: number } | undefined,
    isLoading: false,
    error: null as unknown,
    refetch: vi.fn(),
  },
  summary: { data: undefined as unknown, isLoading: false },
}));

const emptyMutation = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, error: null };

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({ hasPermission: mocks.hasPermission }),
}));

vi.mock('../../../components/common/ConfirmProvider', () => ({
  useConfirm: () => vi.fn(),
}));

vi.mock('../hooks/usePromotionAdmin', () => ({
  useAdminPromotions: () => mocks.promotions,
  useAdminVouchers: () => mocks.vouchers,
  useVoucherSummary: () => mocks.summary,
  useCreatePromotion: () => emptyMutation,
  useUpdatePromotion: () => emptyMutation,
  usePromotionTransition: () => emptyMutation,
  useIssueVoucher: () => emptyMutation,
  useRevokeVoucher: () => emptyMutation,
  useTargetingOptions: () => ({ data: undefined, isLoading: false }),
  useAdminVoucher: () => ({ data: undefined, isLoading: false }),
  useAdminPromotion: () => ({ data: undefined, isLoading: false }),
  useCampaignPerformance: () => ({ data: undefined, isLoading: false }),
}));

import PromotionManagementPage from './PromotionManagementPage';
import { expectNoCriticalAxeViolations } from '../../../test/axe';

describe('PromotionManagementPage', () => {
  beforeEach(() => {
    mocks.hasPermission.mockReturnValue(true);
    mocks.promotions.data = { items: [], total: 0 };
    mocks.vouchers.data = { items: [], total: 0 };
  });

  afterEach(cleanup);

  it('renders the promotions workspace', () => {
    renderPage();
    expect(document.body.textContent?.length).toBeGreaterThan(0);
  });

  it('reports no critical axe violations', async () => {
    const { container } = renderPage();
    await expectNoCriticalAxeViolations(container);
  });
});

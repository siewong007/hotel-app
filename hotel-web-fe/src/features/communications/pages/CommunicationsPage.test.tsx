import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listCampaigns: vi.fn(),
  listTemplates: vi.fn(),
  listSuppressions: vi.fn(),
}));

vi.mock('../api', () => ({
  CommunicationsApi: {
    listCampaigns: mocks.listCampaigns,
    listTemplates: mocks.listTemplates,
    listSuppressions: mocks.listSuppressions,
    audienceCount: vi.fn().mockResolvedValue({ count: 0 }),
    listDeliveries: vi.fn(),
    previewCampaign: vi.fn(),
    scheduleCampaign: vi.fn(),
    cancelCampaign: vi.fn(),
    testSendCampaign: vi.fn(),
    createCampaign: vi.fn(),
    updateCampaign: vi.fn(),
    createTemplate: vi.fn(),
    updateTemplate: vi.fn(),
    deactivateTemplate: vi.fn(),
    addSuppression: vi.fn(),
    removeSuppression: vi.fn(),
  },
}));

vi.mock('../../promotions/api/promotionsApi', () => ({
  PromotionsApi: { listAdmin: vi.fn().mockResolvedValue({ items: [], total: 0 }) },
}));

vi.mock('../../segments/api', () => ({
  SegmentsApi: { list: vi.fn().mockResolvedValue({ items: [], total: 0 }) },
}));

vi.mock('../../../hooks/useIsPhone', () => ({
  useIsPhone: () => false,
}));

import CommunicationsPage from './CommunicationsPage';
import { expectNoCriticalAxeViolations } from '../../../test/axe';

const renderPage = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <CommunicationsPage />
    </QueryClientProvider>,
  );

describe('CommunicationsPage', () => {
  beforeEach(() => {
    mocks.listCampaigns.mockResolvedValue({ items: [], total: 0 });
    mocks.listTemplates.mockResolvedValue([]);
    mocks.listSuppressions.mockResolvedValue([]);
  });

  afterEach(cleanup);

  it('renders the communications tabs', () => {
    renderPage();
    expect(screen.getByRole('tab', { name: 'Email Campaigns' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Templates' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Suppressions' })).toBeTruthy();
  });

  it('loads campaigns for the default tab', async () => {
    renderPage();
    await waitFor(() => expect(mocks.listCampaigns).toHaveBeenCalled());
  });

  it('reports no critical axe violations', async () => {
    const { container } = renderPage();
    await waitFor(() => expect(mocks.listCampaigns).toHaveBeenCalled());
    await expectNoCriticalAxeViolations(container);
  });
});

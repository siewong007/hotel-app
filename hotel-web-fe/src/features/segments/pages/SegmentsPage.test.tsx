import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SegmentListResponse } from '../types';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  preview: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  hasPermission: vi.fn(),
}));

vi.mock('../api', () => ({
  SegmentsApi: {
    list: mocks.list,
    preview: mocks.preview,
    update: mocks.update,
    remove: mocks.remove,
    create: vi.fn(),
  },
}));

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({ hasPermission: mocks.hasPermission }),
}));

vi.mock('../../../components/common/ConfirmProvider', () => ({
  useConfirm: () => vi.fn(),
}));

vi.mock('../../../hooks/useIsPhone', () => ({
  useIsPhone: () => false,
}));

import SegmentsPage from './SegmentsPage';
import { expectNoCriticalAxeViolations } from '../../../test/axe';

const listResponse: SegmentListResponse = {
  items: [
    {
      id: 1,
      name: 'VIP Guests',
      slug: 'vip-guests',
      description: 'High-value repeat guests',
      rules: { groups: [{ conditions: [{ field: 'total_spent', op: 'gte', value: 5000 }] }] },
      is_active: true,
      member_count: 12,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-09-01T00:00:00Z',
    },
  ],
  total: 1,
  page: 1,
  page_size: 50,
};

const renderPage = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <SegmentsPage />
    </QueryClientProvider>,
  );

describe('SegmentsPage', () => {
  beforeEach(() => {
    mocks.list.mockResolvedValue(listResponse);
    mocks.hasPermission.mockReturnValue(true);
  });

  afterEach(cleanup);

  it('renders the segment list from the API', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('VIP Guests')).toBeTruthy());
    expect(screen.getByText('12')).toBeTruthy();
  });

  it('shows the empty state when no segments exist', async () => {
    mocks.list.mockResolvedValue({ ...listResponse, items: [], total: 0 });
    renderPage();
    await waitFor(() => expect(screen.getByText(/no segments/i)).toBeTruthy());
  });

  it('reports no critical axe violations', async () => {
    const { container } = renderPage();
    await waitFor(() => expect(screen.getByText('VIP Guests')).toBeTruthy());
    await expectNoCriticalAxeViolations(container);
  });
});

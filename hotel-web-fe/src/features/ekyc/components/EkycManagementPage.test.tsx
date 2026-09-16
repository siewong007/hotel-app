import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  list: {
    data: undefined as unknown,
    isPending: false,
    isFetching: false,
    isLoading: false,
    error: null as unknown,
    refetch: vi.fn(),
  },
  detail: { data: undefined as unknown, isPending: false },
  reasonCodes: { data: [] as unknown[] },
}));

const emptyMutation = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({ hasPermission: () => true, user: { id: 'u1' } }),
}));

vi.mock('../../../hooks/useIsPhone', () => ({
  useIsPhone: () => false,
}));

vi.mock('../hooks/useEkycQueries', () => ({
  useAllEkycVerifications: () => mocks.list,
  useEkycApplication: () => mocks.detail,
  useEkycReasonCodes: () => mocks.reasonCodes,
  useRevealEkycField: () => emptyMutation,
  useReviewEkycAction: () => emptyMutation,
  useApproveEkyc: () => emptyMutation,
  useRejectEkyc: () => emptyMutation,
}));

vi.mock('../../../api/ekyc.service', () => ({
  EkycService: { exportEkycApplications: vi.fn() },
}));

vi.mock('./EkycCreateDialog', () => ({
  default: () => null,
}));

import EkycManagementPage from './EkycManagementPage';
import { expectNoCriticalAxeViolations } from '../../../test/axe';

describe('EkycManagementPage', () => {
  beforeEach(() => {
    mocks.list = {
      data: { data: [], total: 0, metrics: undefined },
      isPending: false,
      isFetching: false,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    };
    mocks.detail = { data: undefined, isPending: false };
    mocks.reasonCodes = { data: [] };
  });

  afterEach(cleanup);

  it('renders the eKYC review queue', () => {
    render(<EkycManagementPage />);
    expect(document.body.textContent?.length).toBeGreaterThan(0);
  });

  it('reports no critical axe violations', async () => {
    const { container } = render(<EkycManagementPage />);
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    await expectNoCriticalAxeViolations(container);
  });
});

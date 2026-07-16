import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '../../../api/queryKeys';
import { portalSessionScope } from '../../promotions/utils';
import { getPortalToken } from '../api/portalTokenStore';

const navigate = vi.fn();
const login = vi.fn();

vi.mock('../../../router', () => ({
  useNavigate: () => navigate,
}));

vi.mock('../api/guestPortalDashboard.service', () => ({
  GuestPortalDashboardService: {
    login: (...args: unknown[]) => login(...args),
  },
}));

import { PortalLoginPage } from './PortalLoginPage';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe('PortalLoginPage cache safety', () => {
  beforeEach(() => {
    navigate.mockReset();
    login.mockReset();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('clears previous guest promotion and voucher cache data before accepting a new portal session', async () => {
    login.mockResolvedValue({
      token: 'new-guest-token',
      expires_at: '2999-01-01T00:00:00Z',
    });
    const { queryClient, wrapper } = createWrapper();
    const priorScope = portalSessionScope('prior-guest-token');
    const priorCatalogKey = queryKeys.promotions.portalCatalog(priorScope, {
      page: 1,
      page_size: 50,
    });
    const priorVoucherKey = queryKeys.promotions.portalVouchers(priorScope, {
      page: 1,
      page_size: 50,
    });
    queryClient.setQueryData(priorCatalogKey, { items: [{ promotion: { id: 1 } }] });
    queryClient.setQueryData(priorVoucherKey, { items: [{ id: 1, code: 'PRIVATE-OLD' }] });

    render(<PortalLoginPage />, { wrapper });
    fireEvent.change(screen.getByPlaceholderText('Enter your email address'), {
      target: { value: 'guest@example.com' },
    });
    fireEvent.change(screen.getByPlaceholderText('Enter your booking/folio number'), {
      target: { value: 'BK-101' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(login).toHaveBeenCalledWith({
        email: 'guest@example.com',
        booking_number: 'BK-101',
      });
    });
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/portal', { replace: true }));

    expect(queryClient.getQueryData(priorCatalogKey)).toBeUndefined();
    expect(queryClient.getQueryData(priorVoucherKey)).toBeUndefined();
    expect(getPortalToken()).toBe('new-guest-token');
  });

  it('does not discard an existing session cache when portal sign-in fails', async () => {
    login.mockRejectedValue(new Error('Network error'));
    const { queryClient, wrapper } = createWrapper();
    const priorCatalogKey = queryKeys.promotions.portalCatalog(
      portalSessionScope('prior-guest-token'),
      { page: 1, page_size: 50 }
    );
    queryClient.setQueryData(priorCatalogKey, { items: [{ promotion: { id: 1 } }] });

    render(<PortalLoginPage />, { wrapper });
    fireEvent.change(screen.getByPlaceholderText('Enter your email address'), {
      target: { value: 'guest@example.com' },
    });
    fireEvent.change(screen.getByPlaceholderText('Enter your booking/folio number'), {
      target: { value: 'BK-101' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() =>
      expect(
        screen.getByText('We could not find a matching account. Please check your details and try again.')
      ).toBeTruthy()
    );
    expect(queryClient.getQueryData(priorCatalogKey)).toEqual({ items: [{ promotion: { id: 1 } }] });
    expect(navigate).not.toHaveBeenCalled();
  });
});

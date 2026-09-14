import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
}));

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({ hasPermission: mocks.hasPermission, user: { id: 'u1', username: 'admin' } }),
}));

vi.mock('../../../hooks/useIsPhone', () => ({
  useIsPhone: () => false,
}));

import DataTransferPage from './DataTransferPage';
import { expectNoCriticalAxeViolations } from '../../../test/axe';

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <DataTransferPage />
    </QueryClientProvider>,
  );

describe('DataTransferPage', () => {
  beforeEach(() => {
    mocks.hasPermission.mockReturnValue(true);
  });

  afterEach(cleanup);

  it('denies access without settings:manage', () => {
    mocks.hasPermission.mockReturnValue(false);
    renderPage();
    expect(screen.queryByText('System Configuration')).toBeNull();
  });

  it('renders export sections for permitted admins', () => {
    renderPage();
    expect(screen.getAllByText('System Configuration').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Operational Data').length).toBeGreaterThan(0);
  });

  it('reports no critical axe violations', async () => {
    const { container } = renderPage();
    await expectNoCriticalAxeViolations(container);
  });
});

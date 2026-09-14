import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  hasRole: vi.fn(),
  user: { id: 'u1', username: 'admin', is_super_admin: true } as Record<string, unknown>,
}));

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({ hasPermission: mocks.hasPermission, hasRole: mocks.hasRole, user: mocks.user }),
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
    mocks.hasPermission.mockReset().mockReturnValue(true);
    mocks.hasRole.mockReset().mockReturnValue(false);
    mocks.user = { id: 'u1', username: 'admin', is_super_admin: true };
  });

  afterEach(cleanup);

  it('denies access without settings:manage', () => {
    mocks.hasPermission.mockReturnValue(false);
    renderPage();
    expect(screen.queryByRole('button', { name: /download backup/i })).toBeNull();
    expect(screen.getByText(/do not have permission/i)).toBeTruthy();
  });

  it('renders the export panel with tabs for a super admin (flag)', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /download backup/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Import' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'History' })).toBeTruthy();
  });

  it('shows the import tab for the super_admin role without the flag', () => {
    mocks.user = { id: 'u2', username: 'super', is_super_admin: false };
    mocks.hasRole.mockImplementation((role: string) => role === 'super_admin');
    renderPage();
    expect(screen.getByRole('button', { name: 'Import' })).toBeTruthy();
  });

  it('shows export only — no import/history tabs — for a plain admin', () => {
    mocks.user = { id: 'u3', username: 'admin2', is_super_admin: false };
    renderPage();
    expect(screen.getByRole('button', { name: /download backup/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Import' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'History' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Transfer history' })).toBeNull();
  });

  it('reports no critical axe violations', async () => {
    const { container } = renderPage();
    await expectNoCriticalAxeViolations(container);
  });
});

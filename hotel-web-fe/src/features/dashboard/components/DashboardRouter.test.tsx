import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  roles: [] as string[],
  navigate: vi.fn(),
}));

vi.mock('../../../router', () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({
    hasRole: (role: string) => mocks.roles.includes(role),
  }),
}));

vi.mock('./reports/ReportsAnalytics', () => ({
  default: () => <div data-testid="reports-analytics" />,
}));

vi.mock('../../user/components/UserProfilePage', () => ({
  default: () => <div data-testid="user-profile" />,
}));

import DashboardRouter from './DashboardRouter';

describe('DashboardRouter', () => {
  beforeEach(() => {
    mocks.roles = [];
    mocks.navigate.mockReset();
  });

  afterEach(cleanup);

  it.each([
    ['admin', 'reports'],
    ['super_admin', 'reports'],
    ['manager', 'reports'],
  ])('lands %s on the analytics dashboard', (role, expected) => {
    mocks.roles = [role];

    render(<DashboardRouter />);

    expect(screen.getByTestId(expected === 'reports' ? 'reports-analytics' : 'user-profile')).toBeTruthy();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('lands receptionist/employee roles on the profile page', () => {
    for (const role of ['receptionist', 'employee']) {
      cleanup();
      mocks.roles = [role];

      render(<DashboardRouter />);

      expect(screen.getByTestId('user-profile')).toBeTruthy();
      expect(mocks.navigate).not.toHaveBeenCalled();
    }
  });

  it('redirects unrecognised roles to the guest portal', () => {
    mocks.roles = ['guest'];

    render(<DashboardRouter />);

    expect(mocks.navigate).toHaveBeenCalledWith('/guest-portal', { replace: true });
    expect(screen.queryByTestId('reports-analytics')).toBeNull();
  });

  it('treats combined staff roles as staff even when guest is also present', () => {
    // A user can hold multiple roles; any staff role wins over the redirect.
    mocks.roles = ['guest', 'receptionist'];

    render(<DashboardRouter />);

    expect(screen.getByTestId('user-profile')).toBeTruthy();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});

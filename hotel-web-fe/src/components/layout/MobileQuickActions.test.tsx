import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ hasPermission: () => true, hasRole: () => false, getRoutePolicy: () => undefined }),
}));
vi.mock('../../router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('./CommandPalette', () => ({ useCommandPalette: () => ({ open: vi.fn() }) }));

import { MobileQuickActions } from './MobileQuickActions';
import { MOBILE_ACTION_BAR_ATTR, mobileActionBarProps } from '../common/mobileActionBar';

describe('MobileQuickActions', () => {
  afterEach(cleanup);

  it('shows the FAB when no page action bar is pinned', () => {
    render(<MobileQuickActions />);
    const fab = screen.getByRole('button', { name: 'Quick actions' });
    expect(getComputedStyle(fab).display).not.toBe('none');
  });

  it('steps aside while a page action bar is on screen', () => {
    render(
      <>
        <div {...mobileActionBarProps}>Unsaved changes</div>
        <MobileQuickActions />
      </>,
    );
    expect(document.querySelector(`[${MOBILE_ACTION_BAR_ATTR}]`)).toBeTruthy();
    // Hidden from the accessibility tree too, not just visually.
    expect(screen.queryByRole('button', { name: 'Quick actions' })).toBeNull();
    const fab = document.querySelector('[aria-label="Quick actions"]') as HTMLElement;
    expect(getComputedStyle(fab).display).toBe('none');
  });
});

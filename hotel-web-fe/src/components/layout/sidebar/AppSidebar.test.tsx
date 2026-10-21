// The sidebar publishes its current width as `--hotel-sidebar-width` so that
// overlays pinned to the viewport (Online Inventory's staged-changes bar) can
// start where the content area does: the drawer is painted above them and
// would otherwise hide their left end on every tablet.
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isPhone: false,
  railLocked: false,
  collapsed: false as boolean | null,
}));

vi.mock('@mui/material', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mui/material')>();
  return {
    ...actual,
    // `down('sm')` asks "phone?", `down('lg')` asks "rail locked?".
    useMediaQuery: (query: string) => (query.includes('599') ? mocks.isPhone : mocks.railLocked),
  };
});

vi.mock('../../../utils/storage', () => ({
  storage: { getItem: () => mocks.collapsed, setItem: vi.fn() },
}));

vi.mock('./SidebarContent', () => ({ SidebarContent: () => null }));

import { AppSidebar, SIDEBAR_WIDTH_VAR } from './AppSidebar';

const published = () => document.documentElement.style.getPropertyValue(SIDEBAR_WIDTH_VAR);

describe('AppSidebar', () => {
  beforeEach(() => {
    mocks.isPhone = false;
    mocks.railLocked = false;
    mocks.collapsed = null;
  });
  afterEach(cleanup);

  it('publishes the expanded width on a wide screen', () => {
    render(<AppSidebar />);
    expect(published()).toBe('264px');
  });

  it('publishes the rail width on a tablet, and when the user collapsed it', () => {
    mocks.railLocked = true;
    const { unmount } = render(<AppSidebar />);
    expect(published()).toBe('72px');
    unmount();

    mocks.railLocked = false;
    mocks.collapsed = true;
    render(<AppSidebar />);
    expect(published()).toBe('72px');
  });

  it('publishes zero on a phone, where no sidebar is drawn', () => {
    mocks.isPhone = true;
    render(<AppSidebar />);
    expect(published()).toBe('0px');
  });

  it('withdraws the width when the shell unmounts', () => {
    const { unmount } = render(<AppSidebar />);
    unmount();
    expect(published()).toBe('');
  });
});

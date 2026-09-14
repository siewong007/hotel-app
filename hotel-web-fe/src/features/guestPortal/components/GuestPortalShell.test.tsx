import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  search: '?section=overview',
  navigate: vi.fn(),
  portalToken: 'portal-token' as string | null,
  hotelName: 'Salim Inn',
  signOut: vi.fn(),
  user: {
    full_name: 'Aina Rahman',
    username: 'aina',
    email: 'aina@example.com',
    user_type: 'guest',
  } as Record<string, unknown> | null,
}));

const changeListeners = new Set<() => void>();

vi.mock('../../../router', () => ({
  Link: ({
    children,
    ...rest
  }: { children?: React.ReactNode } & Record<string, unknown>) => (
    <a {...rest}>{children}</a>
  ),
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ search: mocks.search, pathname: '/guest-portal' }),
}));

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({ user: mocks.user, isAuthenticated: Boolean(mocks.user) }),
}));

vi.mock('../hooks/useGuestSignOut', () => ({
  useGuestSignOut: () => mocks.signOut,
}));

vi.mock('../api/portalTokenStore', () => ({
  getValidPortalToken: () => mocks.portalToken,
  PORTAL_TOKEN_CHANGE_EVENT: 'portal-token-change',
}));

vi.mock('./GuestPortalNotificationBell', () => ({
  GuestPortalNotificationBell: () => <div data-testid="notification-bell" />,
}));

const supportWidgetProps = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }));

vi.mock('./PortalSupportWidget', () => ({
  PortalSupportWidget: (props: Record<string, unknown>) => {
    supportWidgetProps.current = props;
    return props.open ? <div data-testid="support-widget" /> : null;
  },
}));

vi.mock('../../../utils/hotelSettings', () => ({
  getHotelSettings: () => ({ hotel_name: mocks.hotelName }),
}));

import { GuestPortalShell } from './GuestPortalShell';

describe('GuestPortalShell', () => {
  beforeEach(() => {
    mocks.search = '?section=overview';
    mocks.portalToken = 'portal-token';
    mocks.navigate.mockReset();
    mocks.signOut.mockReset();
    mocks.user = {
      full_name: 'Aina Rahman',
      username: 'aina',
      email: 'aina@example.com',
      user_type: 'guest',
    };
    supportWidgetProps.current = null;
  });

  afterEach(cleanup);

  it('renders the primary navigation, booking CTA, and children content', () => {
    render(
      <GuestPortalShell>
        <p>portal page body</p>
      </GuestPortalShell>,
    );

    expect(screen.getByText('portal page body')).toBeTruthy();
    for (const label of ['Home', 'Stays', 'Points']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getByText('Book a stay')).toBeTruthy();
    expect(screen.getByTestId('notification-bell')).toBeTruthy();
  });

  it('groups rewards destinations under the Rewards menu', () => {
    render(
      <GuestPortalShell>
        <p>body</p>
      </GuestPortalShell>,
    );

    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Rewards' }));

    const menu = screen.getByRole('menu');
    for (const label of ['Offers', 'Vouchers', 'Free nights']) {
      expect(menu.textContent).toContain(label);
    }
  });

  it('marks the active section as the current page', () => {
    mocks.search = '?section=stays';

    render(
      <GuestPortalShell>
        <p>body</p>
      </GuestPortalShell>,
    );

    const stays = screen.getAllByText('Stays');
    const currents = stays.filter(
      (el) => el.closest('[aria-current="page"]') !== null,
    );
    expect(currents.length).toBeGreaterThan(0);
  });

  it('marks the active rewards item current inside the menu', () => {
    mocks.search = '?section=vouchers';

    render(
      <GuestPortalShell>
        <p>body</p>
      </GuestPortalShell>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Rewards' }));
    const vouchers = screen.getByRole('menuitem', { name: 'Vouchers' });
    expect(vouchers.getAttribute('aria-current')).toBe('page');
  });

  it('shows the guest identity, account sections, and sign out in the account menu', () => {
    render(
      <GuestPortalShell>
        <p>body</p>
      </GuestPortalShell>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Account' }));

    const menu = screen.getByRole('menu');
    expect(menu.textContent).toContain('Aina Rahman');
    expect(menu.textContent).toContain('aina@example.com');
    for (const label of ['Profile', 'Identity', 'Security', 'Preferences']) {
      expect(menu.textContent).toContain(label);
    }
    expect(menu.textContent).toContain('Explore hotel');
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeTruthy();
  });

  it('signs out from the account menu', () => {
    render(
      <GuestPortalShell>
        <p>body</p>
      </GuestPortalShell>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Account' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));

    expect(mocks.signOut).toHaveBeenCalledTimes(1);
  });

  it('groups the mobile More sheet into rewards and account sections', () => {
    render(
      <GuestPortalShell>
        <p>body</p>
      </GuestPortalShell>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'More' }));

    const sheet = screen.getByRole('list');
    expect(sheet.textContent).toContain('Rewards');
    expect(sheet.textContent).toContain('Account');
    for (const label of ['Offers', 'Vouchers', 'Free nights', 'Profile', 'Identity', 'Security', 'Preferences']) {
      expect(sheet.textContent).toContain(label);
    }
    expect(sheet.textContent).toContain('Explore hotel');
    expect(sheet.textContent).toContain('Sign out');
    // Identity header sits above the list inside the sheet.
    expect(screen.getAllByText('Aina Rahman').length).toBeGreaterThan(0);
    expect(screen.getAllByText('aina@example.com').length).toBeGreaterThan(0);
  });

  it('marks the Book CTA current on the booking view', () => {
    mocks.search = '?view=booking';

    render(
      <GuestPortalShell>
        <p>body</p>
      </GuestPortalShell>,
    );

    const book = screen.getByText('Book a stay');
    expect(book.closest('[aria-current="page"]')).not.toBeNull();
  });

  it('opens the support widget for the ?section=support deep link when a session exists', () => {
    mocks.search = '?section=support';

    render(
      <GuestPortalShell>
        <p>body</p>
      </GuestPortalShell>,
    );

    expect(supportWidgetProps.current?.open).toBe(true);
    // Closing from inside the widget clears the deep link so it does not
    // immediately reopen.
    (supportWidgetProps.current!.onOpenChange as (next: boolean) => void)(false);
    expect(mocks.navigate).toHaveBeenCalledWith('/guest-portal?section=overview');
  });

  it('keeps the support widget closed outside the deep link', () => {
    render(
      <GuestPortalShell>
        <p>body</p>
      </GuestPortalShell>,
    );

    expect(supportWidgetProps.current?.open).toBe(false);
  });

  it('does not render the support widget without a portal session', () => {
    mocks.portalToken = null;

    render(
      <GuestPortalShell>
        <p>body</p>
      </GuestPortalShell>,
    );

    expect(supportWidgetProps.current).toBeNull();
  });

  it('offers sign-in instead of the account menu for anonymous visitors', () => {
    render(
      <GuestPortalShell showAccountNav={false}>
        <p>body</p>
      </GuestPortalShell>,
    );

    expect(screen.getByText('Sign in')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Account' })).toBeNull();
  });
});

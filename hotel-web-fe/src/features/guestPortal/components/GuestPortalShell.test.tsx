import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  search: '?section=overview',
  navigate: vi.fn(),
  portalToken: 'portal-token' as string | null,
  hotelName: 'Salim Inn',
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
    supportWidgetProps.current = null;
  });

  afterEach(cleanup);

  it('renders the desktop navigation, booking CTA, and children content', () => {
    render(
      <GuestPortalShell>
        <p>portal page body</p>
      </GuestPortalShell>,
    );

    expect(screen.getByText('portal page body')).toBeTruthy();
    for (const label of ['Home', 'Stays', 'Points', 'Offers', 'Vouchers', 'Free nights', 'Identity', 'Preferences']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getByText('Book a stay')).toBeTruthy();
    expect(screen.getByText('Explore hotel')).toBeTruthy();
    expect(screen.getByTestId('notification-bell')).toBeTruthy();
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
});

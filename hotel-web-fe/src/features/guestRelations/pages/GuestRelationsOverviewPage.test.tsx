import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { GuestRelationsOverview } from '../../../types';

const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  navigate: vi.fn(),
  overviewQuery: {
    data: undefined as GuestRelationsOverview | undefined,
    error: null as unknown,
    isPending: false,
  },
}));

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({ hasPermission: mocks.hasPermission, user: { id: 3 } }),
}));

vi.mock('../../../router', () => ({
  useNavigate: () => mocks.navigate,
  // The compat Link is an untyped string-`to` wrapper over TanStack Link; a
  // plain anchor keeps the rendered `to` inspectable as href.
  Link: ({ to, children, ...rest }: { to: string; children?: ReactNode }) => (
    <a href={to} {...rest}>{children}</a>
  ),
}));

vi.mock('../hooks/useGuestRelationsQueries', () => ({
  useGuestRelationsOverview: () => mocks.overviewQuery,
}));

import GuestRelationsOverviewPage from './GuestRelationsOverviewPage';
import { expectNoAxeViolations } from '../../../test/axe';

function buildOverview(overrides: Partial<GuestRelationsOverview> = {}): GuestRelationsOverview {
  return {
    arrivals: {
      count: 3,
      items: [
        { booking_id: 11, guest_id: 7, guest_name: 'Aisha Rahman', status: 'confirmed', room_label: '204', is_vip: true },
        { booking_id: 12, guest_id: 8, guest_name: 'Marco Silva', status: 'pending_confirmation', room_label: null, is_vip: false },
      ],
    },
    in_house: {
      count: 4,
      items: [
        { booking_id: 21, guest_id: 9, guest_name: 'Chen Wei', status: 'checked_in', room_label: '310', is_vip: false },
      ],
    },
    departures: {
      count: 2,
      items: [
        { booking_id: 31, guest_id: 10, guest_name: 'Fatima Noor', status: 'checked_in', room_label: '118', is_vip: false },
      ],
    },
    vip_arrivals: {
      count: 1,
      items: [
        { booking_id: 11, guest_id: 7, guest_name: 'Aisha Rahman', status: 'confirmed', room_label: '204', is_vip: true },
      ],
    },
    support: {
      open: 5,
      waiting_for_staff: 2,
      items: [
        { conversation_id: 51, conversation_number: 'CNV-0051', guest_id: 7, guest_name: 'Aisha Rahman', status: 'waiting_for_staff', priority: 'high', subject: 'Airport pickup request' },
      ],
    },
    reviews: {
      count: 6,
      items: [
        { review_id: 61, guest_id: 9, guest_name: 'Chen Wei', rating: 4.5, created_at: '2026-09-12T10:00:00Z' },
      ],
    },
    follow_ups: {
      count: 7,
      items: [
        { note_id: 71, guest_id: 7, guest_name: 'Aisha Rahman', subject: 'Confirm spa booking', interaction_type: 'follow_up', follow_up_at: '2026-09-14T09:00:00Z', assigned_to: null, assigned_to_name: null, created_by_name: 'Nina', snippet: 'Call about the spa slot' },
      ],
    },
    ...overrides,
  };
}

describe('GuestRelationsOverviewPage', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        onchange: null,
        dispatchEvent: vi.fn(),
      }),
    });

    mocks.hasPermission.mockReset().mockReturnValue(true);
    mocks.navigate.mockReset();
    mocks.overviewQuery.data = buildOverview();
    mocks.overviewQuery.error = null;
    mocks.overviewQuery.isPending = false;
  });

  afterEach(() => cleanup());

  it('renders the header and stat strip counts from the aggregate', () => {
    render(<GuestRelationsOverviewPage />);
    expect(screen.getByText('Guest Relations', { selector: 'h1' })).toBeTruthy();

    // Distinct fixture counts make every stat value assertion meaningful.
    const stats: Array<[string, number]> = [
      ['Arrivals', 3],
      ['In house', 4],
      ['Departures', 2],
      ['VIP arrivals', 1],
      ['Open support', 5],
      ['Awaiting review', 6],
      ['Follow-ups due', 7],
    ];
    for (const [label, value] of stats) {
      expect(screen.getByText(label)).toBeTruthy();
      expect(screen.getAllByText(String(value)).length).toBeGreaterThan(0);
    }
  });

  it('links preview rows to the guest 360 page', () => {
    render(<GuestRelationsOverviewPage />);
    // Marco Silva appears only in the arrivals preview, so the link name is unique.
    const row = screen.getByRole('link', { name: /Marco Silva/ });
    expect(row.getAttribute('href')).toBe('/guest-relations/guests/8');

    const supportRow = screen.getByRole('link', { name: /Airport pickup request/ });
    expect(supportRow.getAttribute('href')).toBe('/guest-relations/guests/7');
  });

  it('renders View all links into the owning modules', () => {
    const { container } = render(<GuestRelationsOverviewPage />);
    const hrefs = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/bookings');
    expect(hrefs).toContain('/support');
    expect(hrefs).toContain('/guest-relations/follow-ups');
  });

  it('renders no support or reviews UI when the payload omits those sections', () => {
    const { support: _support, reviews: _reviews, ...rest } = buildOverview();
    mocks.overviewQuery.data = rest as GuestRelationsOverview;
    render(<GuestRelationsOverviewPage />);
    // Neither the section cards nor the stat entries may appear — the backend
    // omits these keys when the caller lacks support:read / reviews:read.
    expect(screen.queryByText('Open support requests')).toBeNull();
    expect(screen.queryByText('Reviews awaiting a response')).toBeNull();
    expect(screen.queryByText('Open support')).toBeNull();
    expect(screen.queryByText('Awaiting review')).toBeNull();
    expect(screen.queryByRole('link', { name: /Airport pickup request/ })).toBeNull();
  });

  it('shows friendly empty text for a section with no items', () => {
    mocks.overviewQuery.data = buildOverview({ arrivals: { count: 0, items: [] } });
    render(<GuestRelationsOverviewPage />);
    expect(screen.getByText(/no arrivals/i)).toBeTruthy();
  });

  it('denies access without guests:read', () => {
    mocks.hasPermission.mockReturnValue(false);
    render(<GuestRelationsOverviewPage />);
    expect(screen.getByText(/do not have permission/)).toBeTruthy();
  });

  it('has no axe violations on the populated overview', async () => {
    const { container } = render(<GuestRelationsOverviewPage />);

    expect(screen.getByText('Guest Relations', { selector: 'h1' })).toBeTruthy();
    await expectNoAxeViolations(container);
  });
});

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetLocaleStoreForTests } from '../../../i18n/localeStore';
import type { HelpArticle } from '../types';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  searchParams: new URLSearchParams(),
  articles: [] as HelpArticle[],
}));

vi.mock('../../../router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children?: React.ReactNode }) => (
    <a href={to} {...rest}>{children}</a>
  ),
  useNavigate: () => mocks.navigate,
  useSearchParams: () => [mocks.searchParams, vi.fn()],
}));

vi.mock('../hooks/useHelpArticles', () => ({
  useHelpArticles: () => mocks.articles,
}));

import HelpCenterPage from './HelpCenterPage';
import { expectNoCriticalAxeViolations } from '../../../test/axe';

const makeArticle = (over: Partial<HelpArticle> & { slug: string }): HelpArticle => ({
  title: over.slug,
  summary: `${over.slug} summary`,
  category: 'bookings',
  keywords: [],
  blocks: [{ type: 'paragraph', text: 'Body text' }],
  relatedSlugs: [],
  lastReviewed: '2026-09-01',
  ...over,
});

function createLocalStorageStub() {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(() => {
      store.clear();
    }),
    _store: store,
  };
}

const FIXTURES: HelpArticle[] = [
  makeArticle({ slug: 'create-a-booking', title: 'Create a booking', featured: true }),
  makeArticle({ slug: 'find-a-reservation', title: 'Find a reservation', category: 'bookings' }),
  makeArticle({ slug: 'manage-guest-profiles', title: 'Manage guest profiles', category: 'guests' }),
  makeArticle({
    slug: 'refund-a-deposit',
    title: 'Refund a deposit',
    category: 'payments-ledgers',
    keywords: ['refund'],
    featured: true,
  }),
];

describe('HelpCenterPage hub', () => {
  beforeEach(() => {
    mocks.navigate.mockReset();
    mocks.searchParams = new URLSearchParams();
    mocks.articles = FIXTURES;
    resetLocaleStoreForTests();
    vi.stubGlobal('localStorage', createLocalStorageStub());
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('reports no critical axe violations', async () => {
    const { container } = render(<HelpCenterPage />);
    await expectNoCriticalAxeViolations(container);
  });

  it('renders the header, quick tasks and category cards with article counts', () => {
    render(<HelpCenterPage />);

    expect(screen.getByRole('heading', { name: 'How can we help?' })).toBeTruthy();
    expect(screen.getByPlaceholderText('Search help articles…')).toBeTruthy();
    expect(screen.getAllByText('Create a booking').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Bookings & front desk').length).toBeGreaterThan(0);
    expect(screen.getByText('2 articles')).toBeTruthy();
  });

  it('searches articles by keyword and navigates to the hit on Enter', () => {
    vi.useFakeTimers();
    render(<HelpCenterPage />);

    fireEvent.change(screen.getByPlaceholderText('Search help articles…'), {
      target: { value: 'refund' },
    });
    act(() => vi.advanceTimersByTime(250));

    expect(screen.getByRole('option', { name: /Refund a deposit/ })).toBeTruthy();

    fireEvent.keyDown(screen.getByPlaceholderText('Search help articles…'), { key: 'Enter' });
    expect(mocks.navigate).toHaveBeenCalledWith('/help/refund-a-deposit');
  });

  it('shows the empty state for a query with no matches', () => {
    vi.useFakeTimers();
    render(<HelpCenterPage />);

    fireEvent.change(screen.getByPlaceholderText('Search help articles…'), {
      target: { value: 'xyzzy' },
    });
    act(() => vi.advanceTimersByTime(250));

    expect(screen.getByText('No matching articles')).toBeTruthy();
  });

  it('renders a single-category listing when ?category= is set', () => {
    mocks.searchParams = new URLSearchParams('category=bookings');
    render(<HelpCenterPage />);

    expect(screen.getByRole('heading', { name: 'Bookings & front desk' })).toBeTruthy();
    expect(screen.getAllByText('Create a booking').length).toBeGreaterThan(0);
    expect(screen.getByText('Find a reservation')).toBeTruthy();
    expect(screen.queryByText('Manage guest profiles')).toBeNull();
  });
});

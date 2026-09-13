import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetLocaleStoreForTests } from '../../../i18n/localeStore';
import type { HelpArticle } from '../types';

const mocks = vi.hoisted(() => ({
  permissions: new Set<string>(),
  articles: [] as HelpArticle[],
}));

vi.mock('../../../router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children?: React.ReactNode }) => (
    <a href={to} {...rest}>{children}</a>
  ),
  useNavigate: () => vi.fn(),
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({
    hasPermission: (permission: string) => mocks.permissions.has(permission),
  }),
}));

vi.mock('../hooks/useHelpArticles', () => ({
  useHelpArticles: () => mocks.articles,
}));

import HelpArticlePage from './HelpArticlePage';
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

const ARTICLE = makeArticle({
  slug: 'create-a-booking',
  title: 'Create a booking',
  summary: 'How to add a reservation for a walk-in or phone guest.',
  keywords: ['reservation'],
  blocks: [
    { type: 'heading', text: 'Steps' },
    {
      type: 'steps',
      steps: [
        { title: 'Open Bookings', body: 'Go to the Bookings page.' },
        { title: 'Choose New booking', body: 'The booking dialog opens.' },
      ],
    },
    { type: 'callout', tone: 'warning', title: 'Heads up', body: 'Overlapping stays need a release first.' },
    { type: 'faq', items: [{ q: 'Can I book past dates?', a: 'No — dates must be today or later.' }] },
  ],
  relatedSlugs: ['find-a-reservation'],
  routePath: '/bookings',
  requiredPermissions: ['bookings:create'],
});

const RELATED = makeArticle({
  slug: 'find-a-reservation',
  title: 'Find a reservation',
  summary: 'Locate a booking by code or guest name.',
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

const matchMediaStub = (matches: boolean) => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  });
};

describe('HelpArticlePage', () => {
  beforeEach(() => {
    mocks.permissions = new Set(['bookings:create']);
    mocks.articles = [ARTICLE, RELATED];
    resetLocaleStoreForTests();
    vi.stubGlobal('localStorage', createLocalStorageStub());
    matchMediaStub(false);
  });
  afterEach(cleanup);

  it('reports no critical axe violations', async () => {
    const { container } = render(<HelpArticlePage slug="create-a-booking" />);
    await expectNoCriticalAxeViolations(container);
  });

  it('renders the article body: steps, callout and faq', () => {
    render(<HelpArticlePage slug="create-a-booking" />);

    expect(screen.getByRole('heading', { name: 'Create a booking' })).toBeTruthy();
    expect(screen.getByText('Open Bookings')).toBeTruthy();
    expect(screen.getByText('Overlapping stays need a release first.')).toBeTruthy();
    expect(screen.getByText('Can I book past dates?')).toBeTruthy();
  });

  it('shows permission chips and the module CTA when the user has access', () => {
    render(<HelpArticlePage slug="create-a-booking" />);

    expect(screen.getByText('bookings:create')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Open the page/ })).toBeTruthy();
  });

  it('hides the module CTA when the user lacks the required permission', () => {
    mocks.permissions = new Set();
    render(<HelpArticlePage slug="create-a-booking" />);

    expect(screen.getByText('bookings:create')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Open the page/ })).toBeNull();
  });

  it('renders related articles and the feedback prompt', () => {
    render(<HelpArticlePage slug="create-a-booking" />);

    expect(screen.getByText('Find a reservation')).toBeTruthy();
    expect(screen.getByText('Was this helpful?')).toBeTruthy();
  });

  it('shows the not-found empty state for an unknown slug', () => {
    render(<HelpArticlePage slug="does-not-exist" />);

    expect(screen.getByText('Article not found')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Browse all topics' })).toBeTruthy();
  });
});

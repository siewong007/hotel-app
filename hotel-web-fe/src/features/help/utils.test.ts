import { describe, expect, it } from 'vitest';
import {
  articleTocEntries,
  estimateReadingMinutes,
  getArticlesByCategory,
  getCategoryCounts,
  getRelatedArticles,
  searchArticles,
} from './utils';
import type { HelpArticle } from './types';

const makeArticle = (overrides: Partial<HelpArticle>): HelpArticle => ({
  slug: 'a',
  title: 'Untitled',
  summary: '',
  category: 'bookings',
  keywords: [],
  blocks: [],
  relatedSlugs: [],
  lastReviewed: '2026-09-13',
  ...overrides,
});

const library: HelpArticle[] = [
  makeArticle({
    slug: 'refund-deposit',
    title: 'Refund a deposit',
    summary: 'Return a guest deposit from the booking.',
    category: 'payments-ledgers',
    keywords: ['money back', 'deposit refund'],
    blocks: [{ type: 'paragraph', text: 'Use the refund action on a paid booking.' }],
  }),
  makeArticle({
    slug: 'create-booking',
    title: 'Create a booking',
    summary: 'Make a reservation from the Bookings page.',
    category: 'bookings',
    keywords: ['reservation'],
    blocks: [{ type: 'steps', steps: [{ title: 'Open Bookings', body: 'Choose dates.' }] }],
  }),
  makeArticle({
    slug: 'add-user',
    title: 'Add a staff member',
    summary: 'Create a login for a colleague.',
    category: 'staff-access',
    keywords: ['employee account'],
    blocks: [{ type: 'paragraph', text: 'Assign a role after creating the user.' }],
  }),
  makeArticle({
    slug: 'night-audit',
    title: 'Run the night audit',
    summary: 'Close the business day.',
    category: 'reports-night-audit',
    blocks: [{ type: 'paragraph', text: 'Locks bookings from further editing.' }],
  }),
];

describe('searchArticles', () => {
  it('returns nothing for empty or whitespace queries', () => {
    expect(searchArticles(library, '')).toEqual([]);
    expect(searchArticles(library, '   ')).toEqual([]);
  });

  it('ranks title matches above body-only matches', () => {
    const hits = searchArticles(library, 'booking');
    expect(hits[0].article.slug).toBe('create-booking');
  });

  it('matches keyword-only terms', () => {
    const hits = searchArticles(library, 'employee');
    expect(hits.map((h) => h.article.slug)).toEqual(['add-user']);
  });

  it('expands hotel synonyms', () => {
    expect(searchArticles(library, 'reservation')[0].article.slug).toBe('create-booking');
    expect(searchArticles(library, 'money back')[0].article.slug).toBe('refund-deposit');
  });

  it('tolerates plural query terms against singular body text', () => {
    const hits = searchArticles(library, 'deposits');
    expect(hits.some((h) => h.article.slug === 'refund-deposit')).toBe(true);
  });

  it('requires every query term to match (AND semantics)', () => {
    expect(searchArticles(library, 'booking zebra')).toEqual([]);
  });

  it('normalizes hyphens and case', () => {
    expect(searchArticles(library, 'NIGHT AUDIT')[0].article.slug).toBe('night-audit');
    expect(searchArticles(library, 'money-back')[0].article.slug).toBe('refund-deposit');
  });

  it('respects the result limit', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      makeArticle({ slug: `x${i}`, title: `Booking topic ${i}`, category: 'bookings' }),
    );
    expect(searchArticles(many, 'booking', 5)).toHaveLength(5);
  });
});

describe('article helpers', () => {
  it('filters by category', () => {
    expect(getArticlesByCategory(library, 'bookings').map((a) => a.slug)).toEqual(['create-booking']);
  });

  it('counts articles per category', () => {
    const counts = getCategoryCounts(library);
    expect(counts.bookings).toBe(1);
    expect(counts['payments-ledgers']).toBe(1);
  });

  it('prefers explicit related slugs then fills from the same category', () => {
    const article = makeArticle({
      slug: 'main',
      category: 'bookings',
      relatedSlugs: ['night-audit', 'missing'],
    });
    const related = getRelatedArticles(article, library, 2);
    expect(related[0].slug).toBe('night-audit');
    expect(related[1].slug).toBe('create-booking');
  });

  it('never returns the article itself as related', () => {
    const article = library[1];
    expect(getRelatedArticles(article, library).every((a) => a.slug !== article.slug)).toBe(true);
  });

  it('estimates reading time with a one-minute floor', () => {
    expect(estimateReadingMinutes(library[0])).toBe(1);
  });

  it('builds TOC entries from heading blocks only', () => {
    const article = makeArticle({
      slug: 'toc',
      blocks: [
        { type: 'paragraph', text: 'intro' },
        { type: 'heading', text: 'Steps' },
        { type: 'paragraph', text: 'body' },
        { type: 'heading', text: 'Notes' },
      ],
    });
    expect(articleTocEntries(article)).toEqual([
      { id: 'section-1', text: 'Steps' },
      { id: 'section-3', text: 'Notes' },
    ]);
  });
});

import {
  HELP_RELATED_COUNT,
  HELP_SEARCH_MAX_RESULTS,
  HELP_WORDS_PER_MINUTE,
} from './constants';
import type { HelpArticle, HelpBlock, HelpCategoryId, HelpSearchHit } from './types';

const normalize = (value: string): string =>
  value.toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Light plural tolerance: "bookings" should match body text "booking". */
const singularize = (term: string): string =>
  term.length > 3 && term.endsWith('s') ? term.slice(0, -1) : term;

/**
 * Query-term expansions for hotel vocabulary. Keys and values are normalized
 * (lowercase, spaces). Direction matters: a query for "reservation" should
 * reach booking articles even when the word never appears in them.
 */
const HELP_SYNONYMS: Record<string, string[]> = {
  reservation: ['booking'],
  folio: ['ledger'],
  invoice: ['ledger', 'company ledger'],
  receipt: ['payment', 'approval'],
  refund: ['deposit', 'revert'],
  cancel: ['void'],
  void: ['cancel'],
  noshow: ['release', 'hold'],
  availability: ['inventory', 'online inventory'],
  employee: ['staff', 'user'],
  staff: ['user', 'role', 'add user'],
  cleaner: ['housekeeping'],
  cleaning: ['housekeeping'],
  maid: ['housekeeping'],
  promo: ['promotion', 'voucher'],
  discount: ['promotion', 'voucher'],
  voucher: ['promotion'],
  password: ['security', 'sign in'],
  '2fa': ['two factor', 'security'],
  passkey: ['security', 'sign in'],
  permission: ['role', 'access', 'rbac'],
  role: ['permission', 'access'],
  tax: ['settings'],
  import: ['data transfer'],
  export: ['data transfer'],
  backup: ['data transfer'],
  restore: ['data transfer'],
  metric: ['report', 'occupancy', 'adr', 'revpar'],
  adr: ['occupancy', 'report'],
  revpar: ['occupancy', 'report'],
  checkout: ['check out', 'departure'],
  checkin: ['check in', 'arrival'],
  arrival: ['check in'],
  departure: ['check out'],
  rate: ['pricing', 'inventory'],
  price: ['pricing'],
  payment: ['deposit', 'refund', 'approval'],
  notification: ['communications', 'email'],
  support: ['guest support', 'escalation', 'manager'],
  blocked: ['maintenance', 'room status'],
  maintenance: ['housekeeping', 'ticket', 'room status'],
  overbook: ['inventory', 'availability'],
  shift: ['sign out', 'workstation'],
  ekyc: ['identity', 'verification'],
};

/** All text a block contributes to the searchable body. */
const blockText = (block: HelpBlock): string => {
  switch (block.type) {
    case 'heading':
    case 'paragraph':
      return block.text;
    case 'list':
    case 'checklist':
      return block.items.join(' ');
    case 'steps':
      return block.steps.map((s) => `${s.title} ${s.body}`).join(' ');
    case 'callout':
      return `${block.title ?? ''} ${block.body}`;
    case 'faq':
      return block.items.map((f) => `${f.q} ${f.a}`).join(' ');
  }
};

export const articleBodyText = (article: HelpArticle): string =>
  article.blocks.map(blockText).join(' ');

/** Every word position variants of a query term should match against. */
const expandTerm = (term: string): string[] => {
  const squashed = term.replace(/\s+/g, '');
  const base = [term, singularize(term), squashed, singularize(squashed)];
  return [...new Set([...base, ...(HELP_SYNONYMS[term] ?? []), ...(HELP_SYNONYMS[squashed] ?? [])])];
};

/** Best field-level score for one (already normalized) term variant. */
const termScore = (article: HelpArticle, body: string, variant: string): number => {
  const title = normalize(article.title);
  if (title.startsWith(variant)) return 14;
  if (title.includes(variant)) return 10;
  for (const keyword of article.keywords) {
    const kw = normalize(keyword);
    if (kw === variant) return 9;
    if (kw.startsWith(variant)) return 7;
    if (kw.includes(variant)) return 5;
  }
  if (normalize(article.summary).includes(variant)) return 4;
  if (normalize(article.category).includes(variant)) return 3;
  if (body.includes(variant)) return 1;
  return 0;
};

/**
 * Weighted AND-semantics search: every query term must match somewhere
 * (directly, singularized, squashed, or via synonyms). Results sort by score
 * then title. Pure — safe to unit test and reuse in the ⌘K palette.
 */
export function searchArticles(
  articles: HelpArticle[],
  query: string,
  limit = HELP_SEARCH_MAX_RESULTS,
): HelpSearchHit[] {
  const q = normalize(query);
  if (!q) return [];
  const terms = q.split(' ');

  const hits: HelpSearchHit[] = [];
  for (const article of articles) {
    const body = normalize(articleBodyText(article));
    let score = 0;
    let matched = true;
    for (const term of terms) {
      const best = Math.max(0, ...expandTerm(term).map((v) => termScore(article, body, v)));
      if (best === 0) {
        matched = false;
        break;
      }
      score += best;
    }
    if (!matched) continue;
    if (normalize(article.title).includes(q)) score += 6; // whole-phrase bonus
    hits.push({ article, score });
  }

  hits.sort((a, b) => b.score - a.score || a.article.title.localeCompare(b.article.title));
  return hits.slice(0, limit);
}

export const getArticleBySlug = (articles: HelpArticle[], slug: string): HelpArticle | undefined =>
  articles.find((a) => a.slug === slug);

export const getArticlesByCategory = (
  articles: HelpArticle[],
  category: HelpCategoryId,
): HelpArticle[] => articles.filter((a) => a.category === category);

export const getCategoryCounts = (articles: HelpArticle[]): Record<HelpCategoryId, number> => {
  const counts = {} as Record<HelpCategoryId, number>;
  for (const article of articles) {
    counts[article.category] = (counts[article.category] ?? 0) + 1;
  }
  return counts;
};

/** Explicit related slugs first (author order), then same-category fill. */
export const getRelatedArticles = (
  article: HelpArticle,
  articles: HelpArticle[],
  count = HELP_RELATED_COUNT,
): HelpArticle[] => {
  const bySlug = new Map(articles.map((a) => [a.slug, a]));
  const related: HelpArticle[] = [];
  for (const slug of article.relatedSlugs) {
    const found = bySlug.get(slug);
    if (found && found.slug !== article.slug && !related.includes(found)) related.push(found);
  }
  for (const candidate of articles) {
    if (related.length >= count) break;
    if (candidate.category === article.category && candidate.slug !== article.slug && !related.includes(candidate)) {
      related.push(candidate);
    }
  }
  return related.slice(0, count);
};

export const getFeaturedArticles = (articles: HelpArticle[], count = 6): HelpArticle[] =>
  articles.filter((a) => a.featured).slice(0, count);

/** Rough minutes-to-read from all block text; never less than 1. */
export const estimateReadingMinutes = (article: HelpArticle): number =>
  Math.max(1, Math.ceil(articleBodyText(article).split(/\s+/).length / HELP_WORDS_PER_MINUTE));

/** Heading blocks drive the article TOC; anchors are positional ids. */
export const articleTocEntries = (article: HelpArticle): { id: string; text: string }[] =>
  article.blocks
    .map((block, index) => ({ block, index }))
    .filter((e) => e.block.type === 'heading')
    .map((e) => ({ id: `section-${e.index}`, text: (e.block as { text: string }).text }));

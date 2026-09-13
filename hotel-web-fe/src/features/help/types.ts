/**
 * Help Centre domain types.
 *
 * Articles are structured data — never markdown — so every block renders
 * through a dedicated MUI component and the same text feeds the search index.
 * A future DB-backed CMS can adopt this model wholesale.
 */

export type HelpCategoryId =
  | 'getting-started'
  | 'bookings'
  | 'guests'
  | 'rooms-inventory'
  | 'payments-ledgers'
  | 'rates-promotions'
  | 'reports-night-audit'
  | 'communications'
  | 'staff-access'
  | 'settings-data'
  | 'troubleshooting';

export type HelpCalloutTone = 'tip' | 'info' | 'warning' | 'important';

export interface HelpStep {
  /** Short imperative label, e.g. "Open Bookings". */
  title: string;
  body: string;
}

export interface HelpFaqItem {
  q: string;
  a: string;
}

export type HelpBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[]; ordered?: boolean }
  | { type: 'steps'; steps: HelpStep[] }
  | { type: 'callout'; tone: HelpCalloutTone; title?: string; body: string }
  | { type: 'checklist'; items: string[] }
  | { type: 'faq'; items: HelpFaqItem[] };

export interface HelpArticle {
  /** URL segment: /help/<slug>. Stable once published — it is the permalink. */
  slug: string;
  title: string;
  /** One-sentence answer shown in cards and under the article title. */
  summary: string;
  category: HelpCategoryId;
  /** Extra search terms and synonyms that do not appear in the body text. */
  keywords: string[];
  blocks: HelpBlock[];
  /** Explicit related links; same-category articles fill the remainder. */
  relatedSlugs: string[];
  /** Admin page this article is about — powers the "Open the page" CTA. */
  routePath?: string;
  /** Permissions that gate the workflow (informational chips, not a content gate). */
  requiredPermissions?: string[];
  /** ISO date (YYYY-MM-DD) the article was last checked against the app. */
  lastReviewed: string;
  /** Pin to the "Popular articles" section on the hub. */
  featured?: boolean;
}

export interface HelpSearchHit {
  article: HelpArticle;
  score: number;
}

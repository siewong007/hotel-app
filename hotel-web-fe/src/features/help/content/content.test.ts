import { beforeAll, describe, expect, it } from 'vitest';
import { ARTICLES_EN } from './articles.en';
import { ARTICLES_MS } from './articles.ms';
import { ARTICLES_ZH } from './articles.zh';
import { ARTICLES_ZH_TW } from './articles.zhTW';
import { HELP_CATEGORY_IDS } from '../constants';
import { getArticles, loadAllArticles } from './index';
import type { HelpArticle, HelpBlock } from '../types';

const blockSignature = (blocks: HelpBlock[]) => blocks.map((b) => b.type).join(',');

const ALL_SETS = [ARTICLES_EN, ARTICLES_MS, ARTICLES_ZH, ARTICLES_ZH_TW];

// Only English ships in the app shell; ms, zh and zh-TW are dynamic chunks
// (see ./index.ts). Tests asserting a specific locale's catalogue must load
// them first, or they read the English fallback.
beforeAll(async () => {
  await loadAllArticles();
});

describe('help article catalogue', () => {
  it('has unique slugs in every locale', () => {
    for (const articles of ALL_SETS) {
      const slugs = articles.map((a) => a.slug);
      expect(new Set(slugs).size).toBe(slugs.length);
    }
  });

  it('keeps the same slug set across locales', () => {
    const enSlugs = ARTICLES_EN.map((a) => a.slug).sort();
    for (const articles of [ARTICLES_MS, ARTICLES_ZH, ARTICLES_ZH_TW]) {
      expect(articles.map((a) => a.slug).sort()).toEqual(enSlugs);
    }
  });

  it('keeps block structure parity across locales', () => {
    const enBySlug = new Map(ARTICLES_EN.map((a) => [a.slug, a]));
    for (const article of [ARTICLES_MS, ARTICLES_ZH, ARTICLES_ZH_TW].flat()) {
      const enArticle = enBySlug.get(article.slug);
      expect(enArticle, `missing English article for ${article.slug}`).toBeDefined();
      expect(blockSignature(article.blocks), `block mismatch on ${article.slug}`).toBe(
        blockSignature(enArticle!.blocks),
      );
    }
  });

  it('keeps metadata parity across locales', () => {
    const enBySlug = new Map(ARTICLES_EN.map((a) => [a.slug, a]));
    for (const article of [ARTICLES_MS, ARTICLES_ZH, ARTICLES_ZH_TW].flat()) {
      const enArticle = enBySlug.get(article.slug)!;
      expect(article.category).toBe(enArticle.category);
      expect(article.routePath).toBe(enArticle.routePath);
      expect(article.requiredPermissions).toEqual(enArticle.requiredPermissions);
      expect(article.relatedSlugs).toEqual(enArticle.relatedSlugs);
      expect(Boolean(article.featured)).toBe(Boolean(enArticle.featured));
    }
  });

  it('uses only known category ids', () => {
    for (const articles of ALL_SETS) {
      for (const article of articles) {
        expect(HELP_CATEGORY_IDS, `unknown category on ${article.slug}`).toContain(article.category);
      }
    }
  });

  it('resolves every related slug within its locale', () => {
    for (const articles of ALL_SETS) {
      const slugs = new Set(articles.map((a) => a.slug));
      for (const article of articles) {
        for (const related of article.relatedSlugs) {
          expect(slugs, `${article.slug} relates to missing ${related}`).toContain(related);
          expect(related).not.toBe(article.slug);
        }
      }
    }
  });

  it('requires the essentials on every article', () => {
    const required = (a: HelpArticle) =>
      a.title.trim().length > 0 &&
      a.summary.trim().length > 0 &&
      a.blocks.length > 0 &&
      /^\d{4}-\d{2}-\d{2}$/.test(a.lastReviewed);
    for (const article of ALL_SETS.flat()) {
      expect(required(article), `incomplete article: ${article.slug}`).toBe(true);
    }
  });

  it('serves each locale its own catalogue', () => {
    expect(getArticles('en')).toBe(ARTICLES_EN);
    expect(getArticles('ms')).toBe(ARTICLES_MS);
    expect(getArticles('zh')).toBe(ARTICLES_ZH);
    expect(getArticles('zh-TW')).toBe(ARTICLES_ZH_TW);
  });

  // zh-TW ships a Traditional set of its own: Traditional readers get native
  // copy, not the Simplified articles repointed at them.
  it('ships a real Traditional Chinese set rather than the Simplified one', () => {
    expect(getArticles('zh-TW')).not.toBe(ARTICLES_ZH);
    expect(getArticles('zh-TW')).not.toBe(ARTICLES_EN);
  });
});

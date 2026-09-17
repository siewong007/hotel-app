import { beforeAll, describe, expect, it } from 'vitest';
import { ARTICLES_EN } from './articles.en';
import { ARTICLES_MS } from './articles.ms';
import { ARTICLES_ZH } from './articles.zh';
import { HELP_CATEGORY_IDS } from '../constants';
import { getArticles, loadAllArticles } from './index';
import type { HelpArticle, HelpBlock } from '../types';

const blockSignature = (blocks: HelpBlock[]) => blocks.map((b) => b.type).join(',');

// Only English ships in the app shell; ms and zh are dynamic chunks (see
// ./index.ts). Tests asserting a specific locale's catalogue must load them
// first, or they read the English fallback.
beforeAll(async () => {
  await loadAllArticles();
});

describe('help article catalogue', () => {
  it('has unique slugs in every locale', () => {
    for (const articles of [ARTICLES_EN, ARTICLES_MS, ARTICLES_ZH]) {
      const slugs = articles.map((a) => a.slug);
      expect(new Set(slugs).size).toBe(slugs.length);
    }
  });

  it('keeps the same slug set across locales', () => {
    expect(ARTICLES_MS.map((a) => a.slug).sort()).toEqual(
      ARTICLES_EN.map((a) => a.slug).sort(),
    );
  });

  it('keeps block structure parity across locales', () => {
    const enBySlug = new Map(ARTICLES_EN.map((a) => [a.slug, a]));
    for (const msArticle of [...ARTICLES_MS, ...ARTICLES_ZH]) {
      const enArticle = enBySlug.get(msArticle.slug);
      expect(enArticle, `missing English article for ${msArticle.slug}`).toBeDefined();
      expect(blockSignature(msArticle.blocks), `block mismatch on ${msArticle.slug}`).toBe(
        blockSignature(enArticle!.blocks),
      );
    }
  });

  it('keeps metadata parity across locales', () => {
    const enBySlug = new Map(ARTICLES_EN.map((a) => [a.slug, a]));
    for (const msArticle of [...ARTICLES_MS, ...ARTICLES_ZH]) {
      const enArticle = enBySlug.get(msArticle.slug)!;
      expect(msArticle.category).toBe(enArticle.category);
      expect(msArticle.routePath).toBe(enArticle.routePath);
      expect(msArticle.requiredPermissions).toEqual(enArticle.requiredPermissions);
      expect(msArticle.relatedSlugs).toEqual(enArticle.relatedSlugs);
      expect(Boolean(msArticle.featured)).toBe(Boolean(enArticle.featured));
    }
  });

  it('uses only known category ids', () => {
    for (const article of [...ARTICLES_EN, ...ARTICLES_MS]) {
      expect(HELP_CATEGORY_IDS, `unknown category on ${article.slug}`).toContain(article.category);
    }
  });

  it('resolves every related slug within its locale', () => {
    for (const articles of [ARTICLES_EN, ARTICLES_MS, ARTICLES_ZH]) {
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
    for (const article of [...ARTICLES_EN, ...ARTICLES_MS]) {
      expect(required(article), `incomplete article: ${article.slug}`).toBe(true);
    }
  });

  it('serves English and Malay catalogues by locale', () => {
    expect(getArticles('en')).toBe(ARTICLES_EN);
    expect(getArticles('ms')).toBe(ARTICLES_MS);
  });

  // zh-TW ships no articles of its own, so it must land on the Simplified
  // Chinese set rather than English — a Traditional reader can follow
  // Simplified, and cannot follow English. Guards the BCP-47 walk
  // (zh-TW -> zh -> en) against a silent regression to ARTICLES_EN.
  it('falls back from Traditional to Simplified Chinese, not to English', () => {
    expect(getArticles('zh')).toBe(ARTICLES_ZH);
    expect(getArticles('zh-TW')).toBe(ARTICLES_ZH);
    expect(getArticles('zh-TW')).not.toBe(ARTICLES_EN);
  });
});

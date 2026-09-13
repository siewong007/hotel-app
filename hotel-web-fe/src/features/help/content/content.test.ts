import { describe, expect, it } from 'vitest';
import { ARTICLES_EN } from './articles.en';
import { ARTICLES_MS } from './articles.ms';
import { HELP_CATEGORY_IDS } from '../constants';
import { getArticles } from './index';
import type { HelpArticle, HelpBlock } from '../types';

const blockSignature = (blocks: HelpBlock[]) => blocks.map((b) => b.type).join(',');

describe('help article catalogue', () => {
  it('has unique slugs in every locale', () => {
    for (const articles of [ARTICLES_EN, ARTICLES_MS]) {
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
    for (const msArticle of ARTICLES_MS) {
      const enArticle = enBySlug.get(msArticle.slug);
      expect(enArticle, `missing English article for ${msArticle.slug}`).toBeDefined();
      expect(blockSignature(msArticle.blocks), `block mismatch on ${msArticle.slug}`).toBe(
        blockSignature(enArticle!.blocks),
      );
    }
  });

  it('keeps metadata parity across locales', () => {
    const enBySlug = new Map(ARTICLES_EN.map((a) => [a.slug, a]));
    for (const msArticle of ARTICLES_MS) {
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
    for (const articles of [ARTICLES_EN, ARTICLES_MS]) {
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
});

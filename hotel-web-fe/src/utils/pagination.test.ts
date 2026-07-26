import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  getPaginationState,
  normalizePage,
  normalizePageSize,
  toPaginationSearchParams,
} from './pagination';

describe('normalizePage', () => {
  it('returns the default page for undefined/non-finite input', () => {
    expect(normalizePage(undefined)).toBe(DEFAULT_PAGE);
    expect(normalizePage(Number.NaN)).toBe(DEFAULT_PAGE);
    expect(normalizePage(Number.POSITIVE_INFINITY)).toBe(DEFAULT_PAGE);
  });

  it('floors fractional pages', () => {
    expect(normalizePage(3.9)).toBe(3);
  });

  it('never returns less than the default (first) page', () => {
    expect(normalizePage(0)).toBe(DEFAULT_PAGE);
    expect(normalizePage(-5)).toBe(DEFAULT_PAGE);
  });

  it('passes through a valid page number', () => {
    expect(normalizePage(7)).toBe(7);
  });
});

describe('normalizePageSize', () => {
  it('returns the default page size for undefined/non-finite input', () => {
    expect(normalizePageSize(undefined)).toBe(DEFAULT_PAGE_SIZE);
    expect(normalizePageSize(Number.NaN)).toBe(DEFAULT_PAGE_SIZE);
  });

  it('honors a custom fallback when the page size is missing', () => {
    expect(normalizePageSize(undefined, 25)).toBe(25);
  });

  it('falls back to the default when the custom fallback itself is invalid', () => {
    expect(normalizePageSize(undefined, Number.NaN)).toBe(DEFAULT_PAGE_SIZE);
    expect(normalizePageSize(undefined, 0)).toBe(DEFAULT_PAGE_SIZE);
  });

  it('floors fractional page sizes', () => {
    expect(normalizePageSize(10.5)).toBe(10);
  });

  it('never returns less than 1', () => {
    expect(normalizePageSize(0)).toBe(1);
    expect(normalizePageSize(-20)).toBe(1);
  });
});

describe('toPaginationSearchParams', () => {
  it('normalizes both page and page_size for the wire format', () => {
    expect(toPaginationSearchParams({ page: 2.9, pageSize: 10.9 })).toEqual({
      page: 2,
      page_size: 10,
    });
  });

  it('applies defaults when neither value is provided', () => {
    expect(toPaginationSearchParams({})).toEqual({
      page: DEFAULT_PAGE,
      page_size: DEFAULT_PAGE_SIZE,
    });
  });
});

describe('getPaginationState', () => {
  it('computes start/end item ranges for a middle page', () => {
    const state = getPaginationState({ page: 2, pageSize: 10, totalItems: 35 });

    expect(state).toEqual({
      currentPage: 2,
      pageSize: 10,
      totalItems: 35,
      totalPages: 4,
      startItem: 11,
      endItem: 20,
      hasItems: true,
      hasMultiplePages: true,
    });
  });

  it('clamps the current page to the last page when requested beyond the total', () => {
    const state = getPaginationState({ page: 99, pageSize: 10, totalItems: 35 });
    expect(state.currentPage).toBe(4);
    expect(state.endItem).toBe(35);
  });

  it('reports no items and zeroed ranges when the collection is empty', () => {
    const state = getPaginationState({ page: 1, pageSize: 10, totalItems: 0 });

    expect(state.hasItems).toBe(false);
    expect(state.startItem).toBe(0);
    expect(state.endItem).toBe(0);
    expect(state.totalPages).toBe(1);
    expect(state.hasMultiplePages).toBe(false);
  });

  it('reports a single page as not having multiple pages even when full', () => {
    const state = getPaginationState({ page: 1, pageSize: 10, totalItems: 10 });
    expect(state.totalPages).toBe(1);
    expect(state.hasMultiplePages).toBe(false);
  });

  it('treats a missing/negative totalItems as zero', () => {
    const state = getPaginationState({ page: 1, pageSize: 10, totalItems: undefined });
    expect(state.totalItems).toBe(0);
    expect(state.hasItems).toBe(false);
  });

  it('computes the last (partial) page correctly', () => {
    const state = getPaginationState({ page: 4, pageSize: 10, totalItems: 35 });
    expect(state.startItem).toBe(31);
    expect(state.endItem).toBe(35);
  });
});

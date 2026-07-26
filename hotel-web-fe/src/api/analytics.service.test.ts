import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the configured ky instance so no real HTTP happens.
const get = vi.fn();
vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return {
    ...actual,
    api: { get: (...args: any[]) => get(...args) },
  };
});

import { AnalyticsService } from './analytics.service';

function mockJsonResponse(payload: unknown) {
  return { json: () => Promise.resolve(payload) };
}

describe('AnalyticsService', () => {
  beforeEach(() => {
    get.mockReset();
  });

  describe('getOccupancyReport', () => {
    it('calls GET analytics/occupancy and returns the report', async () => {
      const report = { occupancy_rate: 0.75 };
      get.mockReturnValue(mockJsonResponse(report));

      const result = await AnalyticsService.getOccupancyReport();

      expect(get).toHaveBeenCalledWith('analytics/occupancy');
      expect(result).toEqual(report);
    });
  });

  describe('getBookingAnalytics', () => {
    it('calls GET analytics/bookings and returns the report', async () => {
      const report = { total_bookings: 42 };
      get.mockReturnValue(mockJsonResponse(report));

      const result = await AnalyticsService.getBookingAnalytics();

      expect(get).toHaveBeenCalledWith('analytics/bookings');
      expect(result).toEqual(report);
    });
  });

  describe('getBenchmarkReport', () => {
    it('calls GET analytics/benchmark and returns the report', async () => {
      const report = { benchmark_score: 88 };
      get.mockReturnValue(mockJsonResponse(report));

      const result = await AnalyticsService.getBenchmarkReport();

      expect(get).toHaveBeenCalledWith('analytics/benchmark');
      expect(result).toEqual(report);
    });
  });

  describe('getPersonalizedReport', () => {
    it('calls GET analytics/personalized with an empty searchParams object when no period is given', async () => {
      get.mockReturnValue(mockJsonResponse({}));

      await AnalyticsService.getPersonalizedReport();

      expect(get).toHaveBeenCalledWith('analytics/personalized', { searchParams: {} });
    });

    it('forwards period as a search param when provided', async () => {
      get.mockReturnValue(mockJsonResponse({ period: '2026-07' }));

      const result = await AnalyticsService.getPersonalizedReport('2026-07');

      expect(get).toHaveBeenCalledWith('analytics/personalized', { searchParams: { period: '2026-07' } });
      expect(result).toEqual({ period: '2026-07' });
    });
  });
});

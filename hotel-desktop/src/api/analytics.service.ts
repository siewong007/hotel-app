import { api } from './client';
import { withRetry } from '../utils/retry';

export class AnalyticsService {
  static async getOccupancyReport(): Promise<any> {
    return await withRetry(
      () => api.get('analytics/occupancy').json(),
      { maxAttempts: 3, initialDelay: 1000 }
    );
  }

  static async getBookingAnalytics(): Promise<any> {
    return await withRetry(
      () => api.get('analytics/bookings').json(),
      { maxAttempts: 3, initialDelay: 1000 }
    );
  }

  static async getBenchmarkReport(): Promise<any> {
    return await withRetry(
      () => api.get('analytics/benchmark').json(),
      { maxAttempts: 3, initialDelay: 1000 }
    );
  }

  static async getPersonalizedReport(period?: string): Promise<any> {
    const searchParams = period ? { period } : {};
    return await withRetry(
      () => api.get('analytics/personalized', { searchParams }).json(),
      { maxAttempts: 3, initialDelay: 1000 }
    );
  }
}

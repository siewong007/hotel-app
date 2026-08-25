/**
 * Efficient localStorage wrapper with batching and caching
 */

// NOTE: 'accessToken'/'refreshToken' are intentionally NOT storage keys.
// The access token lives only in memory (src/auth/tokenStore.ts) and the refresh
// token lives in an HttpOnly cookie, so neither is ever written to Web Storage.
type StorageKey =
  | 'user'
  | 'permissions'
  | 'roles'
  | 'routePolicies'
  | 'themeMode'
  | 'cmdRecents'
  | 'notificationHistory'
  | 'ekycAdminFilters'
  | 'dataTransferHistory';

interface StorageCache {
  [key: string]: unknown;
  _lastUpdate: number;
}

class StorageManager {
  private cache: StorageCache = { _lastUpdate: Date.now() };
  private cacheTimeout = 5000; // 5 seconds cache validity

  /**
   * Get item from cache or localStorage
   */
  getItem<T = string>(key: StorageKey): T | null {
    const now = Date.now();

    // Check cache first
    if (
      this.cache[key] !== undefined &&
      now - this.cache._lastUpdate < this.cacheTimeout
    ) {
      return this.cache[key] as T;
    }

    // Fetch from localStorage
    try {
      const item = localStorage.getItem(key);
      if (item === null) {
        return null;
      }

      // Try to parse JSON, fallback to string
      try {
        const parsed = JSON.parse(item);
        this.cache[key] = parsed;
        return parsed;
      } catch {
        this.cache[key] = item;
        return item as T;
      }
    } catch (error) {
      console.error(`Error reading from localStorage: ${key}`, error);
      return null;
    }
  }

  /**
   * Set item in localStorage and update cache
   */
  setItem(key: StorageKey, value: unknown): void {
    try {
      const serialized = typeof value === 'string' ? value : JSON.stringify(value);
      localStorage.setItem(key, serialized);
      this.cache[key] = value;
      this.cache._lastUpdate = Date.now();
    } catch (error) {
      console.error(`Error writing to localStorage: ${key}`, error);
    }
  }

  /**
   * Remove item from localStorage and cache
   */
  removeItem(key: StorageKey): void {
    try {
      localStorage.removeItem(key);
      delete this.cache[key];
      this.cache._lastUpdate = Date.now();
    } catch (error) {
      console.error(`Error removing from localStorage: ${key}`, error);
    }
  }

  /**
   * Clear all items
   */
  clear(): void {
    try {
      localStorage.clear();
      this.cache = { _lastUpdate: Date.now() };
    } catch (error) {
      console.error('Error clearing localStorage', error);
    }
  }

  /**
   * Batch set multiple items efficiently
   */
  setItems(items: Partial<Record<StorageKey, any>>): void {
    Object.entries(items).forEach(([key, value]) => {
      this.setItem(key as StorageKey, value);
    });
  }

  /**
   * Batch get multiple items efficiently
   */
  getItems<T = any>(keys: StorageKey[]): Record<string, T | null> {
    const result: Record<string, T | null> = {};
    keys.forEach(key => {
      result[key] = this.getItem<T>(key);
    });
    return result;
  }

  /**
   * Invalidate cache to force fresh reads
   */
  invalidateCache(): void {
    this.cache = { _lastUpdate: 0 };
  }
}

// Export singleton instance
export const storage = new StorageManager();

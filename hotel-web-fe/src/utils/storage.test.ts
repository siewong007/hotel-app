import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { storage } from './storage';

function createLocalStorageStub() {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(() => {
      store.clear();
    }),
  };
}

describe('storage (StorageManager)', () => {
  let localStorageStub: ReturnType<typeof createLocalStorageStub>;

  beforeEach(() => {
    vi.useRealTimers();
    localStorageStub = createLocalStorageStub();
    vi.stubGlobal('localStorage', localStorageStub);
    storage.invalidateCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe('getItem/setItem round trips', () => {
    it('returns null for a key that was never set', () => {
      expect(storage.getItem('user')).toBeNull();
    });

    it('round-trips an object through JSON', () => {
      const value = { id: 1, username: 'jdoe' };
      storage.setItem('user', value);

      expect(localStorage.getItem('user')).toBe(JSON.stringify(value));
      expect(storage.getItem('user')).toEqual(value);
    });

    it('round-trips an array through JSON', () => {
      storage.setItem('permissions', ['bookings:read', 'rooms:manage']);
      expect(storage.getItem('permissions')).toEqual(['bookings:read', 'rooms:manage']);
    });

    it('stores a plain string value verbatim rather than JSON-quoting it', () => {
      storage.setItem('themeMode', 'dark');
      // setItem's `typeof value === 'string' ? value : JSON.stringify(value)`
      // branch stores the raw string, not `"dark"`.
      expect(localStorage.getItem('themeMode')).toBe('dark');
    });

    it('falls back to the raw string when the stored value is not valid JSON', () => {
      // Simulates a plain string written by setItem (see above). The cache is
      // invalidated so getItem must re-read localStorage: its inner JSON.parse
      // throws on `dark` and falls back to the raw string. (Without the
      // invalidation, getItem answers from the warm cache and never reaches
      // the parse — adversarial-review finding, 2026-07-26.)
      storage.setItem('themeMode', 'dark');
      storage.invalidateCache();
      expect(storage.getItem('themeMode')).toBe('dark');
    });

    it('falls back to the raw string for genuinely corrupt JSON already in localStorage', () => {
      localStorage.setItem('cmdRecents', '{not valid json');
      expect(storage.getItem('cmdRecents')).toBe('{not valid json');
    });
  });

  describe('error handling', () => {
    it('getItem returns null and logs when localStorage.getItem throws', () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      localStorageStub.getItem.mockImplementation(() => {
        throw new Error('storage unavailable');
      });

      expect(storage.getItem('user')).toBeNull();
      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });

    it('setItem swallows errors from localStorage.setItem and logs them', () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      localStorageStub.setItem.mockImplementation(() => {
        throw new Error('quota exceeded');
      });

      expect(() => storage.setItem('user', { id: 1 })).not.toThrow();
      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });

    it('removeItem swallows errors from localStorage.removeItem and logs them', () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      localStorageStub.removeItem.mockImplementation(() => {
        throw new Error('denied');
      });

      expect(() => storage.removeItem('user')).not.toThrow();
      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });

    it('clear swallows errors from localStorage.clear and logs them', () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      localStorageStub.clear.mockImplementation(() => {
        throw new Error('denied');
      });

      expect(() => storage.clear()).not.toThrow();
      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });
  });

  describe('removeItem / clear', () => {
    it('removes a key from both localStorage and the cache', () => {
      storage.setItem('user', { id: 1 });
      storage.removeItem('user');

      expect(localStorage.getItem('user')).toBeNull();
      expect(storage.getItem('user')).toBeNull();
    });

    it('clear empties every key and resets the cache', () => {
      storage.setItem('user', { id: 1 });
      storage.setItem('roles', ['admin']);

      storage.clear();

      expect(localStorageStub.clear).toHaveBeenCalledTimes(1);
      expect(storage.getItem('user')).toBeNull();
      expect(storage.getItem('roles')).toBeNull();
    });
  });

  describe('batch helpers', () => {
    it('setItems writes every provided key', () => {
      storage.setItems({ user: { id: 7 }, themeMode: 'dark' });

      expect(storage.getItem('user')).toEqual({ id: 7 });
      expect(localStorage.getItem('themeMode')).toBe('dark');
    });

    it('getItems reads every requested key into a single object', () => {
      storage.setItem('user', { id: 7 });
      storage.setItem('roles', ['admin']);

      expect(storage.getItems(['user', 'roles', 'permissions'])).toEqual({
        user: { id: 7 },
        roles: ['admin'],
        permissions: null,
      });
    });
  });

  describe('caching behavior', () => {
    it('serves a value written by setItem from cache without re-reading localStorage', () => {
      storage.setItem('user', { id: 1 });
      localStorageStub.getItem.mockClear();

      expect(storage.getItem('user')).toEqual({ id: 1 });
      expect(storage.getItem('user')).toEqual({ id: 1 });
      expect(localStorageStub.getItem).not.toHaveBeenCalled();
    });

    it('re-reads localStorage once the cache timeout elapses after a write', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

      storage.setItem('user', { id: 1 });
      localStorageStub.getItem.mockClear();

      // Still within the 5s cache validity window.
      expect(storage.getItem('user')).toEqual({ id: 1 });
      expect(localStorageStub.getItem).not.toHaveBeenCalled();

      vi.setSystemTime(new Date('2026-01-01T00:00:05.001Z'));

      storage.getItem('user');
      expect(localStorageStub.getItem).toHaveBeenCalledTimes(1);
    });

    it('invalidateCache forces the next read to hit localStorage again', () => {
      storage.setItem('user', { id: 1 });
      storage.invalidateCache();
      localStorageStub.getItem.mockClear();

      storage.getItem('user');

      expect(localStorageStub.getItem).toHaveBeenCalledTimes(1);
    });

    it('a value populated purely by a cache-miss read after invalidateCache is not treated as fresh on the next call', () => {
      // Documents current behavior: invalidateCache() sets _lastUpdate to 0,
      // and a plain getItem() cache-miss fetch does NOT bump _lastUpdate (only
      // setItem/removeItem/clear do) -- so every subsequent getItem() for that
      // key keeps re-reading localStorage until some write touches the cache.
      localStorage.setItem('themeMode', 'dark');
      localStorageStub.getItem.mockClear();

      storage.getItem('themeMode');
      storage.getItem('themeMode');

      expect(localStorageStub.getItem).toHaveBeenCalledTimes(2);
    });
  });
});

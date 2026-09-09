import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The store resolves its initial value at module load, so the precedence tests
 * re-import it through `vi.resetModules()` with the environment already
 * arranged. `../utils/storage` is reset alongside it, which clears its own
 * five-second read cache.
 */

function createLocalStorageStub(seed: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(seed));
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
    _store: store,
  };
}

const setBrowserLanguages = (languages: string[]) => {
  Object.defineProperty(navigator, 'languages', { value: languages, configurable: true });
  Object.defineProperty(navigator, 'language', { value: languages[0], configurable: true });
};

const loadStore = async () => {
  vi.resetModules();
  return import('./localeStore');
};

beforeEach(() => {
  vi.stubGlobal('localStorage', createLocalStorageStub());
  setBrowserLanguages(['en-US']);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('initial locale', () => {
  it('uses a persisted choice above everything else', async () => {
    vi.stubGlobal('localStorage', createLocalStorageStub({ locale: 'ms' }));
    setBrowserLanguages(['en-US']);
    const store = await loadStore();
    expect(store.getActiveLocale()).toBe('ms');
    expect(store.hasExplicitLocaleChoice()).toBe(true);
  });

  it('negotiates from the browser when nothing is persisted', async () => {
    setBrowserLanguages(['ms-MY', 'en-US']);
    const store = await loadStore();
    expect(store.getActiveLocale()).toBe('ms');
    expect(store.hasExplicitLocaleChoice()).toBe(false);
  });

  it('falls back to the default for an unsupported browser language', async () => {
    setBrowserLanguages(['de-DE', 'fr-FR']);
    const store = await loadStore();
    expect(store.getActiveLocale()).toBe('en');
  });

  it('ignores a persisted value that is no longer a supported locale', async () => {
    vi.stubGlobal('localStorage', createLocalStorageStub({ locale: 'fr' }));
    setBrowserLanguages(['ms-MY']);
    const store = await loadStore();
    expect(store.getActiveLocale()).toBe('ms');
    expect(store.hasExplicitLocaleChoice()).toBe(false);
  });
});

describe('setActiveLocale', () => {
  it('changes the locale, persists it, and notifies subscribers', async () => {
    const store = await loadStore();
    const listener = vi.fn();
    store.subscribeToLocale(listener);

    store.setActiveLocale('ms');

    expect(store.getActiveLocale()).toBe('ms');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(localStorage.setItem).toHaveBeenCalledWith('locale', 'ms');
  });

  it('persists a confirmation of the already-active locale without re-notifying', async () => {
    const store = await loadStore();
    const listener = vi.fn();
    store.subscribeToLocale(listener);

    store.setActiveLocale('en');

    expect(store.hasExplicitLocaleChoice()).toBe(true);
    expect(listener).not.toHaveBeenCalled();
    expect(localStorage.setItem).toHaveBeenCalledWith('locale', 'en');
  });

  it('stops notifying after unsubscribe', async () => {
    const store = await loadStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribeToLocale(listener);
    unsubscribe();

    store.setActiveLocale('ms');

    expect(listener).not.toHaveBeenCalled();
  });
});

describe('applyDefaultLocale', () => {
  it('applies an inferred default when the user has not chosen', async () => {
    const store = await loadStore();
    const listener = vi.fn();
    store.subscribeToLocale(listener);

    store.applyDefaultLocale('ms');

    expect(store.getActiveLocale()).toBe('ms');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not persist an inferred default as a choice', async () => {
    const store = await loadStore();
    store.applyDefaultLocale('ms');
    expect(store.hasExplicitLocaleChoice()).toBe(false);
    expect(localStorage.setItem).not.toHaveBeenCalled();
  });

  it('never overrides a choice the user made', async () => {
    const store = await loadStore();
    store.setActiveLocale('en');

    store.applyDefaultLocale('ms');

    expect(store.getActiveLocale()).toBe('en');
  });

  it('never overrides a choice restored from storage', async () => {
    vi.stubGlobal('localStorage', createLocalStorageStub({ locale: 'en' }));
    setBrowserLanguages(['en-US']);
    const store = await loadStore();

    store.applyDefaultLocale('ms');

    expect(store.getActiveLocale()).toBe('en');
  });

  it('ignores an empty default', async () => {
    const store = await loadStore();
    const listener = vi.fn();
    store.subscribeToLocale(listener);

    store.applyDefaultLocale(undefined);

    expect(listener).not.toHaveBeenCalled();
  });
});

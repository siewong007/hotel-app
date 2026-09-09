import { describe, expect, it, vi } from 'vitest';
import { interpolate, lookupKey, resolveRaw, translate } from './translator';
import type { LocaleResources } from './translator';

const resources: LocaleResources = {
  common: {
    hello: 'Hello',
    nested: { deep: { key: 'Found me' } },
    greeting: 'Hello {{name}}, you have {{count}} messages',
    items_zero: 'No items',
    items_one: '{{count}} item',
    items_other: '{{count}} items',
    onlyOther_other: '{{count}} things',
    notAString: { child: 'x' },
  },
  nav: { home: 'Home' },
};

const fallbackResources: LocaleResources = {
  common: { hello: 'Hello (en)', englishOnly: 'Only in English' },
  nav: { home: 'Home (en)' },
};

const options = (overrides = {}) => ({
  locale: 'en' as const,
  resources,
  fallbackResources,
  defaultNamespace: 'common',
  ...overrides,
});

describe('lookupKey', () => {
  it('walks dotted paths', () => {
    expect(lookupKey(resources.common, 'nested.deep.key')).toBe('Found me');
  });

  it('returns undefined for a missing path', () => {
    expect(lookupKey(resources.common, 'nested.missing.key')).toBeUndefined();
    expect(lookupKey(resources.common, 'nope')).toBeUndefined();
    expect(lookupKey(undefined, 'hello')).toBeUndefined();
  });

  it('refuses a path that lands on an object, never rendering [object Object]', () => {
    expect(lookupKey(resources.common, 'notAString')).toBeUndefined();
  });
});

describe('interpolate', () => {
  it('substitutes named placeholders', () => {
    expect(interpolate('Hi {{name}}', { name: 'Aisha' }, 'en')).toBe('Hi Aisha');
  });

  it('tolerates whitespace inside the braces', () => {
    expect(interpolate('Hi {{  name  }}', { name: 'Aisha' }, 'en')).toBe('Hi Aisha');
  });

  it('formats numbers for the locale', () => {
    expect(interpolate('{{n}}', { n: 1234567 }, 'en')).toBe('1,234,567');
  });

  it('leaves an unresolved placeholder visible rather than blanking it', () => {
    expect(interpolate('Hi {{name}}', {}, 'en')).toBe('Hi {{name}}');
    expect(interpolate('Hi {{name}}', { name: null }, 'en')).toBe('Hi {{name}}');
  });

  it('is a no-op when there is nothing to substitute', () => {
    expect(interpolate('plain', { name: 'x' }, 'en')).toBe('plain');
    expect(interpolate('Hi {{name}}', undefined, 'en')).toBe('Hi {{name}}');
  });
});

describe('resolveRaw', () => {
  it('resolves against the default namespace', () => {
    expect(resolveRaw('hello', options())).toBe('Hello');
  });

  it('honours an explicit ns:key prefix', () => {
    expect(resolveRaw('nav:home', options())).toBe('Home');
  });

  it('falls back to the fallback locale for a key the active locale lacks', () => {
    expect(resolveRaw('englishOnly', options())).toBe('Only in English');
  });

  it('reports a key that resolves nowhere', () => {
    const onMissing = vi.fn();
    expect(resolveRaw('absent', options({ onMissing }))).toBeUndefined();
    expect(onMissing).toHaveBeenCalledWith('common', 'absent', 'en');
  });

  describe('plural selection', () => {
    it('prefers an explicit _zero for exactly zero', () => {
      expect(resolveRaw('items', options(), { count: 0 })).toBe('No items');
    });

    it('selects _one for a singular count in English', () => {
      expect(resolveRaw('items', options(), { count: 1 })).toBe('{{count}} item');
    });

    it('selects _other for a plural count', () => {
      expect(resolveRaw('items', options(), { count: 5 })).toBe('{{count}} items');
    });

    it('falls through to _other when the specific category is absent', () => {
      // Malay has no singular form: `_one` is never authored, and a count of 1
      // must still resolve.
      expect(resolveRaw('onlyOther', options(), { count: 1 })).toBe('{{count}} things');
      expect(resolveRaw('onlyOther', options(), { count: 0 })).toBe('{{count}} things');
    });

    it('ignores a non-numeric count', () => {
      expect(resolveRaw('hello', options(), { count: undefined })).toBe('Hello');
    });
  });
});

describe('translate', () => {
  it('resolves and interpolates in one step', () => {
    expect(translate('greeting', options(), { name: 'Sam', count: 3 })).toBe(
      'Hello Sam, you have 3 messages'
    );
  });

  it('combines plural selection with interpolation', () => {
    expect(translate('items', options(), { count: 1 })).toBe('1 item');
    expect(translate('items', options(), { count: 4200 })).toBe('4,200 items');
  });

  it('renders the last path segment for a key that resolves nowhere', () => {
    // Readable and traceable, and it cannot blow out a layout the way a full
    // `ns:a.b.c` chain can.
    expect(translate('some.deeply.missingLabel', options())).toBe('missingLabel');
    expect(translate('nav:missingLabel', options())).toBe('missingLabel');
  });

  it('never throws for malformed input', () => {
    expect(() => translate('', options())).not.toThrow();
    expect(() => translate('a.b.c.d.e', options(), { count: NaN })).not.toThrow();
  });
});

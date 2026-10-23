import { afterEach, describe, expect, it, vi } from 'vitest';
import { filmViewport, resetFilmViewport } from './experience/viewport';

const size = (w: number, h: number, coarse: boolean) => {
  vi.stubGlobal('innerWidth', w);
  vi.stubGlobal('innerHeight', h);
  vi.stubGlobal('matchMedia', () => ({ matches: coarse }));
};

describe('filmViewport', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetFilmViewport();
  });

  it('keeps the tallest height on a phone while its toolbars come and go', () => {
    size(390, 844, true);
    expect(filmViewport()).toEqual({ w: 390, h: 844 });
    size(390, 760, true);
    expect(filmViewport()).toEqual({ w: 390, h: 844 });
  });

  it('starts over at a new width (rotation)', () => {
    size(390, 844, true);
    filmViewport();
    size(844, 390, true);
    expect(filmViewport()).toEqual({ w: 844, h: 390 });
  });

  it('follows the window exactly on desktop', () => {
    size(1280, 800, false);
    filmViewport();
    size(1280, 700, false);
    expect(filmViewport()).toEqual({ w: 1280, h: 700 });
  });
});

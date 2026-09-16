import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import BrandMark from './BrandMark';

describe('BrandMark', () => {
  afterEach(cleanup);

  it('renders an accessible image with a default name', () => {
    render(<BrandMark />);
    expect(screen.getByRole('img', { name: 'Salim Inn' })).toBeTruthy();
  });

  it('honours a custom accessible name', () => {
    render(<BrandMark title="Aster Hotel" />);
    expect(screen.getByRole('img', { name: 'Aster Hotel' })).toBeTruthy();
  });

  it('is hidden from assistive tech when decorative', () => {
    const { container } = render(<BrandMark decorative />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('applies the size to width and height', () => {
    const { container } = render(<BrandMark size={48} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('48');
    expect(svg?.getAttribute('height')).toBe('48');
  });

  it('tags the three strokes for the loader draw-on', () => {
    const { container } = render(<BrandMark />);
    for (const part of ['roofline', 's', 'baseline']) {
      const el = container.querySelector(`.hotel-mark__${part}`);
      expect(el, part).toBeTruthy();
      expect(el?.getAttribute('pathLength')).toBe('1');
    }
  });
});

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AnimatedRoute, animationConfigs } from './AnimatedRoute';

describe('AnimatedRoute', () => {
  afterEach(cleanup);

  it('leaves no transform on the route wrapper once rendered', () => {
    const { container } = render(
      <AnimatedRoute animationType="grow">
        <p>page</p>
      </AnimatedRoute>,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    const style = getComputedStyle(wrapper);
    // A resting transform would make the wrapper the containing block for
    // `position: fixed` page bars.
    expect(style.transform === '' || style.transform === 'none').toBe(true);
    expect(style.animation).toMatch(/smoothGrowIn/);
  });

  it('uses a backwards fill so keyframe transforms are dropped after the entrance', () => {
    for (const value of Object.values(animationConfigs)) {
      expect(value).toMatch(/\bbackwards$/);
      expect(value).not.toMatch(/\bforwards\b|\bboth\b/);
    }
  });
});

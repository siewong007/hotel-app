import { describe, expect, it } from 'vitest';
import { MAIN_CONTAINMENT, trapsFixedDescendants } from './mainContainment';

describe('main containment', () => {
  it('does not trap position: fixed descendants', () => {
    expect(trapsFixedDescendants(MAIN_CONTAINMENT)).toBe(false);
  });

  it('flags every style that turns an ancestor into a fixed containing block', () => {
    expect(trapsFixedDescendants({ contain: 'layout style' })).toBe(true);
    expect(trapsFixedDescendants({ contain: 'paint' })).toBe(true);
    expect(trapsFixedDescendants({ contain: 'strict' })).toBe(true);
    expect(trapsFixedDescendants({ transform: 'translateZ(0)' })).toBe(true);
    expect(trapsFixedDescendants({ filter: 'blur(1px)' })).toBe(true);
    expect(trapsFixedDescendants({ willChange: 'transform' })).toBe(true);
    expect(trapsFixedDescendants({ transform: 'none', contain: 'style' })).toBe(false);
  });
});

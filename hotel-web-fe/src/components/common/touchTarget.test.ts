import { describe, expect, it } from 'vitest';
import { COARSE_HIT_AREA_SX, TOUCH_TARGET_PX } from './touchTarget';

describe('COARSE_HIT_AREA_SX', () => {
  it('adds a centred 44px hit area only for coarse pointers', () => {
    expect(Object.keys(COARSE_HIT_AREA_SX)).toEqual(['@media (pointer: coarse)']);
    const after = COARSE_HIT_AREA_SX['@media (pointer: coarse)']['&::after'];
    expect(TOUCH_TARGET_PX).toBe(44);
    expect(after).toMatchObject({
      content: '""',
      position: 'absolute',
      width: 44,
      height: 44,
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
    });
  });
});

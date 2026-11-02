import { describe, expect, it } from 'vitest';
import { FrameKey } from './FrameKey';

describe('FrameKey (settled frames)', () => {
  it('never matches before a frame was drawn', () => {
    const key = new FrameKey();
    expect(key.begin().add(1).matches()).toBe(false);
  });

  it('matches the last drawn frame exactly, and nothing less', () => {
    const key = new FrameKey();
    key.begin().add(0.5).addAll([1, 2, 3]).commit();
    expect(key.begin().add(0.5).addAll([1, 2, 3]).matches()).toBe(true);
    // a ten-millionth is not nothing: SMAA and shadow texels can show it
    expect(key.begin().add(0.5).addAll([1, 2, 3 + 1e-7]).matches()).toBe(false);
    expect(key.begin().add(0.5 + 1e-15).addAll([1, 2, 3]).matches()).toBe(false);
  });

  it('compares with the last frame drawn, not the last frame seen', () => {
    const key = new FrameKey();
    key.begin().add(1).commit();
    expect(key.begin().add(2).matches()).toBe(false); // drawn, but not committed here
    expect(key.begin().add(1).matches()).toBe(true);
  });

  it('a key of another length never matches', () => {
    const key = new FrameKey();
    key.begin().add(1).add(2).commit();
    expect(key.begin().add(1).matches()).toBe(false);
    expect(key.begin().add(1).add(2).add(3).matches()).toBe(false);
  });

  it('NaN never matches (a value that cannot be compared redraws)', () => {
    const key = new FrameKey();
    key.begin().add(NaN).commit();
    expect(key.begin().add(NaN).matches()).toBe(false);
  });

  it('a key longer than its storage never matches', () => {
    const key = new FrameKey();
    const many = Array.from({ length: 200 }, (_, i) => i);
    key.begin().addAll(many).commit();
    expect(key.begin().addAll(many).matches()).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { getNotificationPriority } from './apiNotifications';

describe('notification priority', () => {
  it('treats informational and successful messages as info priority', () => {
    expect(getNotificationPriority('info')).toBe('info');
    expect(getNotificationPriority('success')).toBe('info');
  });

  it('treats validation warnings as warning priority', () => {
    expect(getNotificationPriority('warning')).toBe('warning');
  });

  it('treats errors as critical priority', () => {
    expect(getNotificationPriority('error')).toBe('critical');
  });
});

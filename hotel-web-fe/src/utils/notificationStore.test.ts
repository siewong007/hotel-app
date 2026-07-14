import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearAll,
  markAllRead,
  recordNotification,
  useNotifications,
} from './notificationStore';
import { storage } from './storage';

describe('notificationStore user scoping', () => {
  beforeEach(() => {
    vi.useRealTimers();
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        clear: () => values.clear(),
        getItem: (key: string) => values.get(key) ?? null,
        removeItem: (key: string) => values.delete(key),
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });
    storage.invalidateCache();
  });

  it('keeps notification histories separate for each user', () => {
    const firstUser = renderHook(() => useNotifications('separation-user-1'));
    const secondUser = renderHook(() => useNotifications('separation-user-2'));

    act(() => {
      recordNotification({ message: 'First user only', severity: 'info' }, 'separation-user-1');
      recordNotification({ message: 'Second user only', severity: 'warning' }, 'separation-user-2');
    });

    expect(firstUser.result.current.items.map((item) => item.message)).toEqual(['First user only']);
    expect(secondUser.result.current.items.map((item) => item.message)).toEqual(['Second user only']);
    expect(firstUser.result.current.unreadCount).toBe(1);
    expect(secondUser.result.current.unreadCount).toBe(1);
  });

  it('clears and marks notifications only for the selected user', () => {
    const firstUser = renderHook(() => useNotifications('actions-user-1'));
    const secondUser = renderHook(() => useNotifications('actions-user-2'));

    act(() => {
      recordNotification({ message: 'First user', severity: 'error' }, 'actions-user-1');
      recordNotification({ message: 'Second user', severity: 'success' }, 'actions-user-2');
      markAllRead('actions-user-1');
    });

    expect(firstUser.result.current.unreadCount).toBe(0);
    expect(secondUser.result.current.unreadCount).toBe(1);

    act(() => clearAll('actions-user-1'));

    expect(firstUser.result.current.items).toEqual([]);
    expect(secondUser.result.current.items).toHaveLength(1);
  });

  it('persists histories under separate user keys', () => {
    act(() => {
      recordNotification({ message: 'First user', severity: 'info' }, 'persistence-user-1');
      recordNotification({ message: 'Second user', severity: 'info' }, 'persistence-user-2');
    });

    const history = JSON.parse(localStorage.getItem('notificationHistory') ?? '{}');
    expect(history['user:persistence-user-1'][0].message).toBe('First user');
    expect(history['user:persistence-user-2'][0].message).toBe('Second user');
  });

  it('supports numeric guest user IDs', () => {
    const guest = renderHook(() => useNotifications(2121));

    act(() => {
      recordNotification({ message: 'Guest notification', severity: 'info' }, 2121);
    });

    expect(guest.result.current.items.map((item) => item.message)).toEqual([
      'Guest notification',
    ]);
    const history = JSON.parse(localStorage.getItem('notificationHistory') ?? '{}');
    expect(history['user:2121'][0].message).toBe('Guest notification');
  });

  it('removes notifications older than 90 days', () => {
    const now = new Date('2026-07-15T00:00:00Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);
    localStorage.setItem('notificationHistory', JSON.stringify({
      'user:retention-user': [
        {
          id: 1,
          message: 'Expired',
          severity: 'info',
          timestamp: now.getTime() - 91 * 24 * 60 * 60 * 1000,
          read: false,
        },
        {
          id: 2,
          message: 'Current',
          severity: 'success',
          timestamp: now.getTime() - 89 * 24 * 60 * 60 * 1000,
          read: false,
        },
      ],
    }));
    storage.invalidateCache();

    const user = renderHook(() => useNotifications('retention-user'));

    expect(user.result.current.items.map((item) => item.message)).toEqual(['Current']);
    const history = JSON.parse(localStorage.getItem('notificationHistory') ?? '{}');
    expect(history['user:retention-user']).toHaveLength(1);
  });
});

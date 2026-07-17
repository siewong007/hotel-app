import { useCallback, useSyncExternalStore } from 'react';
import {
  getNotificationPriority,
  type ApiNotificationDetail,
  type ApiNotificationPriority,
  type ApiNotificationSeverity,
} from './apiNotifications';
import { storage } from './storage';

export interface NotificationItem {
  id: number;
  message: string;
  severity: ApiNotificationSeverity;
  priority: ApiNotificationPriority;
  statusCode?: number;
  timestamp: number;
  read: boolean;
}

interface NotificationState {
  items: NotificationItem[];
  unreadCount: number;
}

const MAX_ITEMS = 100;
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const STORAGE_KEY = 'notificationHistory';
const GUEST_SCOPE = 'guest';

type StoredNotificationHistory = Record<string, NotificationItem[]>;
type NotificationOwnerId = string | number | null | undefined;

const states = new Map<string, NotificationState>();
const listeners = new Map<string, Set<() => void>>();

function getScopeKey(userId: NotificationOwnerId): string {
  const normalizedUserId = userId == null ? '' : String(userId).trim();
  return normalizedUserId ? `user:${normalizedUserId}` : GUEST_SCOPE;
}

function isNotificationItem(value: unknown): value is NotificationItem {
  if (!value || typeof value !== 'object') return false;

  const item = value as Partial<NotificationItem>;
  return (
    typeof item.id === 'number' &&
    typeof item.message === 'string' &&
    ['success', 'info', 'warning', 'error'].includes(item.severity ?? '') &&
    (item.priority === undefined || ['info', 'warning', 'critical'].includes(item.priority)) &&
    typeof item.timestamp === 'number' &&
    typeof item.read === 'boolean'
  );
}

function computeUnread(items: NotificationItem[]): number {
  return items.reduce((count, item) => (item.read ? count : count + 1), 0);
}

function getStoredHistory(): StoredNotificationHistory {
  const stored = storage.getItem<unknown>(STORAGE_KEY);
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};

  const cutoff = Date.now() - RETENTION_MS;
  const history: StoredNotificationHistory = {};
  let wasPruned = false;

  Object.entries(stored).forEach(([scopeKey, storedItems]) => {
    if (!Array.isArray(storedItems)) {
      wasPruned = true;
      return;
    }

    const items = storedItems
      .filter(isNotificationItem)
      .map((item) => ({
        ...item,
        priority: item.priority ?? getNotificationPriority(item.severity),
      }))
      .filter((item) => item.timestamp >= cutoff)
      .slice(0, MAX_ITEMS);
    if (items.length > 0) history[scopeKey] = items;
    if (items.length !== storedItems.length) wasPruned = true;
  });

  if (wasPruned) storage.setItem(STORAGE_KEY, history);
  return history;
}

function getState(scopeKey: string): NotificationState {
  const existing = states.get(scopeKey);
  if (existing) {
    const cutoff = Date.now() - RETENTION_MS;
    const items = existing.items.filter((item) => item.timestamp >= cutoff);
    if (items.length === existing.items.length) return existing;

    const next = { items, unreadCount: computeUnread(items) };
    states.set(scopeKey, next);
    persist(scopeKey, items);
    return next;
  }

  const storedItems = getStoredHistory()[scopeKey];
  const items = Array.isArray(storedItems) ? storedItems : [];
  const state = { items, unreadCount: computeUnread(items) };
  states.set(scopeKey, state);
  return state;
}

function persist(scopeKey: string, items: NotificationItem[]): void {
  const history = getStoredHistory();
  if (items.length === 0) {
    delete history[scopeKey];
  } else {
    history[scopeKey] = items;
  }
  storage.setItem(STORAGE_KEY, history);
}

function emit(scopeKey: string): void {
  listeners.get(scopeKey)?.forEach((listener) => listener());
}

function setState(scopeKey: string, next: NotificationState): void {
  states.set(scopeKey, next);
  persist(scopeKey, next.items);
  emit(scopeKey);
}

/** Record a notification in the history belonging to one authenticated user. */
export function recordNotification(
  detail: ApiNotificationDetail,
  userId?: NotificationOwnerId
): void {
  const scopeKey = getScopeKey(userId);
  const currentState = getState(scopeKey);
  const highestId = currentState.items.reduce((highest, item) => Math.max(highest, item.id), 0);
  const item: NotificationItem = {
    id: Math.max(Date.now(), highestId + 1),
    message: detail.message,
    severity: detail.severity,
    priority: detail.priority ?? getNotificationPriority(detail.severity),
    statusCode: detail.statusCode,
    timestamp: Date.now(),
    read: false,
  };
  const items = [item, ...currentState.items].slice(0, MAX_ITEMS);
  setState(scopeKey, { items, unreadCount: computeUnread(items) });
}

export function markAllRead(userId?: NotificationOwnerId): void {
  const scopeKey = getScopeKey(userId);
  const currentState = getState(scopeKey);
  if (currentState.unreadCount === 0) return;
  const items = currentState.items.map((item) => (item.read ? item : { ...item, read: true }));
  setState(scopeKey, { items, unreadCount: 0 });
}

export function removeNotification(id: number, userId?: NotificationOwnerId): void {
  const scopeKey = getScopeKey(userId);
  const currentState = getState(scopeKey);
  const items = currentState.items.filter((item) => item.id !== id);
  if (items.length === currentState.items.length) return;
  setState(scopeKey, { items, unreadCount: computeUnread(items) });
}

export function clearAll(userId?: NotificationOwnerId): void {
  const scopeKey = getScopeKey(userId);
  const currentState = getState(scopeKey);
  if (currentState.items.length === 0) return;
  setState(scopeKey, { items: [], unreadCount: 0 });
}

function subscribe(scopeKey: string, listener: () => void): () => void {
  const scopeListeners = listeners.get(scopeKey) ?? new Set<() => void>();
  scopeListeners.add(listener);
  listeners.set(scopeKey, scopeListeners);
  return () => {
    scopeListeners.delete(listener);
    if (scopeListeners.size === 0) listeners.delete(scopeKey);
  };
}

/** React hook exposing the current notification history and unread count. */
export function useNotifications(userId?: NotificationOwnerId): NotificationState {
  const scopeKey = getScopeKey(userId);
  const subscribeToScope = useCallback(
    (listener: () => void) => subscribe(scopeKey, listener),
    [scopeKey]
  );
  const getScopeSnapshot = useCallback(() => getState(scopeKey), [scopeKey]);
  return useSyncExternalStore(subscribeToScope, getScopeSnapshot, getScopeSnapshot);
}

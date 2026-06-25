import { useSyncExternalStore } from 'react';
import type { ApiNotificationDetail, ApiNotificationSeverity } from './apiNotifications';

export interface NotificationItem {
  id: number;
  message: string;
  severity: ApiNotificationSeverity;
  statusCode?: number;
  timestamp: number;
  read: boolean;
}

interface NotificationState {
  items: NotificationItem[];
  unreadCount: number;
}

const MAX_ITEMS = 100;

let state: NotificationState = { items: [], unreadCount: 0 };
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function setState(next: NotificationState) {
  state = next;
  emit();
}

function computeUnread(items: NotificationItem[]): number {
  return items.reduce((count, item) => (item.read ? count : count + 1), 0);
}

/** Record a notification into the persistent in-memory history. */
export function recordNotification(detail: ApiNotificationDetail): void {
  const item: NotificationItem = {
    id: nextId++,
    message: detail.message,
    severity: detail.severity,
    statusCode: detail.statusCode,
    timestamp: Date.now(),
    read: false,
  };
  const items = [item, ...state.items].slice(0, MAX_ITEMS);
  setState({ items, unreadCount: computeUnread(items) });
}

export function markAllRead(): void {
  if (state.unreadCount === 0) return;
  const items = state.items.map((item) => (item.read ? item : { ...item, read: true }));
  setState({ items, unreadCount: 0 });
}

export function removeNotification(id: number): void {
  const items = state.items.filter((item) => item.id !== id);
  if (items.length === state.items.length) return;
  setState({ items, unreadCount: computeUnread(items) });
}

export function clearAll(): void {
  if (state.items.length === 0) return;
  setState({ items: [], unreadCount: 0 });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): NotificationState {
  return state;
}

/** React hook exposing the current notification history and unread count. */
export function useNotifications(): NotificationState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

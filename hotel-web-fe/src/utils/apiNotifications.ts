export type ApiNotificationSeverity = 'success' | 'info' | 'warning' | 'error';

export interface ApiNotificationDetail {
  message: string;
  severity: ApiNotificationSeverity;
  statusCode?: number;
}

export const API_NOTIFICATION_EVENT = 'api:notification';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function firstStringFromArray(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.find((item): item is string => typeof item === 'string' && item.trim().length > 0)?.trim();
}

function normalizeSeverity(value: unknown): ApiNotificationSeverity | undefined {
  if (typeof value !== 'string') return undefined;

  switch (value.toLowerCase()) {
    case 'info':
    case 'information':
      return 'info';
    case 'warning':
    case 'warn':
      return 'warning';
    case 'error':
    case 'danger':
      return 'error';
    default:
      return undefined;
  }
}

export function getApiNotificationMessage(payload: unknown, statusCode: number): string {
  const explicitMessage = getExplicitApiNotificationMessage(payload);
  if (explicitMessage) return explicitMessage;

  if (statusCode >= 500) return 'A server error occurred. Please try again later.';
  if (statusCode === 404) return 'The requested item could not be found.';
  if (statusCode === 429) return 'Too many requests. Please try again shortly.';
  return 'Request failed.';
}

export function getExplicitApiNotificationMessage(payload: unknown): string | undefined {
  if (isRecord(payload)) {
    const nestedError = isRecord(payload.error) ? payload.error : undefined;
    const message = firstNonEmptyString(
      payload.error,
      payload.message,
      payload.detail,
      nestedError?.message,
      firstStringFromArray(payload.errors)
    );

    if (message) return message;
  }
  return undefined;
}

export function getApiNotificationSeverity(
  payload: unknown,
  statusCode: number
): ApiNotificationSeverity {
  if (isRecord(payload)) {
    const nestedError = isRecord(payload.error) ? payload.error : undefined;
    const explicitSeverity = normalizeSeverity(
      payload.severity ?? payload.level ?? payload.type ?? nestedError?.severity ?? nestedError?.level
    );

    if (explicitSeverity) return explicitSeverity;
  }

  if (statusCode === 404) return 'info';
  if (statusCode >= 400 && statusCode < 500) return 'warning';
  return 'error';
}

export function emitApiNotification(detail: ApiNotificationDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<ApiNotificationDetail>(API_NOTIFICATION_EVENT, { detail }));
}

import { toApiError } from '../../../api/client';

/**
 * Guest-facing error text: the server's own message when it provided one
 * (the `{"error": ...}` body is the user-facing contract), otherwise the
 * caller's friendly fallback — never transport noise like "Failed to fetch"
 * or a ky timeout string.
 */
export function guestErrorMessage(error: unknown, fallback: string): string {
  return toApiError(error, fallback).message;
}

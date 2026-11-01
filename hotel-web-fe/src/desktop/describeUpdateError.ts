/** Tauri invoke rejections arrive as plain strings, not Error instances. */
export function describeUpdateError(cause: unknown, fallback: string): string {
  if (cause instanceof Error) {
    return cause.message;
  }
  if (typeof cause === 'string' && cause) {
    return cause;
  }
  return fallback;
}

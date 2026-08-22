/**
 * Extract a user-facing message from an unknown caught value.
 *
 * `catch (err)` gives `unknown` in strict TypeScript; most call sites only
 * want a display string with a fallback. Handles Error instances (including
 * ky's HTTPError) and anything else by stringifying.
 */
export const errorMessage = (err: unknown, fallback = 'Something went wrong'): string => {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  return fallback;
};

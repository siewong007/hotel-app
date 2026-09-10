import type { UseTranslationResult } from '../../../i18n';

/**
 * Turns a `getToken` rejection into something a guest can act on.
 *
 * Every branch here is a failure to verify, and each one is reported rather
 * than swallowed: silently submitting without a token would just earn a 400
 * from the backend that reads, to the user, like their password was wrong.
 * The single most common cause in the wild is an ad blocker or a privacy
 * extension blocking `challenges.cloudflare.com`, so that case names the fix.
 */
export const turnstileErrorMessage = (
  error: unknown,
  t: UseTranslationResult['t'],
): string => {
  const code = error instanceof Error ? error.message : '';
  switch (code) {
    case 'turnstile-unavailable':
      return t('turnstile.unavailable');
    case 'turnstile-timeout':
      return t('turnstile.timeout');
    default:
      return t('turnstile.failed');
  }
};

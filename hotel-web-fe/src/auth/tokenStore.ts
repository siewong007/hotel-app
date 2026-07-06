/**
 * In-memory access-token store.
 *
 * SECURITY: the access token is deliberately held ONLY in this module-level
 * variable — never in localStorage/sessionStorage — so that an XSS payload
 * cannot exfiltrate a live session by reading storage. The refresh token lives
 * in an `HttpOnly` cookie the JS cannot read at all. On a full page reload this
 * variable is empty; the app re-mints an access token by calling `auth/refresh`,
 * which the browser answers using the refresh cookie.
 *
 * This is intentionally a plain module (not React state) because the non-React
 * `api/client.ts` request/refresh hooks need synchronous access to the token.
 */

let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function clearAccessToken(): void {
  accessToken = null;
}

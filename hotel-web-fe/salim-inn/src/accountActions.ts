// Account-aware header pills — the TypeScript successor to account-actions.js.
// It lives under src/ so it can import the resolved copy bundle and stay
// typechecked; served as an external module it keeps working under the desktop
// webview CSP (script-src 'self', no inline).
//
// The staff app keeps its access token in memory and its refresh token in an
// HttpOnly cookie, so nothing in storage says "signed in". The landing page
// asks GET /api/auth/session-hint instead: it validates the refresh cookie
// without rotating it (it can never race the app's own refresh) and returns
// only a display label. A guest-portal session lives in this tab's
// sessionStorage and is honoured too.
import { copy, fill, ready } from './content';

export type Account = { kind: 'guest' | 'staff'; name?: string } | null;

const SESSION_HINT_URL = '/api/auth/session-hint';
const HINT_TIMEOUT_MS = 3000;
const GUEST_PORTAL_TOKEN_KEY = 'guestPortalToken';
const GUEST_PORTAL_TOKEN_EXPIRES_KEY = 'guestPortalTokenExpiresAt';

function accountFromUrl(): Account | undefined {
  const fromUrl = new URLSearchParams(window.location.search).get('account');
  if (fromUrl === 'guest') return { kind: 'guest' };
  if (fromUrl === 'admin') return { kind: 'staff' };
  return undefined;
}

function guestPortalSession(): Account {
  try {
    const token = window.sessionStorage.getItem(GUEST_PORTAL_TOKEN_KEY);
    if (!token) return null;
    const expires = window.sessionStorage.getItem(GUEST_PORTAL_TOKEN_EXPIRES_KEY);
    if (expires && Date.parse(expires) <= Date.now()) return null;
    return { kind: 'guest' };
  } catch {
    // Private browsing may deny storage.
    return null;
  }
}

interface SessionHint {
  signed_in: boolean;
  account?: 'staff' | 'guest' | null;
  display_name?: string | null;
}

async function sessionFromServer(): Promise<Account> {
  if (typeof fetch !== 'function') return null;
  const controller = typeof AbortController === 'function' ? new AbortController() : undefined;
  const timer = window.setTimeout(() => controller?.abort(), HINT_TIMEOUT_MS);
  try {
    const response = await fetch(SESSION_HINT_URL, {
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: controller?.signal,
    });
    if (!response.ok) return null;
    const hint = (await response.json()) as SessionHint;
    if (!hint?.signed_in) return null;
    return {
      kind: hint.account === 'guest' ? 'guest' : 'staff',
      name: hint.display_name?.trim() || undefined,
    };
  } catch {
    // Offline, timed out, or the desktop webview (no same-origin API): signed out.
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

/** The visitor's account: an explicit handoff, then the server session, then a guest-portal tab session. */
export async function resolveAccount(): Promise<Account> {
  const handoff = accountFromUrl();
  if (handoff !== undefined) return handoff;
  return (await sessionFromServer()) ?? guestPortalSession();
}

/** "Siew Wong" -> "SW", "admin" -> "A". */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : parts.slice(0, 1);
  return letters.map((p) => Array.from(p)[0] ?? '').join('').toUpperCase();
}

// One destination for booking, whoever is looking. Booking no longer requires
// an account: a signed-out visitor books anonymously and pays with the
// booking-scoped link, so sending them to /register first was a detour that
// lost the booking intent on the way (neither /register nor /login carried it
// through to the booking flow).
const BOOKING_LINK = '/guest-portal?view=booking';

let current: Account = null;

function setLabel(el: HTMLAnchorElement, label: string, name?: string): void {
  if (!name) {
    el.textContent = label;
    el.removeAttribute('title');
    el.removeAttribute('aria-label');
    el.classList.remove('sign-in--account');
    return;
  }
  const badge = document.createElement('span');
  badge.className = 'account-initials';
  badge.setAttribute('aria-hidden', 'true');
  badge.textContent = initialsOf(name);
  const text = document.createElement('span');
  text.textContent = label;
  el.replaceChildren(badge, text);
  const signedIn = fill(copy.account.signedInAs, { name });
  el.title = signedIn;
  el.setAttribute('aria-label', `${label} — ${signedIn}`);
  el.classList.add('sign-in--account');
}

/** Paints the pills for `account` (defaults to the last resolved one). */
export function updateAccountActions(account: Account = current): void {
  current = account;
  const accountAction = document.getElementById('accountAction') as HTMLAnchorElement | null;
  const bookingAction = document.getElementById('bookingAction') as HTMLAnchorElement | null;
  const mobileCta = document.getElementById('mobile-cta');
  if (!accountAction || !bookingAction) return;

  bookingAction.hidden = false;
  if (mobileCta) mobileCta.hidden = false;
  if (account?.kind === 'guest') {
    setLabel(accountAction, copy.account.myAccount, account.name);
    accountAction.href = '/guest-portal';
    bookingAction.textContent = copy.account.bookAnotherStay;
    bookingAction.href = BOOKING_LINK;
  } else if (account?.kind === 'staff') {
    setLabel(accountAction, copy.account.adminConsole, account.name);
    accountAction.href = '/admin-portal';
    bookingAction.hidden = true;
    if (mobileCta) mobileCta.hidden = true;
  } else {
    setLabel(accountAction, copy.account.signIn);
    accountAction.href = '/login';
    bookingAction.textContent = copy.nav.book;
    bookingAction.href = BOOKING_LINK;
  }
  // index.html ships the pill hidden (data-pending) so a signed-in visitor
  // never sees a flash of "Sign in"; reveal it once we know.
  accountAction.removeAttribute('data-pending');
}

/** Resolve the session and repaint. */
export async function refreshAccountActions(): Promise<void> {
  const [account] = await Promise.all([resolveAccount(), ready]);
  updateAccountActions(account);
}

void refreshAccountActions();
// A bfcache restore may follow a sign-in or sign-out in another page.
window.addEventListener('pageshow', (event) => {
  if (event.persisted) void refreshAccountActions();
  else updateAccountActions();
});

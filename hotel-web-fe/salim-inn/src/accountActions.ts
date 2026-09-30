// Account-aware header pills — the TypeScript successor to account-actions.js.
// It lives under src/ so it can import the resolved copy bundle and stay
// typechecked; served as an external module it keeps working under the desktop
// webview CSP (script-src 'self', no inline).
import { copy, ready } from './content';

type Account = 'guest' | 'admin' | null;

function getCurrentAccount(): Account {
  const accountFromUrl = new URLSearchParams(window.location.search).get('account');
  if (accountFromUrl === 'guest' || accountFromUrl === 'admin') {
    return accountFromUrl;
  }

  try {
    const storedUser = JSON.parse(window.localStorage.getItem('user') || 'null') as
      | { user_type?: string }
      | null;
    return storedUser?.user_type === 'guest' ? 'guest' : storedUser ? 'admin' : null;
  } catch {
    // Private browsing may deny storage; without an explicit handoff account,
    // treat the visitor as signed out.
    return null;
  }
}

// One destination for booking, whoever is looking. Booking no longer requires
// an account: a signed-out visitor books anonymously and pays with the
// booking-scoped link, so sending them to /register first was a detour that
// lost the booking intent on the way (neither /register nor /login carried it
// through to the booking flow).
const BOOKING_LINK = '/guest-portal?view=booking';

export function updateAccountActions(): void {
  const accountAction = document.getElementById('accountAction') as HTMLAnchorElement | null;
  const bookingAction = document.getElementById('bookingAction') as HTMLAnchorElement | null;
  const mobileCta = document.getElementById('mobile-cta');
  if (!accountAction || !bookingAction) return;
  const account = getCurrentAccount();

  bookingAction.hidden = false;
  if (mobileCta) mobileCta.hidden = false;
  if (account === 'guest') {
    accountAction.textContent = copy.account.myAccount;
    accountAction.href = '/guest-portal';
    bookingAction.textContent = copy.account.bookAnotherStay;
    bookingAction.href = BOOKING_LINK;
  } else if (account === 'admin') {
    accountAction.textContent = copy.account.adminConsole;
    accountAction.href = '/admin-portal';
    bookingAction.hidden = true;
    if (mobileCta) mobileCta.hidden = true;
  } else {
    accountAction.textContent = copy.account.signIn;
    accountAction.href = '/login';
    bookingAction.textContent = copy.nav.book;
    bookingAction.href = BOOKING_LINK;
  }
}

// in the visitor's language: after its bundle has arrived (content/index.ts)
void ready.then(updateAccountActions);
window.addEventListener('pageshow', updateAccountActions);

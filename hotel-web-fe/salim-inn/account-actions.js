// Account-aware header pills. External module (not inline) so the desktop
// webview's CSP (script-src 'self', no inline) can execute it.
function getCurrentAccount() {
  const accountFromUrl = new URLSearchParams(window.location.search).get('account');
  if (accountFromUrl === 'guest' || accountFromUrl === 'admin') {
    return accountFromUrl;
  }

  try {
    const storedUser = JSON.parse(window.localStorage.getItem('user') || 'null');
    return storedUser?.user_type === 'guest'
      ? 'guest'
      : storedUser ? 'admin' : null;
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

function updateAccountActions() {
  const accountAction = document.getElementById('accountAction');
  const bookingAction = document.getElementById('bookingAction');
  const account = getCurrentAccount();

  bookingAction.hidden = false;
  if (account === 'guest') {
    accountAction.textContent = 'My account';
    accountAction.href = '/guest-portal';
    bookingAction.textContent = 'Book another stay';
    bookingAction.href = BOOKING_LINK;
  } else if (account === 'admin') {
    accountAction.textContent = 'Admin console';
    accountAction.href = '/admin-portal';
    bookingAction.hidden = true;
  } else {
    accountAction.textContent = 'Sign in';
    accountAction.href = '/login?account=guest';
    bookingAction.textContent = 'Book stay';
    bookingAction.href = BOOKING_LINK;
  }
}

updateAccountActions();
window.addEventListener('pageshow', updateAccountActions);

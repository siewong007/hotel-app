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

function updateAccountActions() {
  const accountAction = document.getElementById('accountAction');
  const bookingAction = document.getElementById('bookingAction');
  const account = getCurrentAccount();

  bookingAction.hidden = false;
  if (account === 'guest') {
    accountAction.textContent = 'My account';
    accountAction.href = '/guest-portal';
    bookingAction.textContent = 'Book another stay';
    bookingAction.href = '/guest-portal?view=booking';
  } else if (account === 'admin') {
    accountAction.textContent = 'Admin console';
    accountAction.href = '/admin-portal';
    bookingAction.hidden = true;
  } else {
    accountAction.textContent = 'Sign in';
    accountAction.href = '/login?account=guest';
    bookingAction.textContent = 'Book stay';
    bookingAction.href = '/register';
  }
}

updateAccountActions();
window.addEventListener('pageshow', updateAccountActions);

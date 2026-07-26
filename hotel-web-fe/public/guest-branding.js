// Early title/favicon swap for guest-facing routes. Loaded as a classic
// external script (not inline) so the desktop webview's CSP
// (script-src 'self', no inline) can execute it; classic + in <head> keeps the
// pre-paint, no-flash timing of the previous inline block.
(() => {
  const guestPaths = new Set(['/guest-portal', '/offers', '/register']);
  const params = new URLSearchParams(window.location.search);
  const isGuestExperience = guestPaths.has(window.location.pathname)
    || (window.location.pathname === '/login' && params.get('account') === 'guest');

  if (!isGuestExperience) return;

  document.title = 'Salim Inn Sibu - Cozy stays at Farley';
  const favicon = document.getElementById('app-favicon');
  if (favicon) favicon.href = '/salim-inn/salim-inn-icon.svg';
})();

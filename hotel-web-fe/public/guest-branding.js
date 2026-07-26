// Early title/favicon swap, before the app bundle renders. Loaded as a classic
// external script (not inline) so the desktop webview's CSP
// (script-src 'self', no inline) can execute it; classic + in <head> keeps the
// pre-paint, no-flash timing of the previous inline block.
//
// The title comes from the hotel settings cache that boot refreshes from the
// unauthenticated `settings/public` endpoint (src/index.tsx). RootLayout sets
// the same title once React mounts — this only avoids showing index.html's
// static placeholder in between.
(() => {
  const guestPaths = new Set(['/guest-portal', '/offers', '/register']);
  const params = new URLSearchParams(window.location.search);
  const isGuestExperience = guestPaths.has(window.location.pathname)
    || (window.location.pathname === '/login' && params.get('account') === 'guest');

  try {
    const cached = localStorage.getItem('hotelSettings');
    const hotelName = cached ? JSON.parse(cached).hotel_name : null;
    if (typeof hotelName === 'string' && hotelName.trim()) {
      document.title = hotelName.trim();
      // Sign-in/register card eyebrow — a CSS ::before, so it needs the name as
      // a quoted custom property. RootLayout re-applies this once React mounts.
      document.documentElement.style.setProperty(
        '--auth-brand-eyebrow',
        JSON.stringify(hotelName.trim())
      );
    }
  } catch {
    // Unreadable cache (private mode, corrupt JSON) — keep the static defaults.
  }

  if (!isGuestExperience) return;

  const favicon = document.getElementById('app-favicon');
  if (favicon) favicon.href = '/salim-inn/salim-inn-icon.svg';
})();

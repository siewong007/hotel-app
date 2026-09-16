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
  const guestPaths = new Set(['/guest-portal', '/offers', '/register', '/login', '/complete-profile']);
  const isGuestExperience = guestPaths.has(window.location.pathname);

  // Boot-splash theme: pick the surface the app will mount with, before first
  // paint, so the static splash in index.html/guest.html doesn't flash the
  // wrong background. Staff reads `themeMode` (dark default); the guest app
  // reads `guestThemeMode`, accepts 'system', and falls back to legacy
  // `themeMode` then the OS preference. Mirrors normalizeThemeMode /
  // normalizeGuestThemePreference — keep in sync.
  try {
    const surface = document.documentElement.dataset.bootSurface;
    const stored =
      surface === 'guest'
        ? (localStorage.getItem('guestThemeMode') ?? localStorage.getItem('themeMode'))
        : localStorage.getItem('themeMode');
    const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
    const light =
      stored === 'light' ||
      (surface === 'guest' && stored !== 'dark' && media !== null && media.matches);
    document.documentElement.dataset.bootTheme = light ? 'light' : 'dark';
  } catch {
    document.documentElement.dataset.bootTheme = 'dark';
  }

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

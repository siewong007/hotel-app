// Dynamic room photos for the landing gallery. External module (not inline) so
// the desktop webview's CSP (script-src 'self', no inline) can execute it.
//
// Fetches active room types from the public API and swaps each bound card's
// <img> to the type's first uploaded photo (its cover). Cards bind via
// data-room-name (normalized, case-insensitive) or an optional data-room-code.
// On any failure the bundled photos in /salim-inn/rooms/ stay in place.
(async () => {
  const grid = document.querySelector('.photo-grid');
  if (!grid) return;

  const baseUrl = await resolveApiBaseUrl();

  let roomTypes;
  try {
    const response = await fetch(`${baseUrl}/api/booking/room-types`);
    if (!response.ok) return;
    roomTypes = await response.json();
  } catch {
    return;
  }
  if (!Array.isArray(roomTypes)) return;

  const normalize = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const coverOf = (roomType) =>
    Array.isArray(roomType.images)
      ? roomType.images.find((url) => typeof url === 'string' && url.trim().length > 0) || null
      : null;
  // Relative /uploads/... URLs resolve against the backend origin — which in
  // the desktop webview is the runtime-assigned sidecar port, not the page's.
  const absolute = (url) => (url.startsWith('/') && baseUrl ? `${baseUrl}${url}` : url);

  const matchedIds = new Set();
  for (const card of grid.querySelectorAll('figure[data-room-name], figure[data-room-code]')) {
    const nameKey = normalize(card.dataset.roomName);
    const codeKey = normalize(card.dataset.roomCode);
    const roomType = roomTypes.find(
      (t) => (codeKey && normalize(t.code) === codeKey) || (nameKey && normalize(t.name) === nameKey)
    );
    const cover = roomType && coverOf(roomType);
    if (!roomType || !cover) continue;
    const img = card.querySelector('img');
    if (!img) continue;
    matchedIds.add(roomType.id);
    img.src = absolute(cover.trim());
  }

  // An active type with photos but no static card (e.g. a future Standard
  // Queen) gets one appended ahead of the non-room cards.
  const firstStaticCard = grid.querySelector('figure:not([data-room-name]):not([data-room-code])');
  for (const roomType of roomTypes) {
    const cover = coverOf(roomType);
    if (!cover || matchedIds.has(roomType.id)) continue;
    const figure = document.createElement('figure');
    figure.className = 'photo-card';
    figure.dataset.roomName = roomType.name;
    const img = document.createElement('img');
    img.src = absolute(cover.trim());
    img.alt = `Salim Inn ${roomType.name}`;
    img.loading = 'lazy';
    const caption = document.createElement('figcaption');
    const strong = document.createElement('strong');
    strong.textContent = roomType.name;
    caption.appendChild(strong);
    figure.append(img, caption);
    grid.insertBefore(figure, firstStaticCard);
  }
})();

async function resolveApiBaseUrl() {
  // Desktop webview: the backend binds a runtime-probed port, exposed via IPC.
  const tauri = window.__TAURI_INTERNALS__;
  if (tauri && typeof tauri.invoke === 'function') {
    try {
      const status = await tauri.invoke('get_status');
      if (status && status.backend_url) {
        return String(status.backend_url).replace(/\/+$/, '');
      }
    } catch {
      // Fall through to same-origin.
    }
  }
  return '';
}

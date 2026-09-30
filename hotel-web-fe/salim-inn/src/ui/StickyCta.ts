// Every "Book" on the page leads to chapter 8's booking panel (brief §3: the
// sticky Book direct "jumps to chapter 8 with the room type from the
// configurator pre-selected"): the top bar's pill, the mobile bar, the skip
// link, and the booking links below the film (a room card pre-selects its
// own type). Their hrefs still point at the portal, so a middle-click or a
// page without JavaScript goes straight there.
import type { RoomCode } from '../config/site';
import { track } from './booking';

export function wireBookingCtas(go: (room?: RoomCode) => void, current: () => RoomCode): void {
  const bind = (el: Element | null, source: string, room?: RoomCode) => {
    el?.addEventListener('click', (e) => {
      const m = e as MouseEvent;
      if (m.button !== 0 || m.metaKey || m.ctrlKey || m.shiftKey || m.altKey) return;
      e.preventDefault();
      track('booking_cta_click', { source, roomType: room ?? current() });
      go(room);
    });
  };
  bind(document.getElementById('bookingAction'), 'header');
  bind(document.querySelector('#mobile-cta a'), 'mobile-bar');
  document.querySelectorAll('a[href="#book"]').forEach((a) => bind(a, 'skip-link'));
  document.querySelectorAll<HTMLAnchorElement>('.after a[data-room]').forEach((a) => bind(a, 'room-card', a.dataset.room as RoomCode));
  document.querySelectorAll('.after a[href^="/guest-portal?view=booking"]:not([data-room])').forEach((a) => bind(a, 'page'));
}

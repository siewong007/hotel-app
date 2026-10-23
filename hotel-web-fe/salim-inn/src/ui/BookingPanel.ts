// Chapter 8's booking panel (brief §7): dates, guests and room type (pre-filled
// from the configurator), occupancy explained in plain words, then Book direct
// goes straight to the guest portal in the same tab, carrying the choice in the
// URL so the portal opens on Choose with the room highlighted (see booking.ts).
// WhatsApp (pre-filled with the same choice) and a call are the secondary
// actions. The times are in the card at its head; the trust row
// below carries cancellation and payment.
// No names, emails or payment details are collected here.
import { ROOM_ORDER, roomLayouts } from '../interiors/roomLayouts';
import { SHOW_PRICES, SITE, WEB_RATES, type RoomCode } from '../config/site';
import { copy, fill, roomName } from '../content';
import {
  addDays, check, defaultChoice, guestsText, portalUrl, summary, todayInSibu, track, whatsappUrl,
  type BookingChoice, type Check, type Field,
} from './booking';

const layouts = roomLayouts();

/** The registration card's facts — the same card sits on the counter in chapter 5. */
export function regCardHtml(extraClass = ''): string {
  const { checkIn, checkOut, hours } = copy.frontDesk;
  return `<div class="reg-card ${extraClass}"><p class="reg-card__name">${SITE.name}</p><ul class="reg-card__facts">${[checkIn, checkOut, hours].map((f) => `<li>${f}</li>`).join('')}</ul></div>`;
}

export class BookingPanel {
  readonly el: HTMLFormElement;
  private f: { checkIn: HTMLInputElement; checkOut: HTMLInputElement; adults: HTMLSelectElement; children: HTMLSelectElement; room: HTMLSelectElement };
  private msg: HTMLElement;
  private wa: HTMLAnchorElement;
  private attempted = false;
  private roomTouched = false;
  private viewed = false;

  constructor(host: HTMLElement) {
    const c = copy.booking;
    const today = todayInSibu();
    const first = defaultChoice('DLX', today);
    const opt = (v: number | string, label: string) => `<option value="${v}">${label}</option>`;
    const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
    host.innerHTML = `
      <form class="booking" novalidate aria-label="${c.formLabel}">
        ${regCardHtml('reg-card--compact')}
        <div class="bk-grid">
          <label class="bk-field"><span>${c.checkIn}</span><input type="date" name="checkIn" required min="${today}" value="${first.checkIn}" aria-describedby="bk-msg"></label>
          <label class="bk-field"><span>${c.checkOut}</span><input type="date" name="checkOut" required min="${addDays(today, 1)}" value="${first.checkOut}" aria-describedby="bk-msg"></label>
          <label class="bk-field"><span>${c.adults}</span><select name="adults" aria-describedby="bk-msg">${range(1, 5).map((n) => opt(n, String(n))).join('')}</select></label>
          <label class="bk-field"><span>${c.children}</span><select name="children" aria-describedby="bk-msg">${range(0, 4).map((n) => opt(n, String(n))).join('')}</select></label>
          <label class="bk-field bk-field--wide"><span>${c.room}</span><select name="room" aria-describedby="bk-msg">${ROOM_ORDER.map((code) => opt(code, `${fill(c.roomOption, { room: roomName(code), n: layouts[code].maxGuests })}${SHOW_PRICES ? fill(c.roomOptionRate, { rate: WEB_RATES[code] }) : ''}`)).join('')}</select></label>
        </div>
        <p class="bk-msg" id="bk-msg" aria-live="polite"></p>
        <div class="bk-actions">
          <button class="pill pill--gold" type="submit">${c.submit}</button>
          <a class="pill" data-bk="wa" href="${whatsappUrl('')}" target="_blank" rel="noopener">${c.whatsapp}</a>
          <a class="pill" data-bk="call" href="tel:${SITE.phoneE164}">${c.call}</a>
        </div>
        <ul class="bk-trust">
          <li>${c.cancellation}</li>
          <li>${fill(c.payLine, { methods: c.paymentMethods.join(c.listSep) })}</li>
          ${SHOW_PRICES ? `<li>${c.webRate}</li>` : ''}
        </ul>
      </form>`;
    this.el = host.querySelector('form')!;
    const q = <T extends Element>(sel: string) => this.el.querySelector(sel) as T;
    this.f = {
      checkIn: q('[name=checkIn]'), checkOut: q('[name=checkOut]'),
      adults: q('[name=adults]'), children: q('[name=children]'), room: q('[name=room]'),
    };
    this.f.adults.value = String(first.adults);
    this.f.room.value = first.room;
    this.msg = q('#bk-msg');
    this.wa = q('[data-bk=wa]');

    this.f.checkIn.addEventListener('change', () => {
      // keep the stay at least one night long
      const v = this.f.checkIn.value;
      if (v) {
        this.f.checkOut.min = addDays(v, 1);
        if (!this.f.checkOut.value || this.f.checkOut.value <= v) this.f.checkOut.value = addDays(v, 1);
      }
      this.refresh();
    });
    for (const el of [this.f.checkOut, this.f.adults, this.f.children]) el.addEventListener('change', () => this.refresh());
    this.f.room.addEventListener('change', () => {
      this.roomTouched = true;
      this.refresh();
    });
    this.el.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submit();
    });
    this.wa.addEventListener('click', () => track('booking_cta_click', { source: 'whatsapp', roomType: this.read().room }));
    q<HTMLAnchorElement>('[data-bk=call]').addEventListener('click', () => track('booking_cta_click', { source: 'call', roomType: this.read().room }));
    this.refresh();
  }

  /** Pre-select the configurator's room type — unless the visitor already chose one here. */
  preselect(room: RoomCode, force = false): void {
    if (this.roomTouched && !force) return;
    this.f.room.value = room;
    if (force) this.roomTouched = true;
    this.refresh();
  }

  /** The panel came into view (analytics, once). */
  seen(): void {
    if (this.viewed) return;
    this.viewed = true;
    track('booking_cta_view', { roomType: this.read().room });
  }

  focus(): void {
    this.f.checkIn.focus({ preventScroll: true });
  }

  read(): BookingChoice {
    return {
      checkIn: this.f.checkIn.value,
      checkOut: this.f.checkOut.value,
      adults: Number(this.f.adults.value),
      children: Number(this.f.children.value),
      room: this.f.room.value as RoomCode,
    };
  }

  private refresh(): Check {
    const choice = this.read();
    const k = check(choice);
    const shown: Field[] = this.attempted ? (Object.keys(k.errors) as Field[]) : k.errors.room ? ['room'] : [];
    const fieldEl: Record<Field, HTMLElement> = { checkIn: this.f.checkIn, checkOut: this.f.checkOut, adults: this.f.adults, room: this.f.room };
    for (const [name, el] of Object.entries(fieldEl)) el.setAttribute('aria-invalid', String(shown.includes(name as Field)));
    const lines = shown.map((n) => k.errors[n]!);
    if (k.note) lines.push(k.note);
    this.msg.textContent = lines.join(' ');
    this.msg.classList.toggle('is-error', shown.length > 0);
    this.wa.href = whatsappUrl(k.ok ? summary(choice, k) : `${layouts[choice.room]?.name ?? ''}, ${guestsText(choice)}`);
    return k;
  }

  private submit(): void {
    this.attempted = true;
    const k = this.refresh();
    const choice = this.read();
    if (!k.ok) {
      const firstBad = (['checkIn', 'checkOut', 'adults', 'room'] as Field[]).find((n) => k.errors[n]);
      if (firstBad) (firstBad === 'adults' ? this.f.adults : firstBad === 'room' ? this.f.room : this.f[firstBad]).focus();
      return;
    }
    track('booking_submit', { roomType: choice.room, nights: k.nights, guests: k.guests });
    // Same tab on every device: the portal's dark splash continues the page
    // (no new-tab flash), and Back returns here.
    window.location.assign(portalUrl(choice));
  }
}

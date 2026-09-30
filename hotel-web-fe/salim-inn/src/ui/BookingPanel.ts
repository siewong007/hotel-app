// Chapter 8's booking panel (brief §7): dates, guests and room type (pre-filled
// from the configurator), occupancy explained in plain words, then Book direct
// — the guest portal opens (new tab on desktop, same tab on phones) and the
// choice stays on screen as a copyable summary, because the portal does not
// read pre-fill parameters yet (see booking.ts). WhatsApp and a call are the
// secondary actions; the trust row carries times, cancellation and payment.
// No names, emails or payment details are collected here.
import { ROOM_ORDER, roomLayouts } from '../interiors/roomLayouts';
import { SHOW_PRICES, SITE, WEB_RATES, type RoomCode } from '../config/site';
import { copy, fill, roomName } from '../content';
import {
  addDays, check, defaultChoice, guestsText, portalUrl, summary, todayInSibu, track, whatsappUrl,
  type BookingChoice, type Check, type Field,
} from './booking';

const layouts = roomLayouts();
const MOBILE = '(max-width: 760px)';

/** The registration card's facts — the same card sits on the counter in chapter 5. */
export function regCardHtml(extraClass = ''): string {
  const { checkIn, checkOut, hours } = copy.frontDesk;
  return `<div class="reg-card ${extraClass}"><p class="reg-card__name">${SITE.name}</p><ul class="reg-card__facts">${[checkIn, checkOut, hours].map((f) => `<li>${f}</li>`).join('')}</ul></div>`;
}

export class BookingPanel {
  readonly el: HTMLFormElement;
  private f: { checkIn: HTMLInputElement; checkOut: HTMLInputElement; adults: HTMLSelectElement; children: HTMLSelectElement; room: HTMLSelectElement };
  private msg: HTMLElement;
  private box: HTMLElement;
  private lead: HTMLElement;
  private text: HTMLElement;
  private copyBtn: HTMLButtonElement;
  private go: HTMLAnchorElement;
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
        <div class="bk-summary" hidden>
          <p class="bk-summary__lead"></p>
          <pre class="bk-summary__text" tabindex="0" aria-label="${c.summaryLabel}"></pre>
          <div class="bk-summary__actions">
            <button class="pill" type="button" data-bk="copy">${c.copy}</button>
            <a class="pill pill--gold" data-bk="go" href="${SITE.bookingUrl}">${c.continue}</a>
          </div>
        </div>
        <ul class="bk-trust">
          <li>${copy.frontDesk.checkIn} · ${copy.frontDesk.checkOut}</li>
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
    this.box = q('.bk-summary');
    this.lead = q('.bk-summary__lead');
    this.text = q('.bk-summary__text');
    this.copyBtn = q('[data-bk=copy]');
    this.go = q('[data-bk=go]');
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
    this.copyBtn.addEventListener('click', () => void this.copy());
    this.go.addEventListener('click', () => void this.copy(true));
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
    if (!this.box.hidden && !k.ok) this.box.hidden = true;
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
    const url = portalUrl(choice);
    this.text.textContent = summary(choice, k);
    this.go.href = url;
    const mobile = window.matchMedia(MOBILE).matches;
    this.box.hidden = false;
    if (mobile) {
      // same tab on phones: leave the summary up and let them copy it first
      this.lead.textContent = copy.booking.leadMobile;
      this.go.removeAttribute('target');
      this.go.textContent = copy.booking.continue;
      this.go.focus();
    } else {
      this.lead.textContent = copy.booking.leadDesktop;
      this.go.target = '_blank';
      this.go.rel = 'noopener';
      this.go.textContent = copy.booking.reopen;
      window.open(url, '_blank', 'noopener');
      this.text.focus();
    }
  }

  /** Copy the summary; quietly when on the way to the portal. */
  private async copy(quiet = false): Promise<void> {
    const t = this.text.textContent ?? '';
    if (!t) return;
    try {
      await navigator.clipboard.writeText(t);
      if (!quiet) this.flash(copy.booking.copied);
    } catch {
      if (quiet) return;
      // no clipboard access: select the text so it can be copied by hand
      const r = document.createRange();
      r.selectNodeContents(this.text);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(r);
      this.flash(copy.booking.selectToCopy);
    }
  }

  private flash(label: string): void {
    const before = copy.booking.copy;
    this.copyBtn.textContent = label;
    window.setTimeout(() => { this.copyBtn.textContent = before; }, 2200);
  }
}

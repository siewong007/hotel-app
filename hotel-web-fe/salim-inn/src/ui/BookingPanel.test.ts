// Chapter 8's booking panel as a visitor reads it (brief 2026-10-13, part
// 12): the front desk's times once, in the card at its head; Book direct
// first, then the two quieter ways; the trust row keeps cancellation and
// payment.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BookingPanel } from './BookingPanel';
import { en } from '../content/en';
import { SITE } from '../config/site';

describe('the booking panel', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  const mount = () => {
    document.body.innerHTML = '<div id="book"></div>';
    new BookingPanel(document.getElementById('book')!);
    return document.querySelector<HTMLFormElement>('form.booking')!;
  };

  it('says the front desk’s times once, in the card at its head', () => {
    const form = mount();
    const facts = [...form.querySelectorAll('.reg-card--compact li')].map((li) => li.textContent);
    expect(facts).toEqual([en.frontDesk.checkIn, en.frontDesk.checkOut, en.frontDesk.hours]);
    expect(form.firstElementChild!.classList.contains('reg-card--compact')).toBe(true);
    expect(form.textContent!.split(en.frontDesk.checkIn).length - 1).toBe(1);
    const trust = form.querySelector('.bk-trust')!.textContent!;
    expect(trust).toContain(en.booking.cancellation);
    expect(trust).not.toContain(en.frontDesk.checkOut);
  });

  it('leads with Book direct, then WhatsApp and a call', () => {
    const form = mount();
    const actions = [...form.querySelectorAll<HTMLElement>('.bk-actions > *')];
    expect(actions.map((a) => a.getAttribute('type') ?? a.dataset.bk)).toEqual(['submit', 'wa', 'call']);
    expect(actions[0].classList.contains('pill--gold')).toBe(true);
    expect(actions.slice(1).every((a) => !a.classList.contains('pill--gold'))).toBe(true);
  });

  it('pre-fills WhatsApp with the selection', () => {
    const form = mount();
    const set = (name: string, value: string) => {
      const el = form.querySelector<HTMLInputElement | HTMLSelectElement>(`[name=${name}]`)!;
      el.value = value;
      el.dispatchEvent(new Event('change'));
    };
    set('adults', '2');
    set('room', 'DLX');
    const href = form.querySelector<HTMLAnchorElement>('[data-bk=wa]')!.href;
    expect(href.startsWith(`https://wa.me/${SITE.whatsapp}?text=`)).toBe(true);
    const text = decodeURIComponent(href.split('?text=')[1]);
    expect(text).toContain('2 adults');
    expect(text).toContain('Deluxe');
    const checkIn = form.querySelector<HTMLInputElement>('[name=checkIn]')!.value;
    expect(text).toContain(String(Number(checkIn.slice(8))));
  });

  it('Book direct goes straight to the portal with the choice — no copy step', () => {
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...original, assign } });
    try {
      const form = mount();
      expect(form.querySelector('.bk-summary, [data-bk=copy], [data-bk=go]')).toBeNull();
      form.querySelector<HTMLSelectElement>('[name=adults]')!.value = '2';
      form.requestSubmit();
      expect(assign).toHaveBeenCalledTimes(1);
      const url = new URL(assign.mock.calls[0][0] as string, 'https://example.test');
      expect(url.pathname).toBe('/guest-portal');
      expect(url.searchParams.get('view')).toBe('booking');
      expect(url.searchParams.get('adults')).toBe('2');
      expect(url.searchParams.get('children')).toBe('0');
      expect(url.searchParams.get('room_type')).toBe('DLX');
      expect(url.searchParams.get('check_in_date')).toBe(form.querySelector<HTMLInputElement>('[name=checkIn]')!.value);
      expect(url.searchParams.get('check_out_date')).toBe(form.querySelector<HTMLInputElement>('[name=checkOut]')!.value);
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
  });
});

// Chapter 8's booking panel as a visitor reads it (brief 2026-10-13, part
// 12): the front desk's times once, in the card at its head; Book direct
// first, then the two quieter ways; the trust row keeps cancellation and
// payment.
import { afterEach, describe, expect, it } from 'vitest';
import { BookingPanel } from './BookingPanel';
import { en } from '../content/en';

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
});

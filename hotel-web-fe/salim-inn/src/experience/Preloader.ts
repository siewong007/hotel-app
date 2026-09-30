// Chapter 0: brand mark draws in (CSS stroke), the bar tracks real work —
// scene build steps and the async shader precompile — and the poster behind
// keeps LCP instant.
import { copy } from '../content';

export class Preloader {
  private el = document.getElementById('preloader')!;
  private bar = this.el.querySelector<HTMLElement>('.preloader__bar span')!;
  private label = this.el.querySelector<HTMLElement>('.preloader__label')!;
  private value = 0;

  set(fraction: number, label?: string): void {
    this.value = Math.max(this.value, Math.min(1, fraction));
    this.bar.style.transform = `scaleX(${this.value})`;
    if (label) this.label.textContent = label;
  }

  done(): void {
    this.set(1, copy.preloader.ready);
    window.setTimeout(() => this.el.classList.add('is-done'), 450);
    // the canvas has faded in over the poster by then (main.css)
    window.setTimeout(() => document.documentElement.classList.add('film-live'), 1500);
  }
}

export const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

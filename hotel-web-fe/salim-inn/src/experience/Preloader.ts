// Chapter 0: brand mark draws in (CSS stroke), the bar tracks real work —
// scene build steps and the async shader precompile — and the poster behind
// keeps LCP instant.
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
    this.set(1, 'Scroll to begin');
    window.setTimeout(() => this.el.classList.add('is-done'), 450);
  }
}

export const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

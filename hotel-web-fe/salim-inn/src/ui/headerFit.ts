// Play film steps aside when the top bar's row cannot hold it (main.css,
// tablet). Measured rather than set by a breakpoint: how long the row runs
// depends on the language, the visitor's account (accountActions.ts) and the
// platform's select. On an iPad in portrait Play fits beside Chinese and most
// English pills but not beside Malay ones, so a breakpoint would either hide
// it where it fits or let the row overflow. It is measured at its longest
// label (play, pause or replay), so it does not come and go as the film plays.
// Phones stack the bar in two rows instead (main.css, mobile) and are left as
// they are.
import { copy } from '../content';

const CROWDED = 'is-crowded-out';
const MEASURING = 'is-measuring';

/** Hides #play while the bar's row cannot hold it beside the other pills. */
export function fitPlay(bar: HTMLElement): void {
  const row = bar.querySelector<HTMLElement>('.top-actions');
  const play = row?.querySelector<HTMLElement>('#play');
  if (!row || !play) return;
  play.classList.remove(CROWDED);
  if (getComputedStyle(bar).flexDirection !== 'row' || getComputedStyle(play).display === 'none') return;
  const label = play.textContent;
  row.classList.add(MEASURING); // every pill at its natural width: none wraps or gives way
  const crowded = [copy.nav.play, copy.nav.pause, copy.nav.replay].some((text) => {
    play.textContent = text;
    return overflows(row);
  });
  play.textContent = label;
  row.classList.remove(MEASURING);
  play.classList.toggle(CROWDED, crowded);
}

/** Whether a pill runs past the row's right edge (the row itself gives way to
 *  the brand, main.css; its pills, while measuring, do not). */
const overflows = (row: HTMLElement): boolean => {
  const edge = row.getBoundingClientRect().right;
  return [...row.children].some((pill) => pill.getBoundingClientRect().right > edge + 0.5);
};

/** Keeps fitPlay current as the bar's width, its labels and the fonts change. */
export function watchPlayFit(): void {
  const bar = document.querySelector<HTMLElement>('.topbar');
  const row = bar?.querySelector('.top-actions');
  if (!bar || !row) return;
  // The labels change with the copy, the account (which also hides or shows
  // Book) and the film (Play's own label). fitPlay relabels Play while it
  // measures; those records are dropped rather than measured again.
  const labels = new MutationObserver((_records, observer) => {
    fitPlay(bar);
    observer.takeRecords();
  });
  labels.observe(row, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden'] });
  const refit = () => {
    fitPlay(bar);
    labels.takeRecords();
  };
  new ResizeObserver(refit).observe(bar);
  // Every font load, not just `ready`: that may have settled before the pills'
  // own face was even requested, and the fallback's widths are not Inter's.
  document.fonts.addEventListener('loadingdone', refit);
  void document.fonts.ready.then(refit);
}

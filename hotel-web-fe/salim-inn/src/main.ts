// Salim Inn · From Skyview to Stay — entry point. The page paints first: the
// chapter-1 poster behind the brand mark and progress bar (brief §3 ch. 0:
// "Poster image behind so LCP is instant"). The film's code (film.ts, ~700 kB)
// is requested only after that paint. Preloading it with the page cost the
// first 3D frame nothing measurable either way (it shares the line with the
// poster and fonts), but put 700 kB in front of the page's largest paint as
// Lighthouse models a slow phone: LCP 6.8 s preloaded, 2.9 s like this.
import './styles/main.css';
import './styles/sections.css';
import { lang, ready } from './content';
import { selectLang, type LangCode } from './content/lang';
import { applyCopy } from './applyCopy';
import { watchPlayFit } from './ui/headerFit';

// The page's copy in the visitor's language before anything else runs (the
// English static HTML stays the no-JS and crawler baseline; applyCopy.ts).
// A language other than English is its own small chunk, fetched first.
const copied = ready.then((ok) => {
  if (ok) applyCopy();
});
const picker = document.getElementById('langPicker') as HTMLSelectElement | null;
if (picker) {
  picker.value = lang;
  picker.addEventListener('change', () => selectLang(picker.value as LangCode));
}
// Play film in the top bar only while its row has room (ui/headerFit.ts)
watchPlayFit();

let started = false;
const start = () => {
  if (started) return;
  started = true;
  copied.then(() => import('./film')).catch((err: unknown) => {
    // no film (offline mid-load, a blocked chunk): the poster and the page's
    // own sections stay, and the preloader steps aside
    console.error(err);
    document.getElementById('preloader')?.classList.add('is-done');
  });
};
// after the first contentful paint has been presented (the paint entry is
// timed at presentation; a frame callback runs before it): the next task
try {
  new PerformanceObserver((list, observer) => {
    if (!list.getEntriesByName('first-contentful-paint').length) return;
    observer.disconnect();
    setTimeout(start, 0);
  }).observe({ type: 'paint', buffered: true });
} catch {
  requestAnimationFrame(() => setTimeout(start, 0)); // no paint timing
}
setTimeout(start, 1500); // never wait longer than this

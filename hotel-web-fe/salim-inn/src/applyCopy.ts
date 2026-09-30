// Applies the resolved bundle to the static HTML at boot. English remains the
// no-JS/SEO baseline in index.html; this pass swaps in the active locale and
// fixes <html lang>, the title and the meta description. Elements carrying
// `data-i18n-html` are set via innerHTML because their authored copy contains
// markup (<br>, <em>, links); `data-i18n-alt`/`data-i18n-aria` write the alt
// and aria-label attributes. Unknown paths are skipped, leaving the English
// text in place.
import { copy, copyAt, lang } from './content';
import { HTML_LANG } from './content/lang';

const at = (path: string | undefined): string | undefined => {
  const value = path ? copyAt(path) : undefined;
  return typeof value === 'string' ? value : undefined;
};

export const applyCopy = (): void => {
  document.documentElement.lang = HTML_LANG[lang];
  document.title = copy.meta.title;
  document
    .querySelector('meta[name="description"]')
    ?.setAttribute('content', copy.meta.description);

  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const v = at(el.dataset.i18n);
    if (v !== undefined) el.textContent = v;
  }
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n-html]')) {
    const v = at(el.dataset.i18nHtml);
    if (v !== undefined) el.innerHTML = v;
  }
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n-alt]')) {
    const v = at(el.dataset.i18nAlt);
    if (v !== undefined) el.setAttribute('alt', v);
  }
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n-aria]')) {
    const v = at(el.dataset.i18nAria);
    if (v !== undefined) el.setAttribute('aria-label', v);
  }
};

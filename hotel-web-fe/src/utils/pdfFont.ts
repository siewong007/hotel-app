/**
 * CJK-capable font embedding for jsPDF exports.
 *
 * jsPDF's built-in `helvetica` only covers Latin-1 — Chinese audit fields
 * (guest names, localized labels) would render as mojibake. When the active
 * locale is `zh` or `zh-TW`, `preparePdfDocument` embeds Noto Sans CJK SC
 * (SIL OFL — see `src/assets/fonts/LICENSE-NotoSansCJKsc.txt`) and reports the
 * font name to draw with; every other locale keeps `helvetica` and pays
 * nothing — the ~16 MB font asset is fetched lazily, only on a Chinese export.
 *
 * jsPDF embeds TrueType glyf fonts; the committed asset was converted from the
 * upstream CFF OTF (fontTools otf2ttf recipe) and must be registered per
 * document via `addFileToVFS` + `addFont`.
 */

import type { jsPDF } from 'jspdf';
import { getActiveLocale, type LocaleCode } from '../i18n';
import cjkFontUrl from '../assets/fonts/NotoSansCJKsc-Regular.ttf?url';

export const PDF_CJK_FONT = 'NotoSansCJKsc';
export const PDF_LATIN_FONT = 'helvetica';

/** Locales whose text the built-in Latin-1 fonts cannot render. */
export const localeNeedsCjkFont = (locale: LocaleCode): boolean =>
  locale === 'zh' || locale === 'zh-TW';

let fontBase64Promise: Promise<string> | null = null;

const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
};

const loadFontBase64 = (): Promise<string> => {
  // `?url` gives a root-relative path; fetch needs it absolute outside a
  // browser-served context (jsdom tests, the Tauri webview's custom scheme).
  const fontUrl = new URL(cjkFontUrl, document.baseURI).href;
  fontBase64Promise ??= fetch(fontUrl)
    .then((response) => {
      if (!response.ok) throw new Error(`Font fetch failed: ${response.status}`);
      return response.arrayBuffer();
    })
    .then(arrayBufferToBase64)
    .catch((error) => {
      // A failed fetch must not poison the cache — the next export retries.
      fontBase64Promise = null;
      throw error;
    });
  return fontBase64Promise;
};

/** Test hook — clears the memoized font download between cases. */
export const resetPdfFontCacheForTests = (): void => {
  fontBase64Promise = null;
};

/**
 * Register the CJK font on `doc` when `locale` needs it. Returns the font name
 * to draw text with — `NotoSansCJKsc` for Chinese, `helvetica` otherwise.
 * Noto has no bold face registered here, so callers should not rely on a bold
 * style for CJK output; Latin documents keep helvetica's real bold.
 */
export const preparePdfDocument = async (
  doc: jsPDF,
  locale: LocaleCode = getActiveLocale()
): Promise<string> => {
  if (!localeNeedsCjkFont(locale)) return PDF_LATIN_FONT;
  const base64 = await loadFontBase64();
  doc.addFileToVFS(`${PDF_CJK_FONT}-Regular.ttf`, base64);
  doc.addFont(`${PDF_CJK_FONT}-Regular.ttf`, PDF_CJK_FONT, 'normal');
  return PDF_CJK_FONT;
};

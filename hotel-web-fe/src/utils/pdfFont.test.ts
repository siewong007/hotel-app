import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  localeNeedsCjkFont,
  preparePdfDocument,
  resetPdfFontCacheForTests,
  PDF_CJK_FONT,
  PDF_LATIN_FONT,
} from './pdfFont';

const fakeDoc = () => ({
  addFileToVFS: vi.fn(),
  addFont: vi.fn(),
});

const mockFontFetch = () =>
  vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(new Uint8Array([1, 2, 3]).buffer, { status: 200 }));

describe('pdfFont', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetPdfFontCacheForTests();
  });

  it('marks zh and zh-TW as needing the embedded font', () => {
    expect(localeNeedsCjkFont('zh')).toBe(true);
    expect(localeNeedsCjkFont('zh-TW')).toBe(true);
    expect(localeNeedsCjkFont('en')).toBe(false);
    expect(localeNeedsCjkFont('ms')).toBe(false);
  });

  it('keeps helvetica for Latin locales without fetching the font', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const doc = fakeDoc();

    await expect(preparePdfDocument(doc as never, 'en')).resolves.toBe(PDF_LATIN_FONT);
    await expect(preparePdfDocument(doc as never, 'ms')).resolves.toBe(PDF_LATIN_FONT);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(doc.addFileToVFS).not.toHaveBeenCalled();
    expect(doc.addFont).not.toHaveBeenCalled();
  });

  it('fetches and registers the CJK font for zh once per document', async () => {
    const fetchSpy = mockFontFetch();
    const doc = fakeDoc();

    const font = await preparePdfDocument(doc as never, 'zh');

    expect(font).toBe(PDF_CJK_FONT);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(doc.addFileToVFS).toHaveBeenCalledWith(
      `${PDF_CJK_FONT}-Regular.ttf`,
      expect.any(String)
    );
    expect(doc.addFont).toHaveBeenCalledWith(
      `${PDF_CJK_FONT}-Regular.ttf`,
      PDF_CJK_FONT,
      'normal'
    );
  });

  it('reuses the downloaded font bytes across documents', async () => {
    const fetchSpy = mockFontFetch();

    await preparePdfDocument(fakeDoc() as never, 'zh');
    await preparePdfDocument(fakeDoc() as never, 'zh-TW');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failed fetch — the next export retries', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(new Response(new Uint8Array([1]).buffer, { status: 200 }));

    await expect(preparePdfDocument(fakeDoc() as never, 'zh')).rejects.toThrow('offline');
    await expect(preparePdfDocument(fakeDoc() as never, 'zh')).resolves.toBe(PDF_CJK_FONT);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

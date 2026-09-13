import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetLocaleStoreForTests } from '../../../i18n/localeStore';
import { getHotelSettings, saveHotelSettings } from '../../../utils/hotelSettings';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  legalDocuments: vi.fn(),
}));

vi.mock('../../../router', () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock('../content', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../content')>();
  return {
    ...actual,
    // Test seam: lets a suite pin a stub LegalDocument instead of depending on
    // which sections the real content files happen to flag. Falls through to
    // the real documents unless a test configures the mock.
    getLegalDocuments: () => mocks.legalDocuments() ?? actual.getLegalDocuments(),
  };
});

import { LegalDocumentPage } from './LegalDocumentPage';
import type { LegalDocument } from '../content';

describe('LegalDocumentPage return control', () => {
  beforeEach(() => {
    mocks.navigate.mockReset();
    resetLocaleStoreForTests();
    vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    Object.defineProperty(document, 'referrer', { configurable: true, value: '' });
  });

  it('shows a Back control on every legal document', () => {
    render(<LegalDocumentPage documentId="terms_of_service" />);

    expect(screen.getAllByRole('button', { name: 'Back' }).length).toBeGreaterThan(0);
  });

  it('returns to the previous same-origin page when there is one', () => {
    Object.defineProperty(document, 'referrer', {
      configurable: true,
      value: `${window.location.origin}/register`,
    });

    render(<LegalDocumentPage documentId="privacy_notice" />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Back' })[0]);

    expect(window.history.back).toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('goes to the hotel home when the page was opened with no in-app history', () => {
    Object.defineProperty(document, 'referrer', { configurable: true, value: '' });

    render(<LegalDocumentPage documentId="payment_terms" />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Back' })[0]);

    expect(window.history.back).not.toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledWith('/');
  });
});

describe('LegalDocumentPage business registration number', () => {
  beforeEach(() => {
    resetLocaleStoreForTests();
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('discloses the configured number in the booking terms', () => {
    saveHotelSettings({ ...getHotelSettings(), hotel_business_number: 'SA5551234' });

    render(<LegalDocumentPage documentId="terms_of_service" />);

    expect(screen.getByText(/SA5551234/)).toBeTruthy();
  });

  // The boot-time `settings/public` fetch can land after this page has mounted.
  // If the document were resolved once at module import, the reader would be
  // left on the compiled-in fallback for the life of the tab.
  it('picks up a number that arrives after mount', () => {
    render(<LegalDocumentPage documentId="terms_of_service" />);
    expect(screen.getByText(/SA2012724/)).toBeTruthy();

    const settings = { ...getHotelSettings(), hotel_business_number: 'SA7770001' };
    saveHotelSettings(settings);
    act(() => {
      window.dispatchEvent(new CustomEvent('hotelSettingsChange', { detail: settings }));
    });

    expect(screen.getByText(/SA7770001/)).toBeTruthy();
    expect(screen.queryByText(/SA2012724/)).toBeNull();
  });
});

// A minimal document with one of each section shape — plain numbered,
// 'requirement' callout, 'info' callout, and an unnumbered annex — so the
// rendering contract is pinned without depending on which sections the real
// content files flag today.
const STUB_DOCUMENT: LegalDocument = {
  id: 'terms_of_service',
  version: '0.0-test',
  effectiveDate: '2026-09-13',
  title: { en: 'Stub Terms', ms: 'Terma Stub' },
  summary: { en: 'A short stub summary.', ms: 'Ringkasan stub pendek.' },
  sections: [
    {
      id: 'alpha',
      heading: { en: '1. Plain section heading', ms: '1. Tajuk bahagian biasa' },
      body: [{ en: 'Alpha body text.', ms: 'Teks badan alfa.' }],
    },
    {
      id: 'beta',
      heading: { en: '2. Obligations section heading', ms: '2. Tajuk bahagian kewajipan' },
      emphasis: 'requirement',
      body: [{ en: 'Beta body text.', ms: 'Teks badan beta.' }],
    },
    {
      id: 'gamma',
      heading: { en: '3. Context section heading', ms: '3. Tajuk bahagian konteks' },
      emphasis: 'info',
      bullets: [{ en: 'Gamma bullet text.', ms: 'Teks bullet gama.' }],
    },
    {
      id: 'unnumbered',
      heading: { en: 'Annex without a numeral', ms: 'Lampiran tanpa nombor' },
      body: [{ en: 'Annex body text.', ms: 'Teks badan lampiran.' }],
    },
  ],
};

const sectionElement = (id: string): HTMLElement => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`expected a <section id="${id}"> in the rendered page`);
  return element;
};

describe('LegalDocumentPage reading experience', () => {
  beforeEach(() => {
    mocks.navigate.mockReset();
    resetLocaleStoreForTests();
    mocks.legalDocuments.mockReturnValue({ terms_of_service: STUB_DOCUMENT });
    // The language toggle persists the choice through the storage wrapper —
    // jsdom here has no `localStorage` global, so give it a Map-backed one.
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
    });
  });

  afterEach(() => {
    cleanup();
    mocks.legalDocuments.mockReset();
    vi.unstubAllGlobals();
  });

  it('splits the leading numeral out of a numbered section heading', () => {
    render(<LegalDocumentPage documentId="terms_of_service" />);

    const heading = screen.getByRole('heading', { name: /Obligations section heading/ });
    // The numeral renders as its own inline element so the page can style it
    // in gold serif while the rest of the heading stays plain ink.
    const numeral = within(heading).getByText('2.');
    expect(numeral.tagName).toBe('SPAN');
    expect(heading.textContent).toBe('2.Obligations section heading');

    // A heading with no leading numeral renders as plain text — no empty span.
    const annex = screen.getByRole('heading', { name: 'Annex without a numeral' });
    expect(annex.childElementCount).toBe(0);
  });

  it('links every contents entry to its section anchor', () => {
    render(<LegalDocumentPage documentId="terms_of_service" />);

    const nav = screen.getByRole('navigation', { name: 'Document contents' });
    // The rail is an ordered list: the ::marker supplies the number, so each
    // link's text is the heading with its own numeral stripped.
    expect(within(nav).getByRole('list').tagName).toBe('OL');
    expect(within(nav).getAllByRole('listitem')).toHaveLength(STUB_DOCUMENT.sections.length);
    for (const section of STUB_DOCUMENT.sections) {
      const linkText = section.heading.en.replace(/^\d+\.\s*/, '');
      const link = within(nav).getByRole('link', { name: linkText });
      expect(link.getAttribute('href')).toBe(`#${section.id}`);
      expect(sectionElement(section.id)).toBeTruthy();
    }
  });

  it('renders a labelled callout for each section flagged with an emphasis', () => {
    render(<LegalDocumentPage documentId="terms_of_service" />);

    const requirement = sectionElement('beta');
    expect(within(requirement).getByText('Important')).toBeTruthy();
    expect(within(requirement).getByTestId('GavelOutlinedIcon')).toBeTruthy();
    expect(within(requirement).getByText('Beta body text.')).toBeTruthy();

    const info = sectionElement('gamma');
    expect(within(info).getByText('Good to know')).toBeTruthy();
    expect(within(info).getByTestId('InfoOutlinedIcon')).toBeTruthy();
    expect(within(info).getByText('Gamma bullet text.')).toBeTruthy();

    // Unflagged sections stay plain prose — no callout caption leaks in.
    for (const plainId of ['alpha', 'unnumbered']) {
      const plain = sectionElement(plainId);
      expect(within(plain).queryByText('Important')).toBeNull();
      expect(within(plain).queryByText('Good to know')).toBeNull();
    }
    expect(screen.getAllByText('Important')).toHaveLength(1);
    expect(screen.getAllByText('Good to know')).toHaveLength(1);
  });

  it('localizes the callout captions and prose with the language toggle', () => {
    render(<LegalDocumentPage documentId="terms_of_service" />);

    fireEvent.click(screen.getByRole('button', { name: 'Bahasa Malaysia' }));

    expect(screen.getByText('Perkara penting')).toBeTruthy();
    expect(screen.getByText('Baik untuk diketahui')).toBeTruthy();
    expect(screen.queryByText('Important')).toBeNull();
    expect(screen.getByText('Teks badan beta.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Tajuk bahagian kewajipan/ })).toBeTruthy();
  });

  it('stamps the active language on the page element and swaps it on toggle', () => {
    const { container } = render(<LegalDocumentPage documentId="terms_of_service" />);
    const page = container.firstElementChild;
    if (!page) throw new Error('expected the page container to render');

    // `lang` must live on the page because the toggle swaps the prose
    // client-side — a screen reader keys pronunciation off it.
    expect(page.getAttribute('lang')).toBe('en');
    expect(screen.getByRole('group', { name: 'Document language' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Bahasa Malaysia' }));
    expect(page.getAttribute('lang')).toBe('ms');
    expect(screen.getByRole('group', { name: 'Bahasa dokumen' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Terma Stub' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'English' }));
    expect(page.getAttribute('lang')).toBe('en');
    expect(screen.getByRole('heading', { name: 'Stub Terms' })).toBeTruthy();
  });

  it('closes with the contact callout for questions about the document', () => {
    render(<LegalDocumentPage documentId="terms_of_service" />);

    expect(screen.getByText('Questions about this document?')).toBeTruthy();
    const email = screen.getByRole('link', { name: 'saliminnsibu@gmail.com' });
    expect(email.getAttribute('href')).toBe('mailto:saliminnsibu@gmail.com');
  });
});

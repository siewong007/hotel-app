import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetLocaleStoreForTests } from '../../../i18n/localeStore';
import { getHotelSettings, saveHotelSettings } from '../../../utils/hotelSettings';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
}));

vi.mock('../../../router', () => ({
  useNavigate: () => mocks.navigate,
}));

import { LegalDocumentPage } from './LegalDocumentPage';

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

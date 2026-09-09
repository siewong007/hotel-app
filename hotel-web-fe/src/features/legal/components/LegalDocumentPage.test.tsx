import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetLocaleStoreForTests } from '../../../i18n/localeStore';

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

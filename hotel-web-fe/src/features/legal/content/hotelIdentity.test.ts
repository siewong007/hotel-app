import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getHotelSettings, saveHotelSettings } from '../../../utils/hotelSettings';
import { HOTEL_LEGAL_IDENTITY, getHotelLegalIdentity } from './hotelIdentity';
import { buildTermsOfService } from './termsOfService';

function createLocalStorageStub() {
  const store = new Map<string, string>();
  return {
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
  };
}

const storeBusinessNumber = (value: string) =>
  saveHotelSettings({ ...getHotelSettings(), hotel_business_number: value });

describe('getHotelLegalIdentity', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createLocalStorageStub());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("falls back to the hotel's own SSM number when nothing is configured", () => {
    expect(getHotelLegalIdentity().companyRegistrationNumber).toBe('SA2012724');
    expect(HOTEL_LEGAL_IDENTITY.companyRegistrationNumber).toBe('SA2012724');
  });

  it('uses the configured business number over the compiled-in one', () => {
    storeBusinessNumber('SA9998887');

    expect(getHotelLegalIdentity().companyRegistrationNumber).toBe('SA9998887');
  });

  // A blank row would otherwise delete a disclosure the Electronic Commerce Act
  // requires, so it has to read as "not configured" rather than as an override.
  it('ignores a blank or whitespace-only setting', () => {
    storeBusinessNumber('   ');

    expect(getHotelLegalIdentity().companyRegistrationNumber).toBe('SA2012724');
  });

  it('leaves the rest of the legal identity alone', () => {
    storeBusinessNumber('SA9998887');
    const identity = getHotelLegalIdentity();

    expect(identity.registeredName).toBe(HOTEL_LEGAL_IDENTITY.registeredName);
    expect(identity.addressLines).toEqual(HOTEL_LEGAL_IDENTITY.addressLines);
    expect(identity.email).toBe(HOTEL_LEGAL_IDENTITY.email);
  });
});

describe('buildTermsOfService', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createLocalStorageStub());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const partiesText = (locale: 'en' | 'ms', number: string) => {
    const document = buildTermsOfService({
      ...HOTEL_LEGAL_IDENTITY,
      companyRegistrationNumber: number,
    });
    const parties = document.sections.find((section) => section.id === 'parties');
    return parties?.body?.[0][locale] ?? '';
  };

  // PDPA s.7(2) requires both languages, so a number that reaches only the
  // English clause is still a compliance gap.
  it('discloses the supplied number in both languages', () => {
    expect(partiesText('en', 'SA9998887')).toContain('SA9998887');
    expect(partiesText('ms', 'SA9998887')).toContain('SA9998887');
  });

  it('defaults to the compiled-in identity when none is passed', () => {
    const parties = buildTermsOfService().sections.find((section) => section.id === 'parties');

    expect(parties?.body?.[0].en).toContain('SA2012724');
  });

  it('never renders the placeholder the number replaced', () => {
    const document = buildTermsOfService(getHotelLegalIdentity());
    const rendered = JSON.stringify(document);

    expect(rendered).not.toContain('REGISTRATION-NUMBER-PENDING');
  });
});

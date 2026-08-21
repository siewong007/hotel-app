import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CustomerLedger } from '../../../../types';
import type { HotelSettings } from '../../../../utils/hotelSettings';
import { printCompanyStatement, printSingleReceipt } from './customerLedgerPrint';

const hotelSettings = {
  hotel_name: 'Grand Hotel',
  hotel_address: '123 Main Street',
  hotel_phone: '+60-1-234-5678',
  hotel_email: 'info@grand.test',
} as HotelSettings;

function buildLedger(overrides: Partial<CustomerLedger> = {}): CustomerLedger {
  return {
    id: 1,
    company_name: 'Acme Corp',
    description: 'Room charge',
    expense_type: 'accommodation',
    amount: 300,
    status: 'pending',
    paid_amount: 0,
    balance_due: 300,
    created_at: '2031-04-10T00:00:00Z',
    updated_at: '2031-04-10T00:00:00Z',
    ...overrides,
  } as CustomerLedger;
}

function capturePrintHtml(): string[] {
  const writes: string[] = [];
  const frameDocument = {
    open: vi.fn(),
    write: vi.fn((html: string) => writes.push(html)),
    close: vi.fn(),
  };
  const iframe = {
    style: {},
    contentWindow: { document: frameDocument, print: vi.fn() },
  } as unknown as HTMLIFrameElement;
  const createElement = document.createElement.bind(document);

  vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
    return tagName.toLowerCase() === 'iframe' ? iframe : createElement(tagName);
  }) as typeof document.createElement);
  vi.spyOn(document.body, 'appendChild').mockImplementation((node) => node);
  vi.spyOn(document.body, 'removeChild').mockImplementation((node) => node);

  return writes;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('customer ledger printable stay dates', () => {
  it('prints check-in and check-out columns with a dash for standalone entries', () => {
    const html = capturePrintHtml();

    printCompanyStatement({
      companyName: 'Acme Corp',
      ledgers: [
        buildLedger({
          check_in_date: '2031-04-10',
          check_out_date: '2031-04-13',
        }),
        buildLedger({ id: 2, description: 'Manual charge' }),
      ],
      hotelSettings,
      formatCurrency: (value) => `$${value.toFixed(2)}`,
      onEmpty: () => undefined,
    });

    expect(html).toHaveLength(1);
    expect(html[0]).toContain('Check-in');
    expect(html[0]).toContain('Check-out');
    expect(html[0]).toContain('Apr 10, 2031');
    expect(html[0]).toContain('Apr 13, 2031');
    expect(html[0]).toContain('-');
  });

  it('prints check-in and check-out details on payment receipts', () => {
    const html = capturePrintHtml();

    printSingleReceipt({
      entry: buildLedger({
        check_in_date: '2031-04-10',
        check_out_date: '2031-04-13',
      }),
      hotelSettings,
      formatCurrency: (value) => `$${value.toFixed(2)}`,
    });

    expect(html).toHaveLength(1);
    expect(html[0]).toContain('Check-in Date');
    expect(html[0]).toContain('Check-out Date');
    expect(html[0]).toContain('Apr 10, 2031');
    expect(html[0]).toContain('Apr 13, 2031');
  });
});

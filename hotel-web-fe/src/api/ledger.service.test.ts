import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the configured ky instance so no real HTTP happens.
const get = vi.fn();
const post = vi.fn();
const patch = vi.fn();
const del = vi.fn();
vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return {
    ...actual,
    api: {
      get: (...args: any[]) => get(...args),
      post: (...args: any[]) => post(...args),
      patch: (...args: any[]) => patch(...args),
      delete: (...args: any[]) => del(...args),
    },
  };
});

import { LedgerService } from './ledger.service';
import type { CustomerLedger } from '../types';

function mockJsonResponse(payload: unknown) {
  return { json: () => Promise.resolve(payload) };
}

function buildLedger(overrides: Partial<CustomerLedger> = {}): CustomerLedger {
  return {
    id: 1,
    company_name: 'Acme Corp',
    description: 'Room charge',
    expense_type: 'room',
    amount: 100,
    status: 'pending',
    paid_amount: 0,
    balance_due: 100,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    ...overrides,
  };
}

describe('LedgerService', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    patch.mockReset();
    del.mockReset();
  });

  describe('getCustomerLedgers', () => {
    it('fetches page 1 at page_size 500 and returns it directly when total fits', async () => {
      const ledgers = [buildLedger()];
      get.mockReturnValue(mockJsonResponse({ data: ledgers, total: 1 }));

      const result = await LedgerService.getCustomerLedgers();

      expect(get).toHaveBeenCalledTimes(1);
      expect(get).toHaveBeenCalledWith('ledgers', { searchParams: { page: '1', page_size: '500' } });
      expect(result).toEqual(ledgers);
    });

    it('forwards every provided filter as a string search param', async () => {
      get.mockReturnValue(mockJsonResponse({ data: [], total: 0 }));

      await LedgerService.getCustomerLedgers({
        status: 'paid',
        company_name: 'Acme',
        expense_type: 'room',
        folio_type: 'city_ledger',
        post_type: 'room_charge',
        department_code: 'FO',
        room_number: '101',
      });

      expect(get).toHaveBeenCalledWith('ledgers', {
        searchParams: {
          page: '1',
          page_size: '500',
          status: 'paid',
          company_name: 'Acme',
          expense_type: 'room',
          folio_type: 'city_ledger',
          post_type: 'room_charge',
          department_code: 'FO',
          room_number: '101',
        },
      });
    });

    it('fetches remaining pages in parallel and concatenates results when total exceeds the page size', async () => {
      const page1 = Array.from({ length: 500 }, (_, i) => buildLedger({ id: i + 1 }));
      const page2 = [buildLedger({ id: 501 })];
      get.mockImplementation((_url: string, opts: any) => {
        const page = opts?.searchParams?.page ?? '1';
        if (page === '1') return mockJsonResponse({ data: page1, total: 501 });
        return mockJsonResponse({ data: page2, total: 501 });
      });

      const result = await LedgerService.getCustomerLedgers();

      expect(get).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(501);
      expect(result[500]).toEqual(buildLedger({ id: 501 }));
    });
  });

  describe('getLedgersPage', () => {
    it('uses page 1 / page_size 50 defaults when no params are given', async () => {
      get.mockReturnValue(mockJsonResponse({ data: [], total: 0 }));

      await LedgerService.getLedgersPage();

      expect(get).toHaveBeenCalledWith('ledgers', { searchParams: { page: '1', page_size: '50' } });
    });

    it('forwards every filter including invoice_state/balance_state/ui_status/sort', async () => {
      get.mockReturnValue(mockJsonResponse({ data: [], total: 0 }));

      await LedgerService.getLedgersPage({
        page: 2,
        page_size: 20,
        search: 'acme',
        status: 'paid',
        invoice_state: 'invoiced',
        balance_state: 'outstanding',
        ui_status: 'partial',
        sort_by: 'created_at',
        sort_order: 'desc',
      });

      expect(get).toHaveBeenCalledWith('ledgers', {
        searchParams: {
          page: '2',
          page_size: '20',
          search: 'acme',
          status: 'paid',
          invoice_state: 'invoiced',
          balance_state: 'outstanding',
          ui_status: 'partial',
          sort_by: 'created_at',
          sort_order: 'desc',
        },
      });
    });

    it('defaults total/page/page_size from the returned data when the response is a bare array', async () => {
      const ledgers = [buildLedger()];
      get.mockReturnValue(mockJsonResponse(ledgers));

      const result = await LedgerService.getLedgersPage();

      expect(result).toEqual({ data: ledgers, total: 1, page: 1, page_size: 50 });
    });
  });

  describe('getCustomerLedger', () => {
    it('calls GET ledgers/<id>', async () => {
      const ledger = buildLedger({ id: 9 });
      get.mockReturnValue(mockJsonResponse(ledger));

      const result = await LedgerService.getCustomerLedger(9);

      expect(get).toHaveBeenCalledWith('ledgers/9');
      expect(result).toEqual(ledger);
    });
  });

  describe('getCustomerLedgerWithPayments', () => {
    it('calls GET ledgers/<id>/with-payments', async () => {
      const response = { ledger: buildLedger(), payments: [] };
      get.mockReturnValue(mockJsonResponse(response));

      const result = await LedgerService.getCustomerLedgerWithPayments(9);

      expect(get).toHaveBeenCalledWith('ledgers/9/with-payments');
      expect(result).toEqual(response);
    });
  });

  describe('getRoomChargeLedgerForBooking', () => {
    it('queries with post_type=room_charge and room_number, and returns the matching non-reversal ledger', async () => {
      const match = buildLedger({ id: 5, booking_id: 100, is_reversal: false } as Partial<CustomerLedger>);
      const reversal = buildLedger({ id: 6, booking_id: 100, is_reversal: true } as Partial<CustomerLedger>);
      get.mockReturnValue(mockJsonResponse({ data: [reversal, match], total: 2 }));

      const result = await LedgerService.getRoomChargeLedgerForBooking(100, '101');

      expect(get).toHaveBeenCalledWith('ledgers', {
        searchParams: { page: '1', page_size: '500', post_type: 'room_charge', room_number: '101' },
      });
      expect(result).toEqual(match);
    });

    it('omits room_number from the query when not provided', async () => {
      get.mockReturnValue(mockJsonResponse({ data: [], total: 0 }));

      await LedgerService.getRoomChargeLedgerForBooking(100);

      expect(get).toHaveBeenCalledWith('ledgers', {
        searchParams: { page: '1', page_size: '500', post_type: 'room_charge' },
      });
    });

    it('returns null when no non-reversal ledger matches the booking', async () => {
      get.mockReturnValue(mockJsonResponse({ data: [], total: 0 }));

      const result = await LedgerService.getRoomChargeLedgerForBooking(100);

      expect(result).toBeNull();
    });
  });

  describe('createCustomerLedger', () => {
    it('posts the input as json to ledgers', async () => {
      const input = { company_name: 'Acme', description: 'Room charge', expense_type: 'room', amount: 100 };
      const created = buildLedger();
      post.mockReturnValue(mockJsonResponse(created));

      const result = await LedgerService.createCustomerLedger(input);

      expect(post).toHaveBeenCalledWith('ledgers', { json: input });
      expect(result).toEqual(created);
    });
  });

  describe('updateCustomerLedger', () => {
    it('patches ledgers/<id> with the input as json', async () => {
      const updated = buildLedger({ id: 3, status: 'paid' });
      patch.mockReturnValue(mockJsonResponse(updated));

      const result = await LedgerService.updateCustomerLedger(3, { status: 'paid' });

      expect(patch).toHaveBeenCalledWith('ledgers/3', { json: { status: 'paid' } });
      expect(result).toEqual(updated);
    });
  });

  describe('deleteCustomerLedger', () => {
    it('calls DELETE ledgers/<id> and unwraps the json result', async () => {
      del.mockReturnValue(mockJsonResponse({ message: 'deleted', ledger_id: 3 }));

      const result = await LedgerService.deleteCustomerLedger(3);

      expect(del).toHaveBeenCalledWith('ledgers/3');
      expect(result).toEqual({ message: 'deleted', ledger_id: 3 });
    });
  });

  describe('getCustomerLedgerSummary', () => {
    it('calls GET ledgers/summary', async () => {
      const summary = { total_entries: 1, total_amount: 100, total_paid: 0, total_outstanding: 100, pending_count: 1, partial_count: 0, overdue_count: 0 };
      get.mockReturnValue(mockJsonResponse(summary));

      const result = await LedgerService.getCustomerLedgerSummary();

      expect(get).toHaveBeenCalledWith('ledgers/summary');
      expect(result).toEqual(summary);
    });
  });

  describe('getLedgerPayments', () => {
    it('calls GET ledgers/<id>/payments', async () => {
      const payments = [{ id: 1, ledger_id: 9, payment_amount: 50, payment_method: 'cash', payment_date: '2026-07-01', created_at: '2026-07-01T00:00:00Z' }];
      get.mockReturnValue(mockJsonResponse(payments));

      const result = await LedgerService.getLedgerPayments(9);

      expect(get).toHaveBeenCalledWith('ledgers/9/payments');
      expect(result).toEqual(payments);
    });
  });

  describe('createLedgerPayment', () => {
    it('posts the payment input as json to ledgers/<id>/payments', async () => {
      const input = { payment_amount: 50, payment_method: 'cash', idempotency_key: 'ledger-payment-attempt-1' };
      const created = { id: 1, ledger_id: 9, payment_amount: 50, payment_method: 'cash', payment_date: '2026-07-01', created_at: '2026-07-01T00:00:00Z' };
      post.mockReturnValue(mockJsonResponse(created));

      const result = await LedgerService.createLedgerPayment(9, input);

      expect(post).toHaveBeenCalledWith('ledgers/9/payments', { json: input });
      expect(result).toEqual(created);
    });
  });

  describe('createCompanyLedgerPayment', () => {
    it('posts one ordered atomic company payment request', async () => {
      const input = {
        ledger_ids: [12, 9],
        payment_amount: 125,
        payment_method: 'bank_transfer',
        payment_reference: 'bank-77',
        receipt_number: 'receipt-77',
        notes: 'August settlement',
        payment_date: '2026-08-06',
        idempotency_key: 'company-payment-attempt-1',
      };
      const response = { payments: [], payment_amount: 125 };
      post.mockReturnValue(mockJsonResponse(response));

      const result = await LedgerService.createCompanyLedgerPayment(input);

      expect(post).toHaveBeenCalledTimes(1);
      expect(post).toHaveBeenCalledWith('ledgers/company-payments', { json: input });
      expect(result).toEqual(response);
    });
  });

  describe('updateLedgerPaymentDate', () => {
    it('patches ledgers/<id>/payments/<id> with only payment_date', async () => {
      const updated = { id: 1, ledger_id: 9, payment_amount: 50, payment_method: 'cash', payment_date: '2026-07-02', created_at: '2026-07-01T00:00:00Z' };
      patch.mockReturnValue(mockJsonResponse(updated));

      const result = await LedgerService.updateLedgerPaymentDate(9, 1, '2026-07-02');

      expect(patch).toHaveBeenCalledWith('ledgers/9/payments/1', { json: { payment_date: '2026-07-02' } });
      expect(result).toEqual(updated);
    });
  });

  describe('updateLedgerPayment', () => {
    it('patches ledgers/<id>/payments/<id> with the full edit payload as json', async () => {
      const input = { payment_date: '2026-07-02', payment_amount: 75, payment_method: 'card', notes: 'corrected' };
      const updated = { id: 1, ledger_id: 9, payment_amount: 75, payment_method: 'card', payment_date: '2026-07-02', created_at: '2026-07-01T00:00:00Z' };
      patch.mockReturnValue(mockJsonResponse(updated));

      const result = await LedgerService.updateLedgerPayment(9, 1, input);

      expect(patch).toHaveBeenCalledWith('ledgers/9/payments/1', { json: input });
      expect(result).toEqual(updated);
    });
  });

  describe('deleteLedgerPayment', () => {
    it('calls DELETE ledgers/<id>/payments/<id>', async () => {
      del.mockReturnValue(mockJsonResponse(undefined));

      await LedgerService.deleteLedgerPayment(9, 1);

      expect(del).toHaveBeenCalledWith('ledgers/9/payments/1');
    });
  });

  describe('voidLedger', () => {
    it('posts the void reason as json to ledgers/<id>/void', async () => {
      const voided = buildLedger({ id: 9, status: 'void' });
      post.mockReturnValue(mockJsonResponse(voided));

      const result = await LedgerService.voidLedger(9, { reason: 'duplicate entry' });

      expect(post).toHaveBeenCalledWith('ledgers/9/void', { json: { reason: 'duplicate entry' } });
      expect(result).toEqual(voided);
    });
  });

  describe('reverseLedger', () => {
    it('posts the reversal reason and notes as json to ledgers/<id>/reverse', async () => {
      const reversed = buildLedger({ id: 10, is_reversal: true } as Partial<CustomerLedger>);
      post.mockReturnValue(mockJsonResponse(reversed));

      const result = await LedgerService.reverseLedger(9, { reason: 'incorrect amount', notes: 'see ticket 42' });

      expect(post).toHaveBeenCalledWith('ledgers/9/reverse', { json: { reason: 'incorrect amount', notes: 'see ticket 42' } });
      expect(result).toEqual(reversed);
    });
  });
});

import { api } from './client';
import {
  CustomerLedger,
  CustomerLedgerCreateRequest,
  CustomerLedgerUpdateRequest,
  CustomerLedgerPayment,
  CustomerLedgerPaymentRequest,
  CustomerLedgerWithPayments,
  CustomerLedgerSummary,
  PatTransactionCode,
  PatDepartmentCode,
  LedgerVoidRequest,
  LedgerReversalRequest,
} from '../types';
import { withRetry } from '../utils/retry';

export class LedgerService {
  static async getCustomerLedgers(params?: {
    status?: string;
    company_name?: string;
    expense_type?: string;
    folio_type?: string;
    post_type?: string;
    department_code?: string;
    room_number?: string;
    limit?: number;
    offset?: number;
  }): Promise<CustomerLedger[]> {
    const searchParams: Record<string, string> = {};
    if (params?.status) searchParams.status = params.status;
    if (params?.company_name) searchParams.company_name = params.company_name;
    if (params?.expense_type) searchParams.expense_type = params.expense_type;
    if (params?.folio_type) searchParams.folio_type = params.folio_type;
    if (params?.post_type) searchParams.post_type = params.post_type;
    if (params?.department_code) searchParams.department_code = params.department_code;
    if (params?.room_number) searchParams.room_number = params.room_number;
    if (params?.limit) searchParams.limit = params.limit.toString();
    if (params?.offset) searchParams.offset = params.offset.toString();

    return await withRetry(
      () => api.get('ledgers', { searchParams }).json<CustomerLedger[]>(),
      { maxAttempts: 3, initialDelay: 1000 }
    );
  }

  static async getCustomerLedger(ledgerId: number): Promise<CustomerLedger> {
    return await api.get(`ledgers/${ledgerId}`).json<CustomerLedger>();
  }

  static async getCustomerLedgerWithPayments(ledgerId: number): Promise<CustomerLedgerWithPayments> {
    return await api.get(`ledgers/${ledgerId}/with-payments`).json<CustomerLedgerWithPayments>();
  }

  static async createCustomerLedger(data: CustomerLedgerCreateRequest): Promise<CustomerLedger> {
    return await api.post('ledgers', { json: data }).json<CustomerLedger>();
  }

  static async updateCustomerLedger(ledgerId: number, data: CustomerLedgerUpdateRequest): Promise<CustomerLedger> {
    return await api.patch(`ledgers/${ledgerId}`, { json: data }).json<CustomerLedger>();
  }

  static async deleteCustomerLedger(ledgerId: number): Promise<{ message: string; ledger_id: number }> {
    return await api.delete(`ledgers/${ledgerId}`).json();
  }

  static async getCustomerLedgerSummary(): Promise<CustomerLedgerSummary> {
    return await api.get('ledgers/summary').json<CustomerLedgerSummary>();
  }

  static async getLedgerPayments(ledgerId: number): Promise<CustomerLedgerPayment[]> {
    return await api.get(`ledgers/${ledgerId}/payments`).json<CustomerLedgerPayment[]>();
  }

  static async createLedgerPayment(ledgerId: number, data: CustomerLedgerPaymentRequest): Promise<CustomerLedgerPayment> {
    return await api.post(`ledgers/${ledgerId}/payments`, { json: data }).json<CustomerLedgerPayment>();
  }

  // PAT-style methods
  static async getTransactionCodes(): Promise<PatTransactionCode[]> {
    return await withRetry(
      () => api.get('ledgers/transaction-codes').json<PatTransactionCode[]>(),
      { maxAttempts: 3, initialDelay: 1000 }
    );
  }

  static async getDepartmentCodes(): Promise<PatDepartmentCode[]> {
    return await withRetry(
      () => api.get('ledgers/department-codes').json<PatDepartmentCode[]>(),
      { maxAttempts: 3, initialDelay: 1000 }
    );
  }

  static async voidLedger(ledgerId: number, data: LedgerVoidRequest): Promise<CustomerLedger> {
    return await api.post(`ledgers/${ledgerId}/void`, { json: data }).json<CustomerLedger>();
  }

  static async reverseLedger(ledgerId: number, data: LedgerReversalRequest): Promise<CustomerLedger> {
    return await api.post(`ledgers/${ledgerId}/reverse`, { json: data }).json<CustomerLedger>();
  }
}

import { api, toApiError } from './client';
import { t } from '../i18n';
import type { PaymentWorkflowSummary } from '../types';

export class InvoicesService {
  static async getInvoicePreview(bookingId: string): Promise<any> {
    try {
      return await api.get(`invoices/preview/${bookingId}`).json<any>();
    } catch (error) {
      throw toApiError(error, t('generic', undefined, 'errors'));
    }
  }

  static async generateInvoice(bookingId: string): Promise<any> {
    try {
      return await api.post(`invoices/generate/${bookingId}`).json<any>();
    } catch (error) {
      throw toApiError(error, t('generic', undefined, 'errors'));
    }
  }

  static async recordPayment(data: {
    booking_id: number;
    amount: number;
    payment_method: string;
    payment_type?: string;
    transaction_reference?: string;
    notes?: string;
    payment_date?: string;
    idempotency_key: string;
  }): Promise<any> {
    try {
      // Ensure amount is a valid number
      const payload = {
        ...data,
        booking_id: Number(data.booking_id),
        amount: typeof data.amount === 'string' ? parseFloat(data.amount) : data.amount
      };
      return await api.post('payments/record-payment', { json: payload }).json<any>();
    } catch (error) {
      throw toApiError(error, t('generic', undefined, 'errors'));
    }
  }

  static async getBookingPayments(bookingId: string | number): Promise<any[]> {
    try {
      return await api.get(`payments/all-payments/${bookingId}`).json<any[]>();
    } catch (error) {
      throw toApiError(error, t('generic', undefined, 'errors'));
    }
  }

  static async getPaymentWorkflowSummary(bookingId: string | number): Promise<PaymentWorkflowSummary> {
    try {
      return await api.get(`payments/workflow-summary/${bookingId}`).json<PaymentWorkflowSummary>();
    } catch (error) {
      throw toApiError(error, t('generic', undefined, 'errors'));
    }
  }

  static async refundDeposit(
    bookingId: string | number,
    paymentMethod: string = 'cash',
    amount?: number,
    extras?: { transaction_reference?: string; note?: string },
  ): Promise<any> {
    try {
      // Ensure amount is a valid number
      const numericAmount = typeof amount === 'string' ? parseFloat(amount) : (amount || 0);
      const json: Record<string, unknown> = { payment_method: paymentMethod, amount: numericAmount };
      // Optional staff-supplied metadata — the backend stores the reference
      // on the refund row's transaction_id and appends the note to the
      // refund row notes. Only sent when non-empty after trim.
      const transactionReference = extras?.transaction_reference?.trim();
      if (transactionReference) json.transaction_reference = transactionReference;
      const note = extras?.note?.trim();
      if (note) json.note = note;
      return await api.post(`payments/refund-deposit/${bookingId}`, { json }).json<any>();
    } catch (error) {
      throw toApiError(error, t('generic', undefined, 'errors'));
    }
  }

  static async forfeitDeposit(bookingId: string | number, amount: number, reason: string, notes?: string): Promise<any> {
    try {
      // Ensure amount is a valid number
      const numericAmount = typeof amount === 'string' ? parseFloat(amount) : (amount || 0);
      const json: Record<string, unknown> = { amount: numericAmount, reason };
      // Optional staff notes — appended to the forfeit row's
      // 'Deposit forfeited: {reason}' text. Only sent when non-empty.
      const trimmedNotes = notes?.trim();
      if (trimmedNotes) json.notes = trimmedNotes;
      return await api.post(`payments/forfeit-deposit/${bookingId}`, { json }).json<any>();
    } catch (error) {
      throw toApiError(error, t('generic', undefined, 'errors'));
    }
  }

  static async revertDepositRefund(bookingId: string | number): Promise<any> {
    try {
      return await api.post(`payments/revert-deposit-refund/${bookingId}`).json<any>();
    } catch (error) {
      throw toApiError(error, t('generic', undefined, 'errors'));
    }
  }

  static async revertDepositVoid(bookingId: string | number): Promise<any> {
    try {
      return await api.post(`payments/revert-deposit-void/${bookingId}`).json<any>();
    } catch (error) {
      throw toApiError(error, t('generic', undefined, 'errors'));
    }
  }

  static async getUserInvoices(): Promise<any[]> {
    try {
      return await api.get('invoices').json<any[]>();
    } catch (error) {
      throw toApiError(error, t('generic', undefined, 'errors'));
    }
  }

  static async updatePayment(paymentId: number, data: {
    amount?: number;
    payment_method?: string;
    transaction_reference?: string;
    notes?: string;
    payment_date?: string;
  }): Promise<any> {
    try {
      const payload: Record<string, any> = {};
      if (data.amount !== undefined) {
        payload.amount = typeof data.amount === 'string' ? parseFloat(data.amount) : data.amount;
      }
      if (data.payment_method !== undefined) payload.payment_method = data.payment_method;
      if (data.transaction_reference !== undefined) payload.transaction_reference = data.transaction_reference;
      if (data.notes !== undefined) payload.notes = data.notes;
      if (data.payment_date !== undefined) payload.payment_date = data.payment_date;

      return await api.patch(`payments/${paymentId}`, { json: payload }).json<any>();
    } catch (error) {
      throw toApiError(error, t('generic', undefined, 'errors'));
    }
  }

  static async deletePayment(paymentId: number): Promise<any> {
    try {
      return await api.delete(`payments/${paymentId}`).json<any>();
    } catch (error) {
      throw toApiError(error, t('generic', undefined, 'errors'));
    }
  }
}

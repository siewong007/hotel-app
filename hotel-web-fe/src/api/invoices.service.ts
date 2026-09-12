import { api, toApiError } from './client';
import type { PaymentWorkflowSummary } from '../types';

export class InvoicesService {
  static async getInvoicePreview(bookingId: string): Promise<any> {
    try {
      return await api.get(`invoices/preview/${bookingId}`).json<any>();
    } catch (error) {
      throw toApiError(error, 'Failed to fetch invoice preview');
    }
  }

  static async generateInvoice(bookingId: string): Promise<any> {
    try {
      return await api.post(`invoices/generate/${bookingId}`).json<any>();
    } catch (error) {
      throw toApiError(error, 'Failed to generate invoice');
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
      throw toApiError(error, 'Failed to record payment');
    }
  }

  static async getBookingPayments(bookingId: string | number): Promise<any[]> {
    try {
      return await api.get(`payments/all-payments/${bookingId}`).json<any[]>();
    } catch (error) {
      throw toApiError(error, 'Failed to fetch payments');
    }
  }

  static async getPaymentWorkflowSummary(bookingId: string | number): Promise<PaymentWorkflowSummary> {
    try {
      return await api.get(`payments/workflow-summary/${bookingId}`).json<PaymentWorkflowSummary>();
    } catch (error) {
      throw toApiError(error, 'Failed to fetch payment workflow summary');
    }
  }

  static async refundDeposit(bookingId: string | number, paymentMethod: string = 'cash', amount?: number): Promise<any> {
    try {
      // Ensure amount is a valid number
      const numericAmount = typeof amount === 'string' ? parseFloat(amount) : (amount || 0);
      return await api.post(`payments/refund-deposit/${bookingId}`, {
        json: { payment_method: paymentMethod, amount: numericAmount }
      }).json<any>();
    } catch (error) {
      throw toApiError(error, 'Failed to refund deposit');
    }
  }

  static async revertDepositRefund(bookingId: string | number): Promise<any> {
    try {
      return await api.post(`payments/revert-deposit-refund/${bookingId}`).json<any>();
    } catch (error) {
      throw toApiError(error, 'Failed to revert deposit refund');
    }
  }

  static async getUserInvoices(): Promise<any[]> {
    try {
      return await api.get('invoices').json<any[]>();
    } catch (error) {
      throw toApiError(error, 'Failed to fetch user invoices');
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
      throw toApiError(error, 'Failed to update payment');
    }
  }

  static async deletePayment(paymentId: number): Promise<any> {
    try {
      return await api.delete(`payments/${paymentId}`).json<any>();
    } catch (error) {
      throw toApiError(error, 'Failed to delete payment');
    }
  }
}

import { HTTPError } from 'ky';
import { api, APIError } from './client';

export class InvoicesService {
  static async getInvoicePreview(bookingId: string): Promise<any> {
    try {
      return await api.get(`invoices/preview/${bookingId}`).json<any>();
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to fetch invoice preview',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to fetch invoice preview');
    }
  }

  static async generateInvoice(bookingId: string): Promise<any> {
    try {
      return await api.post(`invoices/generate/${bookingId}`).json<any>();
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to generate invoice',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to generate invoice');
    }
  }

  static async recordPayment(data: {
    booking_id: number;
    amount: number;
    payment_method: string;
    payment_type?: string;
    transaction_reference?: string;
    notes?: string;
  }): Promise<any> {
    try {
      return await api.post('payments/record-payment', { json: data }).json<any>();
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to record payment',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to record payment');
    }
  }

  static async getBookingPayments(bookingId: string | number): Promise<any[]> {
    try {
      return await api.get(`payments/all-payments/${bookingId}`).json<any[]>();
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to fetch payments',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to fetch payments');
    }
  }

  static async refundDeposit(bookingId: string | number, paymentMethod: string = 'cash', amount?: number): Promise<any> {
    try {
      return await api.post(`payments/refund-deposit/${bookingId}`, {
        json: { payment_method: paymentMethod, amount: amount || 0 }
      }).json<any>();
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to refund deposit',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to refund deposit');
    }
  }

  static async getUserInvoices(): Promise<any[]> {
    try {
      return await api.get('invoices').json<any[]>();
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to fetch user invoices',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to fetch user invoices');
    }
  }
}

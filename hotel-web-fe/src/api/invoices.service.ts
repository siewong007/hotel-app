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

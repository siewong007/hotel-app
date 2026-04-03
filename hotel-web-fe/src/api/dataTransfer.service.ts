import { api, APIError } from './client';
import { HTTPError } from 'ky';

export interface BookingDataExport {
  version: string;
  exported_at: string;
  guests: any[];
  guest_complimentary_credits: any[];
  companies: any[];
  bookings: any[];
  payments: any[];
  invoices: any[];
  booking_guests: any[];
  booking_modifications: any[];
  booking_history: any[];
  night_audit_runs: any[];
  night_audit_details: any[];
  customer_ledgers: any[];
  customer_ledger_payments: any[];
  room_changes: any[];
  user_guests: any[];
  rooms: any[];
  room_types: any[];
}

export interface ImportResult {
  success: boolean;
  mode: string;
  records_imported: Record<string, number>;
  errors?: Record<string, { failed: number; last_error: string }>;
}

export class DataTransferService {
  static async exportData(): Promise<BookingDataExport> {
    try {
      return await api.get('data-transfer/export', { timeout: false }).json<BookingDataExport>();
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to export data',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to export data');
    }
  }

  static async importData(mode: 'import' | 'overwrite', data: BookingDataExport): Promise<ImportResult> {
    try {
      return await api.post('data-transfer/import', {
        json: { mode, data },
        timeout: false, // no timeout for potentially large imports
      }).json<ImportResult>();
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = await error.response.json().catch(() => ({}));
        throw new APIError(
          errorData.error || 'Failed to import data',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to import data');
    }
  }
}

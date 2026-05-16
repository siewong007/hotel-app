import { api, APIError } from './client';
import { HTTPError } from 'ky';
import type { BookingDataExport, ImportMode, ImportResult } from '../types';

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

  static async importData(mode: ImportMode, data: BookingDataExport): Promise<ImportResult> {
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

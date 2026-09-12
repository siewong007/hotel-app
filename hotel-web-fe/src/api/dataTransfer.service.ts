import { api, toApiError } from './client';
import type { BookingDataExport, ExportPreview, ImportMode, ImportResult } from '../types';

export class DataTransferService {
  static async previewExport(): Promise<ExportPreview> {
    try {
      return await api.get('data-transfer/export/preview', { timeout: false }).json<ExportPreview>();
    } catch (error) {
      throw toApiError(error, 'Failed to preview export data');
    }
  }

  static async exportData(): Promise<BookingDataExport> {
    try {
      return await api.get('data-transfer/export', { timeout: false }).json<BookingDataExport>();
    } catch (error) {
      throw toApiError(error, 'Failed to export data');
    }
  }

  static async importData(mode: ImportMode, data: BookingDataExport, tables: string[]): Promise<ImportResult> {
    try {
      return await api.post('data-transfer/import', {
        json: { mode, data, tables },
        timeout: false, // no timeout for potentially large imports
      }).json<ImportResult>();
    } catch (error) {
      throw toApiError(error, 'Failed to import data');
    }
  }
}

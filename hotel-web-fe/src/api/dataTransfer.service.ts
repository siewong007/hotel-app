import { api, toApiError } from './client';
import { SKIP_API_NOTIFICATION_HEADER } from '../utils/apiNotifications';
import { formatLocalDate } from '../utils/date';
import type {
  BackupImportMode,
  ConflictPolicy,
  ExportPreview,
  ImportExecuteResponse,
  ImportJobStatus,
  ImportPreview,
  UploadResponse,
} from '../types';

// Every data-transfer call carries the skip header: the Data Transfer page
// renders failures itself (inline alerts inside the export panel / import
// wizard), so the client's global error toast would be a second surface for
// the same failure.
const SKIP_NOTIFICATION = { [SKIP_API_NOTIFICATION_HEADER]: 'true' } as const;

/** What `exportData` hands back after triggering the browser download. */
export interface ExportDownload {
  filename: string;
  bytes: number;
}

/**
 * `Content-Disposition: attachment; filename="saliminn-backup-<ts>.json"` —
 * the server names the file; the parameter may also arrive RFC 5987-encoded
 * as `filename*=UTF-8''…`. Fall back to the known pattern when absent.
 */
function filenameFromDisposition(disposition: string | null): string {
  const fallback = `saliminn-backup-${formatLocalDate()}.json`;
  if (!disposition) return fallback;

  const encoded = /filename\*=(?:UTF-8|utf-8)''([^;]+)/.exec(disposition);
  if (encoded?.[1]) {
    try {
      return decodeURIComponent(encoded[1].trim());
    } catch {
      return encoded[1].trim();
    }
  }
  const plain = /filename="?([^";]+)"?/.exec(disposition);
  return plain?.[1]?.trim() || fallback;
}

export class DataTransferService {
  static async previewExport(): Promise<ExportPreview> {
    try {
      return await api
        .get('data-transfer/export/preview', { timeout: false, headers: SKIP_NOTIFICATION })
        .json<ExportPreview>();
    } catch (error) {
      throw toApiError(error, 'Failed to preview export data');
    }
  }

  /**
   * Streamed `hotel-backup` download — the response is read as a Blob (never
   * `.json()`, which would buffer the whole backup as text), then saved via an
   * object-URL anchor so the browser handles the file write.
   */
  static async exportData(): Promise<ExportDownload> {
    try {
      const response = await api.get('data-transfer/export', {
        timeout: false,
        headers: SKIP_NOTIFICATION,
      });
      const blob = await response.blob();
      const filename = filenameFromDisposition(response.headers.get('content-disposition'));

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);

      return { filename, bytes: blob.size };
    } catch (error) {
      throw toApiError(error, 'Failed to export data');
    }
  }

  /**
   * Stage a backup file for import. The body is the raw file — the server
   * streams it straight to disk and names the staged file itself.
   */
  static async uploadBackup(file: File): Promise<UploadResponse> {
    try {
      return await api
        .post('data-transfer/import/uploads', {
          body: file,
          headers: {
            ...SKIP_NOTIFICATION,
            'content-type': 'application/octet-stream',
          },
          timeout: false,
        })
        .json<UploadResponse>();
    } catch (error) {
      throw toApiError(error, 'Failed to upload backup file');
    }
  }

  /** Pre-flight diff of a staged upload against this database. */
  static async previewImport(uploadId: string): Promise<ImportPreview> {
    try {
      return await api
        .post('data-transfer/import/preview', {
          json: { uploadId },
          headers: SKIP_NOTIFICATION,
          timeout: false,
        })
        .json<ImportPreview>();
    } catch (error) {
      throw toApiError(error, 'Failed to preview backup contents');
    }
  }

  /** Start an import job for a staged upload — resolves to `202 {jobId}`. */
  static async executeImport(input: {
    uploadId: string;
    mode: BackupImportMode;
    onConflict?: ConflictPolicy;
    tables?: string[];
  }): Promise<ImportExecuteResponse> {
    try {
      return await api
        .post('data-transfer/import/execute', {
          json: { ...input, confirm: true },
          headers: SKIP_NOTIFICATION,
        })
        .json<ImportExecuteResponse>();
    } catch (error) {
      throw toApiError(error, 'Failed to start the import');
    }
  }

  /** Poll a running/finished import job's status. */
  static async getImportJob(jobId: string): Promise<ImportJobStatus> {
    try {
      return await api
        .get(`data-transfer/import/jobs/${jobId}`, { headers: SKIP_NOTIFICATION })
        .json<ImportJobStatus>();
    } catch (error) {
      throw toApiError(error, 'Failed to fetch import progress');
    }
  }

  /** Discard a staged upload the user no longer intends to import. */
  static async deleteUpload(uploadId: string): Promise<void> {
    try {
      await api.delete(`data-transfer/import/uploads/${uploadId}`, {
        headers: SKIP_NOTIFICATION,
      });
    } catch (error) {
      throw toApiError(error, 'Failed to discard the staged upload');
    }
  }
}

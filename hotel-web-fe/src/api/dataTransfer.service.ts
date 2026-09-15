import { api, toApiError } from './client';
import { t } from '../i18n';
import { SKIP_API_NOTIFICATION_HEADER } from '../utils/apiNotifications';
import { formatLocalDate } from '../utils/date';
import type {
  BackupImportMode,
  ConflictPolicy,
  ExportPreview,
  ExportScope,
  ImportExecuteResponse,
  ImportJobStatus,
  ImportPreview,
  StepUpRequest,
  StepUpResponse,
  TransferHistory,
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

/** Header carrying the step-up token on gated operations — mirrors
 * `STEP_UP_HEADER` in `services/data_transfer_step_up.rs`. */
const stepUpHeaders = (stepUpToken?: string) =>
  stepUpToken ? { 'X-Step-Up': stepUpToken } : {};

/** Header carrying the backup passphrase on `system` exports — mirrors
 * `backup_passphrase` in `modules/data_transfer/routes.rs`. A header rather
 * than a query parameter so the one secret protecting a credential-bearing
 * backup never lands in an access log or browser history. */
const passphraseHeaders = (passphrase?: string) =>
  passphrase ? { 'X-Backup-Passphrase': passphrase } : {};

export class DataTransferService {
  static async previewExport(scope: ExportScope = 'standard'): Promise<ExportPreview> {
    try {
      return await api
        .get('data-transfer/export/preview', {
          timeout: false,
          headers: SKIP_NOTIFICATION,
          searchParams: { scope },
        })
        .json<ExportPreview>();
    } catch (error) {
      throw toApiError(error, t('generic', undefined, 'errors'));
    }
  }

  /**
   * Streamed `hotel-backup` download — the response is read as a Blob (never
   * `.json()`, which would buffer the whole backup as text), then saved via an
   * object-URL anchor so the browser handles the file write. `full`/`backup`
   * scopes need a fresh `stepUpToken` from `stepUp`.
   */
  static async exportData(
    scope: ExportScope = 'standard',
    stepUpToken?: string,
    passphrase?: string,
  ): Promise<ExportDownload> {
    try {
      const response = await api.get('data-transfer/export', {
        timeout: false,
        headers: {
          ...SKIP_NOTIFICATION,
          ...stepUpHeaders(stepUpToken),
          ...passphraseHeaders(passphrase),
        },
        searchParams: { scope },
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
      throw toApiError(error, t('generic', undefined, 'errors'));
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
      throw toApiError(error, t('generic', undefined, 'errors'));
    }
  }

  /** Pre-flight diff of a staged upload against this database. */
  static async previewImport(uploadId: string, passphrase?: string): Promise<ImportPreview> {
    try {
      return await api
        .post('data-transfer/import/preview', {
          json: passphrase ? { uploadId, passphrase } : { uploadId },
          headers: SKIP_NOTIFICATION,
          timeout: false,
        })
        .json<ImportPreview>();
    } catch (error) {
      throw toApiError(error, t('generic', undefined, 'errors'));
    }
  }

  /**
   * Re-authenticate for a privileged operation (full/backup export, restore).
   * Returns a ~2-minute token bound to the current session — send it as
   * `X-Step-Up` on the gated call that follows.
   */
  static async stepUp(input: StepUpRequest): Promise<StepUpResponse> {
    try {
      return await api
        .post('data-transfer/step-up', {
          json: input,
          headers: SKIP_NOTIFICATION,
        })
        .json<StepUpResponse>();
    } catch (error) {
      throw toApiError(error, t('generic', undefined, 'errors'));
    }
  }

  /** Audited export/import activity for the transfer-history panel. */
  static async transferHistory(limit = 100): Promise<TransferHistory> {
    try {
      return await api
        .get('data-transfer/history', {
          headers: SKIP_NOTIFICATION,
          searchParams: { limit },
        })
        .json<TransferHistory>();
    } catch (error) {
      throw toApiError(error, t('generic', undefined, 'errors'));
    }
  }

  /** Start an import job for a staged upload — resolves to `202 {jobId}`.
   * `mode: 'restore'` additionally needs a fresh `stepUpToken`. */
  static async executeImport(
    input: {
      uploadId: string;
      mode: BackupImportMode;
      onConflict?: ConflictPolicy;
      tables?: string[];
      passphrase?: string;
    },
    stepUpToken?: string,
  ): Promise<ImportExecuteResponse> {
    try {
      return await api
        .post('data-transfer/import/execute', {
          json: { ...input, confirm: true },
          headers: { ...SKIP_NOTIFICATION, ...stepUpHeaders(stepUpToken) },
        })
        .json<ImportExecuteResponse>();
    } catch (error) {
      throw toApiError(error, t('generic', undefined, 'errors'));
    }
  }

  /** Poll a running/finished import job's status. */
  static async getImportJob(jobId: string): Promise<ImportJobStatus> {
    try {
      return await api
        .get(`data-transfer/import/jobs/${jobId}`, { headers: SKIP_NOTIFICATION })
        .json<ImportJobStatus>();
    } catch (error) {
      throw toApiError(error, t('generic', undefined, 'errors'));
    }
  }

  /** Discard a staged upload the user no longer intends to import. */
  static async deleteUpload(uploadId: string): Promise<void> {
    try {
      await api.delete(`data-transfer/import/uploads/${uploadId}`, {
        headers: SKIP_NOTIFICATION,
      });
    } catch (error) {
      throw toApiError(error, t('generic', undefined, 'errors'));
    }
  }
}

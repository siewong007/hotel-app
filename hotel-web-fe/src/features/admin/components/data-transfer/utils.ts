// Display helpers for the data-transfer workflow components.
import { formatStatusLabel } from '../../../../utils/formatters';
import { formatNumber, dateFormatter } from '../../../../i18n/format';
import type { UseTranslationResult } from '../../../../i18n/useTranslation';
import type { TransferHistoryEntry as ServerHistoryEntry } from '../../../../types';
import type { TransferHistoryEntry } from './types';

export const formatNum = (n: number): string => formatNumber(n) ?? '';

export const formatWhen = (at: number): string =>
  dateFormatter({
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(at));

export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  const mib = bytes / (1024 * 1024);
  if (mib >= 1) return `${mib.toFixed(mib >= 100 ? 0 : 1)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
};

/** `public.guests` → `guests` — schema-qualified wire names read better short. */
export const shortEntityName = (name: string): string =>
  name.startsWith('public.') ? name.slice('public.'.length) : name;

/** Human labels for the manifest's exclusion reason codes
 * (`services/data_transfer.rs::EXCLUDED_TABLES`). Unknown codes pass through
 * humanized so a new backend reason still renders something truthful. */
export const exclusionReasonLabel = (
  tOr: UseTranslationResult['tOr'],
  reason: string,
): string => tOr(`export.exclusions.${reason}`, formatStatusLabel(reason, reason));

/** History row title — `actionLabel` (set for security rows and i18n) wins;
 * legacy `'import'`/`'overwrite'` modes stay readable. */
export const describeHistoryAction = (
  entry: {
    type: 'export' | 'import' | 'security';
    mode?: string;
    actionLabel?: string;
  },
  t: UseTranslationResult['t'],
): string => {
  if (entry.actionLabel) return entry.actionLabel;
  if (entry.type === 'export') return t('history.actionExport');
  if (entry.type === 'security') return t('history.actionReAuth');
  if (entry.mode === 'restore' || entry.mode === 'overwrite') {
    return t('history.actionImportMode', { mode: entry.mode });
  }
  return t('history.actionImport');
};

// ----- Server history projection ------------------------------------------

const detailString = (details: ServerHistoryEntry['details'], key: string): string | undefined => {
  const value = details?.[key];
  return typeof value === 'string' && value ? value : undefined;
};

const detailNumber = (details: ServerHistoryEntry['details'], key: string): number | undefined => {
  const value = details?.[key];
  return typeof value === 'number' ? value : undefined;
};

/**
 * Project one `GET /data-transfer/history` audit row into the display shape
 * `TransferHistoryList` renders. `labels` supplies the translated strings so
 * this stays a pure function — call it inside the component that owns `t()`.
 */
export const mapServerHistoryEntry = (
  row: ServerHistoryEntry,
  labels: {
    exportType: (exportType: string | undefined) => string;
    reAuth: string;
    reAuthDenied: string;
    importStarted: string;
    entities: (count: number) => string;
    unknownUser: string;
  },
): TransferHistoryEntry => {
  const base = {
    id: String(row.id),
    by: row.username ?? labels.unknownUser,
    at: Date.parse(row.createdAt) || 0,
  };
  const details = row.details;

  switch (row.action) {
    case 'data_export':
      return {
        ...base,
        type: 'export',
        categories: labels.exportType(detailString(details, 'export_type')),
        records: detailNumber(details, 'record_count'),
        status: 'success',
        jobId: detailString(details, 'export_id'),
      };
    case 'data_import': {
      const phase = detailString(details, 'phase');
      const skipped = detailNumber(details, 'skipped') ?? 0;
      const entityCount = Array.isArray(details?.entities) ? details.entities.length : undefined;
      const records =
        phase === 'start'
          ? undefined
          : (detailNumber(details, 'inserted') ?? 0) +
            (detailNumber(details, 'updated') ?? 0) +
            skipped;
      return {
        ...base,
        type: 'import',
        mode: detailString(details, 'mode') as TransferHistoryEntry['mode'],
        actionLabel: phase === 'start' ? labels.importStarted : undefined,
        categories: entityCount !== undefined ? labels.entities(entityCount) : '',
        records,
        status:
          phase === 'failed' ? 'failed' : phase === 'start' ? 'started' : skipped > 0 ? 'partial' : 'success',
        error: detailString(details, 'error'),
        jobId: detailString(details, 'job_id'),
      };
    }
    case 'data_transfer_step_up':
      return {
        ...base,
        type: 'security',
        actionLabel: labels.reAuth,
        categories: '',
        status: 'success',
      };
    case 'data_transfer_step_up_denied':
      return {
        ...base,
        type: 'security',
        actionLabel: labels.reAuthDenied,
        categories: '',
        status: 'failed',
        error: detailString(details, 'reason'),
      };
    default:
      // A new audit action still renders — the raw name beats dropping the row.
      return { ...base, type: 'security', categories: row.action, status: 'success' };
  }
};

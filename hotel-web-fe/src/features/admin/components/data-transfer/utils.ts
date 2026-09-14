// Display helpers for the data-transfer workflow components.
import { formatStatusLabel } from '../../../../utils/formatters';

export const formatNum = (n: number): string => n.toLocaleString('en-US');

export const formatWhen = (at: number): string =>
  new Date(at).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

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
 * so a new backend reason still renders something truthful. */
export const exclusionReasonLabel = (reason: string): string => {
  switch (reason) {
    case 'credentials_and_auth_state':
      return 'Credentials & auth state';
    case 'session_or_token_material':
      return 'Sessions & tokens';
    case 'sensitive_ekyc_pii':
      return 'eKYC identity data';
    case 'ephemeral_queue_state':
      return 'In-flight queue state';
    case 'internal_system_table':
      return 'Internal system tables';
    default:
      return formatStatusLabel(reason, reason);
  }
};

/** History row title — legacy `'import'`/`'overwrite'` modes stay readable. */
export const describeHistoryAction = (entry: {
  type: 'export' | 'import';
  mode?: string;
}): string => {
  if (entry.type === 'export') return 'Export';
  if (entry.mode === 'restore' || entry.mode === 'overwrite') {
    return `Import (${entry.mode})`;
  }
  return 'Import';
};

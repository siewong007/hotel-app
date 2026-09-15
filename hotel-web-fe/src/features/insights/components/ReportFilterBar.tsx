import { Box, Button, MenuItem, TextField } from '@mui/material';
import { useTranslation } from '../../../i18n';
import type { ReportCatalogEntry, ReportQueryParams } from '../types';

export interface ReportFilterBarProps {
  report: ReportCatalogEntry;
  value: ReportQueryParams;
  onChange: (next: ReportQueryParams) => void;
  onRun: () => void;
  loading?: boolean;
}

/** Options matching the shift report's shift codes. */
const SHIFT_OPTIONS = ['', 'morning', 'evening', 'night'] as const;

/**
 * Shared filter bar: always date range; renders only the extra params the
 * selected report's catalog entry declares.
 */
export function ReportFilterBar({ report, value, onChange, onRun, loading }: ReportFilterBarProps) {
  const { t } = useTranslation('dashboard');
  const has = (p: string) => report.params.includes(p);
  const set = (patch: Partial<ReportQueryParams>) => onChange({ ...value, ...patch });
  const shiftLabel = (s: '' | 'morning' | 'evening' | 'night'): string => {
    switch (s) {
      case 'morning':
        return t('library.shifts.morning');
      case 'evening':
        return t('library.shifts.evening');
      case 'night':
        return t('library.shifts.night');
      default:
        return t('library.filters.allShifts');
    }
  };

  return (
    <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
      <TextField
        label={t('common:time.startDate')}
        type="date"
        size="small"
        value={value.startDate}
        onChange={(e) => set({ startDate: e.target.value })}
        slotProps={{ inputLabel: { shrink: true } }}
      />
      <TextField
        label={t('common:time.endDate')}
        type="date"
        size="small"
        value={value.endDate}
        onChange={(e) => set({ endDate: e.target.value })}
        slotProps={{ inputLabel: { shrink: true } }}
      />
      {has('shift') && (
        <TextField
          select
          label={t('library.filters.shift')}
          size="small"
          sx={{ minWidth: 120 }}
          value={value.shift ?? ''}
          onChange={(e) => set({ shift: e.target.value || undefined })}
        >
          {SHIFT_OPTIONS.map((s) => (
            <MenuItem key={s} value={s}>
              {shiftLabel(s)}
            </MenuItem>
          ))}
        </TextField>
      )}
      {has('drawer') && (
        <TextField
          label={t('library.filters.drawer')}
          size="small"
          sx={{ width: 120 }}
          value={value.drawer ?? ''}
          onChange={(e) => set({ drawer: e.target.value || undefined })}
        />
      )}
      {has('company_name') && (
        <TextField
          label={t('library.filters.company')}
          size="small"
          value={value.companyName ?? ''}
          onChange={(e) => set({ companyName: e.target.value || undefined })}
        />
      )}
      {has('room_type') && (
        <TextField
          label={t('library.filters.roomType')}
          size="small"
          sx={{ width: 140 }}
          value={value.roomType ?? ''}
          onChange={(e) => set({ roomType: e.target.value || undefined })}
        />
      )}
      <Button variant="contained" onClick={onRun} disabled={loading}>
        {t('library.runReport')}
      </Button>
    </Box>
  );
}

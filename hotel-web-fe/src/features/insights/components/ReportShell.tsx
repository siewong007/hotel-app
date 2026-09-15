import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Grid,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import PrintIcon from '@mui/icons-material/Print';
import type { KpiFormat, ReportEnvelope, ReportKpi } from '../types';
import { formatCurrency } from '../../../utils/currency';
import { printReportEnvelope } from '../utils/reportEnvelopePrint';
import { TableScroll } from '../../../components/data-table/TableScroll';
import { useIsPhone } from '../../../hooks/useIsPhone';
import { formatNumber, useTranslation, type UseTranslationResult } from '../../../i18n';
import { formatHotelDate } from '../../../utils/date';

const formatValue = (value: unknown, format: KpiFormat): string => {
  if (value == null) return '—';
  const num = typeof value === 'number' ? value : Number(value);
  switch (format) {
    case 'currency':
      return Number.isFinite(num) ? formatCurrency(num) : String(value);
    case 'percent':
      return Number.isFinite(num)
        ? `${formatNumber(num, { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`
        : String(value);
    case 'number':
      return Number.isFinite(num) ? formatNumber(num) : String(value);
    default:
      return String(value);
  }
};

const fieldLabel = (
  tOr: UseTranslationResult['tOr'],
  key: string,
  fallback: string,
) => tOr(`insights:fields.${key}`, fallback);

const KpiCard = ({ kpi }: { kpi: ReportKpi }) => {
  const { tOr } = useTranslation('insights');
  return (
    <Grid size={{ xs: 6, sm: 4, md: 3 }}>
      <Card variant="outlined">
        <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
          <Typography variant="caption" color="text.secondary">
            {fieldLabel(tOr, kpi.key, kpi.label)}
          </Typography>
          <Typography variant="h6" component="div">
            {formatValue(kpi.value, kpi.format)}
          </Typography>
        </CardContent>
      </Card>
    </Grid>
  );
};

export interface ReportShellProps {
  envelope: ReportEnvelope | null;
  loading: boolean;
  error: string | null;
  /** Slot for the caller's filter bar / actions rendered above the report. */
  toolbar?: React.ReactNode;
}

/**
 * Generic renderer for the typed report envelope — every catalog report
 * renders through this shell so filters, KPIs, sections, loading and error
 * states are consistent.
 */
export function ReportShell({ envelope, loading, error, toolbar }: ReportShellProps) {
  const { t, tOr } = useTranslation('insights');
  const isPhone = useIsPhone();

  return (
    <Box>
      {toolbar}
      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      )}
      {error && !loading && <Alert severity="error">{error}</Alert>}
      {envelope && !loading && (
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5, mb: 1, flexWrap: 'wrap' }}>
            <Typography variant="h6">
              {tOr(`reports.${envelope.meta.report_id}.title`, envelope.meta.title)}
            </Typography>
            {envelope.meta.range_start && envelope.meta.range_end && (
              <Typography variant="body2" color="text.secondary">
                {formatHotelDate(envelope.meta.range_start)} → {formatHotelDate(envelope.meta.range_end)}
              </Typography>
            )}
            <Chip
              size="small"
              variant="outlined"
              label={tOr(`dateBasis.${envelope.meta.date_basis}`, `${envelope.meta.date_basis} dates`)}
            />
            <Tooltip title={t('report.print')}>
              <IconButton
                size="small"
                onClick={() => printReportEnvelope(envelope)}
                aria-label={t('report.print')}
                sx={{ ml: 'auto' }}
              >
                <PrintIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>

          {envelope.kpis.length > 0 && (
            <Grid container spacing={1.5} sx={{ mb: 3 }}>
              {envelope.kpis.map((kpi) => (
                <KpiCard key={kpi.key} kpi={kpi} />
              ))}
            </Grid>
          )}

          {envelope.sections.map((section) => (
            <Box key={section.key} sx={{ mb: 3 }}>
              <Typography variant="subtitle1" sx={{ mb: 1 }}>
                {fieldLabel(tOr, section.key, section.title)}
              </Typography>
              <Card variant="outlined">
                {isPhone ? (
                  <Box sx={{ px: 2 }}>
                    {section.rows.length === 0 && (
                      <Typography
                        variant="body2"
                        sx={{ color: 'text.secondary', py: 3, textAlign: 'center' }}
                      >
                        {t('report.emptySection')}
                      </Typography>
                    )}
                    {section.rows.map((row, i) => (
                      <Box
                        key={i}
                        sx={{
                          py: 1.25,
                          borderBottom: '1px solid',
                          borderColor: 'divider',
                          '&:last-child': { borderBottom: 0 },
                        }}
                      >
                        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                          {section.columns[0]
                            ? formatValue(row[section.columns[0].key], section.columns[0].format)
                            : ''}
                        </Typography>
                        {section.columns.slice(1).map((col) => (
                          <Box
                            key={col.key}
                            sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, mt: 0.25 }}
                          >
                            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                              {fieldLabel(tOr, col.key, col.label)}
                            </Typography>
                            <Typography variant="caption" sx={{ fontWeight: 600, textAlign: 'right' }}>
                              {formatValue(row[col.key], col.format)}
                            </Typography>
                          </Box>
                        ))}
                      </Box>
                    ))}
                  </Box>
                ) : (
                <TableScroll>
                  <Table size="small">
                    {section.columns.length > 0 && (
                      <TableHead>
                        <TableRow>
                          {section.columns.map((col) => (
                            <TableCell key={col.key}>{fieldLabel(tOr, col.key, col.label)}</TableCell>
                          ))}
                        </TableRow>
                      </TableHead>
                    )}
                    <TableBody>
                      {section.rows.length === 0 && (
                        <TableRow>
                          <TableCell
                            colSpan={Math.max(section.columns.length, 1)}
                            align="center"
                            sx={{ color: 'text.secondary', py: 3 }}
                          >
                            {t('report.emptySection')}
                          </TableCell>
                        </TableRow>
                      )}
                      {section.rows.map((row, i) => (
                        <TableRow key={i}>
                          {section.columns.map((col) => (
                            <TableCell key={col.key}>
                              {formatValue(row[col.key], col.format)}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableScroll>
                )}
              </Card>
            </Box>
          ))}

          {envelope.kpis.length === 0 && envelope.sections.length === 0 && (
            <Alert severity="info">{t('report.noData')}</Alert>
          )}
        </Box>
      )}
    </Box>
  );
}

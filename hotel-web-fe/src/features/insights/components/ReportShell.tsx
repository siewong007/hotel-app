import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Grid,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import type { KpiFormat, ReportEnvelope, ReportKpi } from '../types';
import { formatCurrency } from '../../../utils/currency';

const formatValue = (value: unknown, format: KpiFormat): string => {
  if (value == null) return '—';
  const num = typeof value === 'number' ? value : Number(value);
  switch (format) {
    case 'currency':
      return Number.isFinite(num) ? formatCurrency(num) : String(value);
    case 'percent':
      return Number.isFinite(num) ? `${num.toFixed(1)}%` : String(value);
    case 'number':
      return Number.isFinite(num) ? num.toLocaleString() : String(value);
    default:
      return String(value);
  }
};

const KpiCard = ({ kpi }: { kpi: ReportKpi }) => (
  <Grid size={{ xs: 6, sm: 4, md: 3 }}>
    <Card variant="outlined">
      <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Typography variant="caption" color="text.secondary">
          {kpi.label}
        </Typography>
        <Typography variant="h6" component="div">
          {formatValue(kpi.value, kpi.format)}
        </Typography>
      </CardContent>
    </Card>
  </Grid>
);

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
            <Typography variant="h6">{envelope.meta.title}</Typography>
            {envelope.meta.range_start && envelope.meta.range_end && (
              <Typography variant="body2" color="text.secondary">
                {envelope.meta.range_start} → {envelope.meta.range_end}
              </Typography>
            )}
            <Chip size="small" variant="outlined" label={`${envelope.meta.date_basis} dates`} />
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
                {section.title}
              </Typography>
              <Card variant="outlined">
                <Table size="small">
                  {section.columns.length > 0 && (
                    <TableHead>
                      <TableRow>
                        {section.columns.map((col) => (
                          <TableCell key={col.key}>{col.label}</TableCell>
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
                          No rows for this period
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
              </Card>
            </Box>
          ))}

          {envelope.kpis.length === 0 && envelope.sections.length === 0 && (
            <Alert severity="info">This report produced no data for the selected range.</Alert>
          )}
        </Box>
      )}
    </Box>
  );
}

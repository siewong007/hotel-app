import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Card,
  CardActionArea,
  CardContent,
  CircularProgress,
  Grid,
  Typography,
} from '@mui/material';
import { ReportFilterBar } from '../components/ReportFilterBar';
import { ReportShell } from '../components/ReportShell';
import { useReportCatalog, useReportEnvelope } from '../hooks';
import type { ReportCatalogEntry, ReportQueryParams } from '../types';
import { formatLocalDate } from '../../../utils/date';
import { getQueryErrorMessage } from '../../../api/queryConfig';

const CATEGORY_ORDER = ['operations', 'financial', 'analytics', 'accounting'];

/**
 * Insights report library — the catalog drives the card grid and the filter
 * bar's parameter controls; every report renders through ReportShell.
 */
export default function ReportLibraryPage() {
  const catalog = useReportCatalog();
  const today = formatLocalDate();
  const [selected, setSelected] = useState<ReportCatalogEntry | null>(null);
  const [filters, setFilters] = useState<ReportQueryParams>({ startDate: today, endDate: today });
  const [runParams, setRunParams] = useState<ReportQueryParams | null>(null);

  const report = useReportEnvelope(selected?.id ?? null, runParams);

  const grouped = useMemo(() => {
    const entries = catalog.data ?? [];
    return CATEGORY_ORDER.map((category) => ({
      category,
      reports: entries.filter((e) => e.category === category),
    })).filter((g) => g.reports.length > 0);
  }, [catalog.data]);

  const handleSelect = (entry: ReportCatalogEntry) => {
    setSelected(entry);
    setRunParams(null);
  };

  if (catalog.isPending) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }
  if (catalog.error) {
    return <Alert severity="error">{getQueryErrorMessage(catalog.error, 'Failed to load reports')}</Alert>;
  }

  return (
    <Box>
      {!selected &&
        grouped.map((group) => (
          <Box key={group.category} sx={{ mb: 3 }}>
            <Typography variant="subtitle1" sx={{ mb: 1, textTransform: 'capitalize' }}>
              {group.category}
            </Typography>
            <Grid container spacing={2}>
              {group.reports.map((entry) => (
                <Grid key={entry.id} size={{ xs: 12, sm: 6, md: 4 }}>
                  <Card variant="outlined">
                    <CardActionArea onClick={() => handleSelect(entry)}>
                      <CardContent>
                        <Typography variant="subtitle2">{entry.title}</Typography>
                        <Typography variant="body2" color="text.secondary">
                          {entry.description}
                        </Typography>
                      </CardContent>
                    </CardActionArea>
                  </Card>
                </Grid>
              ))}
            </Grid>
          </Box>
        ))}

      {selected && (
        <ReportShell
          envelope={report.data ?? null}
          loading={report.isFetching}
          error={getQueryErrorMessage(report.error, 'Failed to run report') || null}
          toolbar={
            <Box>
              <Typography variant="body2" sx={{ cursor: 'pointer', mb: 1.5 }}
                onClick={() => { setSelected(null); setRunParams(null); }}>
                ← All reports
              </Typography>
              <ReportFilterBar
                report={selected}
                value={filters}
                onChange={setFilters}
                onRun={() => setRunParams({ ...filters })}
                loading={report.isFetching}
              />
            </Box>
          }
        />
      )}
    </Box>
  );
}

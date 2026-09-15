import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Paper,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import EmptyState from '../../../components/common/EmptyState';
import PageHeader from '../../../components/common/PageHeader';
import { MobileCardRow } from '../../../components/data-table/MobileCardRow';
import { TableScroll } from '../../../components/data-table/TableScroll';
import { useIsPhone } from '../../../hooks/useIsPhone';
import { useConfirm } from '../../../components/common/ConfirmProvider';
import { useAuth } from '../../../auth/AuthContext';
import { formatHotelDate } from '../../../utils/date';
import { SegmentsApi } from '../api';
import { segmentFieldMeta, NO_VALUE_OPS } from '../constants';
import type { SegmentCondition, SegmentSummary } from '../types';
import { SegmentEditorDialog } from '../components/SegmentEditorDialog';
import { useTranslation, type UseTranslationResult } from '../../../i18n';

/** "country is Malaysia · total stays at least 3" — one line per condition. */
const describeCondition = (t: UseTranslationResult['t'], c: SegmentCondition): string => {
  const meta = segmentFieldMeta(c.field);
  const field = meta ? t(meta.labelKey) : c.field;
  const opMeta = meta?.ops.find((o) => o.op === c.op);
  const op = opMeta ? t(opMeta.labelKey) : c.op;
  if (NO_VALUE_OPS.has(c.op)) return `${field} ${op}`;
  const value = Array.isArray(c.value) ? c.value.join(', ') : String(c.value ?? '');
  return `${field} ${op} ${value}`;
};

const describeRules = (t: UseTranslationResult['t'], s: SegmentSummary): string =>
  s.rules.groups
    .map((g) => g.conditions.map((c) => describeCondition(t, c)).join(' · '))
    .join(`  ${t('builder.or')}  `);

const SegmentsPage = () => {
  const { t } = useTranslation('segments');
  const { hasPermission } = useAuth();
  const isPhone = useIsPhone();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const canManage = hasPermission('segments:manage');

  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [editor, setEditor] = useState<{ open: boolean; segment: SegmentSummary | null }>({
    open: false,
    segment: null,
  });
  const [previewFor, setPreviewFor] = useState<SegmentSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const segments = useQuery({
    queryKey: ['segments', 'list', search, activeFilter],
    queryFn: () =>
      SegmentsApi.list({
        search: search || undefined,
        is_active: activeFilter === 'all' ? undefined : activeFilter === 'active',
        page_size: 50,
      }),
  });

  const preview = useQuery({
    queryKey: ['segments', 'preview', previewFor?.id],
    queryFn: () => SegmentsApi.preview(previewFor!.id),
    enabled: previewFor !== null,
  });

  const toggleActive = useMutation({
    mutationFn: (segment: SegmentSummary) =>
      SegmentsApi.update(segment.id, {
        name: segment.name,
        description: segment.description,
        rules: segment.rules,
        is_active: !segment.is_active,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['segments'] }),
    onError: (e) => setError(e instanceof Error ? e.message : t('page.updateFailed')),
  });

  const remove = useMutation({
    mutationFn: (id: number) => SegmentsApi.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['segments'] }),
    onError: (e) => setError(e instanceof Error ? e.message : t('page.deleteFailed')),
  });

  return (
    <Box>
      <PageHeader
        kicker={t('page.kicker')}
        title={t('page.title')}
        subtitle={t('page.subtitle')}
        actions={
          canManage ? (
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setEditor({ open: true, segment: null })}
            >
              {t('page.newSegment')}
            </Button>
          ) : undefined
        }
      />
      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      <Paper sx={{ p: 2 }}>
        <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
          <TextField
            size="small"
            label={t('common:actions.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <TextField
            select
            size="small"
            label={t('common:field.status')}
            value={activeFilter}
            onChange={(e) => setActiveFilter(e.target.value as typeof activeFilter)}
            sx={{ minWidth: 140 }}
          >
            <MenuItem value="all">{t('page.filterAll')}</MenuItem>
            <MenuItem value="active">{t('page.filterActive')}</MenuItem>
            <MenuItem value="inactive">{t('page.filterInactive')}</MenuItem>
          </TextField>
        </Stack>
        {segments.isLoading ? (
          <Skeleton variant="rectangular" height={200} />
        ) : (segments.data?.items.length ?? 0) === 0 ? (
          <EmptyState
            title={t('page.emptyTitle')}
            description={t('page.emptyDescription')}
          />
        ) : isPhone ? (
          <Box>
            {(segments.data?.items ?? []).map((s) => (
              <MobileCardRow
                key={s.id}
                title={s.name}
                subtitle={s.description || describeRules(t, s)}
                meta={t('page.cardMeta', { count: s.member_count, date: formatHotelDate(s.updated_at) })}
                status={
                  <Chip
                    size="small"
                    label={s.is_active ? t('page.filterActive') : t('page.filterInactive')}
                    color={s.is_active ? 'success' : 'default'}
                  />
                }
                footer={
                  <>
                    <Button size="small" onClick={() => setPreviewFor(s)}>
                      {t('page.preview')}
                    </Button>
                    {canManage && (
                      <>
                        <Button size="small" onClick={() => setEditor({ open: true, segment: s })}>
                          {t('common:actions.edit')}
                        </Button>
                        <Button
                          size="small"
                          onClick={() => toggleActive.mutate(s)}
                          disabled={toggleActive.isPending}
                        >
                          {s.is_active ? t('page.deactivate') : t('page.activate')}
                        </Button>
                        <Button
                          size="small"
                          color="error"
                          disabled={remove.isPending}
                          onClick={async () => {
                            if (
                              !(await confirm({
                                title: t('page.deleteTitle'),
                                message: t('page.deleteConfirm', { name: s.name }),
                                confirmText: t('common:actions.delete'),
                                severity: 'warning',
                              }))
                            ) {
                              return;
                            }
                            remove.mutate(s.id);
                          }}
                        >
                          {t('common:actions.delete')}
                        </Button>
                      </>
                    )}
                  </>
                }
              />
            ))}
          </Box>
        ) : (
          <TableScroll>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('common:field.name')}</TableCell>
                  <TableCell>{t('page.colRules')}</TableCell>
                  <TableCell>{t('page.colMembers')}</TableCell>
                  <TableCell>{t('common:field.status')}</TableCell>
                  <TableCell>{t('page.colUpdated')}</TableCell>
                  <TableCell align="right">{t('common:field.actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(segments.data?.items ?? []).map((s) => (
                  <TableRow key={s.id} hover>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {s.name}
                      </Typography>
                      {s.description && (
                        <Typography variant="caption" color="text.secondary">
                          {s.description}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">
                        {describeRules(t, s)}
                      </Typography>
                    </TableCell>
                    <TableCell>{s.member_count}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={s.is_active ? t('page.filterActive') : t('page.filterInactive')}
                        color={s.is_active ? 'success' : 'default'}
                      />
                    </TableCell>
                    <TableCell>{formatHotelDate(s.updated_at)}</TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                        <Button size="small" onClick={() => setPreviewFor(s)}>
                          {t('page.preview')}
                        </Button>
                        {canManage && (
                          <>
                            <Button
                              size="small"
                              onClick={() => setEditor({ open: true, segment: s })}
                            >
                              {t('common:actions.edit')}
                            </Button>
                            <Button
                              size="small"
                              onClick={() => toggleActive.mutate(s)}
                              disabled={toggleActive.isPending}
                            >
                              {s.is_active ? t('page.deactivate') : t('page.activate')}
                            </Button>
                            <Button
                              size="small"
                              color="error"
                              disabled={remove.isPending}
                              onClick={async () => {
                                if (
                                  !(await confirm({
                                    title: t('page.deleteTitle'),
                                    message: t('page.deleteConfirm', { name: s.name }),
                                    confirmText: t('common:actions.delete'),
                                    severity: 'warning',
                                  }))
                                ) {
                                  return;
                                }
                                remove.mutate(s.id);
                              }}
                            >
                              {t('common:actions.delete')}
                            </Button>
                          </>
                        )}
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableScroll>
        )}
      </Paper>

      {editor.open && (
        <SegmentEditorDialog
          open
          segment={editor.segment}
          onClose={() => {
            setEditor({ open: false, segment: null });
            queryClient.invalidateQueries({ queryKey: ['segments'] });
          }}
        />
      )}

      <Dialog open={previewFor !== null} onClose={() => setPreviewFor(null)}>
        <DialogTitle>{t('page.previewTitle', { name: previewFor?.name })}</DialogTitle>
        <DialogContent>
          {preview.isLoading ? (
            <Skeleton variant="rectangular" height={120} />
          ) : preview.isError ? (
            <Alert severity="error">{t('page.previewFailed')}</Alert>
          ) : (
            <Stack spacing={2} sx={{ minWidth: 320 }}>
              <Typography variant="body2">
                {t('editor.previewCount', { count: preview.data?.count ?? 0 })}
              </Typography>
              {(preview.data?.sample.length ?? 0) > 0 && (
                <List dense>
                  {preview.data!.sample.map((g) => (
                    <ListItem key={g.id} disablePadding>
                      <ListItemText primary={g.name} secondary={t('page.guestNumber', { id: g.id })} />
                    </ListItem>
                  ))}
                </List>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPreviewFor(null)}>{t('common:actions.close')}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default SegmentsPage;

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
import { useConfirm } from '../../../components/common/ConfirmProvider';
import { useAuth } from '../../../auth/AuthContext';
import { formatHotelDate } from '../../../utils/date';
import { SegmentsApi } from '../api';
import { segmentFieldMeta, NO_VALUE_OPS } from '../constants';
import type { SegmentCondition, SegmentSummary } from '../types';
import { SegmentEditorDialog } from '../components/SegmentEditorDialog';

/** "country is Malaysia · total stays at least 3" — one line per condition. */
const describeCondition = (c: SegmentCondition): string => {
  const field = segmentFieldMeta(c.field)?.label ?? c.field;
  const op = segmentFieldMeta(c.field)?.ops.find((o) => o.op === c.op)?.label ?? c.op;
  if (NO_VALUE_OPS.has(c.op)) return `${field} ${op}`;
  const value = Array.isArray(c.value) ? c.value.join(', ') : String(c.value ?? '');
  return `${field} ${op} ${value}`;
};

const describeRules = (s: SegmentSummary): string =>
  s.rules.groups
    .map((g) => g.conditions.map(describeCondition).join(' · '))
    .join('  OR  ');

const SegmentsPage = () => {
  const { hasPermission } = useAuth();
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
    onError: (e) => setError(e instanceof Error ? e.message : 'Update failed'),
  });

  const remove = useMutation({
    mutationFn: (id: number) => SegmentsApi.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['segments'] }),
    onError: (e) => setError(e instanceof Error ? e.message : 'Delete failed'),
  });

  return (
    <Box>
      <PageHeader
        kicker="Revenue · Marketing"
        title="Guest segments"
        subtitle="Dynamic rule-based audiences — evaluated live, never stored. Attach a segment to an email campaign to narrow its audience."
        actions={
          canManage ? (
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setEditor({ open: true, segment: null })}
            >
              New segment
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
            label="Search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <TextField
            select
            size="small"
            label="Status"
            value={activeFilter}
            onChange={(e) => setActiveFilter(e.target.value as typeof activeFilter)}
            sx={{ minWidth: 140 }}
          >
            <MenuItem value="all">All</MenuItem>
            <MenuItem value="active">Active</MenuItem>
            <MenuItem value="inactive">Inactive</MenuItem>
          </TextField>
        </Stack>
        {segments.isLoading ? (
          <Skeleton variant="rectangular" height={200} />
        ) : (segments.data?.items.length ?? 0) === 0 ? (
          <EmptyState
            title="No segments"
            description="Create a segment to target email campaigns at a dynamic guest audience."
          />
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Rules</TableCell>
                <TableCell>Members</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Updated</TableCell>
                <TableCell align="right">Actions</TableCell>
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
                      {describeRules(s)}
                    </Typography>
                  </TableCell>
                  <TableCell>{s.member_count}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={s.is_active ? 'Active' : 'Inactive'}
                      color={s.is_active ? 'success' : 'default'}
                    />
                  </TableCell>
                  <TableCell>{formatHotelDate(s.updated_at)}</TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                      <Button size="small" onClick={() => setPreviewFor(s)}>
                        Preview
                      </Button>
                      {canManage && (
                        <>
                          <Button
                            size="small"
                            onClick={() => setEditor({ open: true, segment: s })}
                          >
                            Edit
                          </Button>
                          <Button
                            size="small"
                            onClick={() => toggleActive.mutate(s)}
                            disabled={toggleActive.isPending}
                          >
                            {s.is_active ? 'Deactivate' : 'Activate'}
                          </Button>
                          <Button
                            size="small"
                            color="error"
                            disabled={remove.isPending}
                            onClick={async () => {
                              if (
                                !(await confirm({
                                  title: 'Delete segment',
                                  message: `Delete “${s.name}”? Campaigns using it keep their audience — deactivate instead if unsure.`,
                                  confirmText: 'Delete',
                                  severity: 'warning',
                                }))
                              ) {
                                return;
                              }
                              remove.mutate(s.id);
                            }}
                          >
                            Delete
                          </Button>
                        </>
                      )}
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
        <DialogTitle>Preview — {previewFor?.name}</DialogTitle>
        <DialogContent>
          {preview.isLoading ? (
            <Skeleton variant="rectangular" height={120} />
          ) : preview.isError ? (
            <Alert severity="error">Preview failed to load.</Alert>
          ) : (
            <Stack spacing={2} sx={{ minWidth: 320 }}>
              <Typography variant="body2">
                <strong>{preview.data?.count ?? 0}</strong> active guests match
              </Typography>
              {(preview.data?.sample.length ?? 0) > 0 && (
                <List dense>
                  {preview.data!.sample.map((g) => (
                    <ListItem key={g.id} disablePadding>
                      <ListItemText primary={g.name} secondary={`Guest #${g.id}`} />
                    </ListItem>
                  ))}
                </List>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPreviewFor(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default SegmentsPage;

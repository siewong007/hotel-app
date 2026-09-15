import { useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useTranslation } from '../../../i18n/useTranslation';
import { SegmentsApi } from '../api';
import { hasUsableRules } from '../constants';
import type { GuestSegment, SegmentInput, SegmentRules } from '../types';
import { SegmentRuleBuilder } from './SegmentRuleBuilder';

interface SegmentEditorDialogProps {
  open: boolean;
  segment: GuestSegment | null;
  onClose: () => void;
}

export function SegmentEditorDialog({ open, segment, onClose }: SegmentEditorDialogProps) {
  const { t } = useTranslation('segments');
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<SegmentInput>(() => ({
    name: segment?.name ?? '',
    description: segment?.description ?? '',
    rules: segment?.rules ?? {
      groups: [{ conditions: [{ field: 'country', op: 'eq', value: '' }] }],
    },
    is_active: segment?.is_active ?? true,
  }));
  const [previewCount, setPreviewCount] = useState<number | null>(null);

  const fieldOptions = useQuery({
    queryKey: ['segments', 'field-options'],
    queryFn: () => SegmentsApi.fieldOptions(),
    enabled: open,
    staleTime: 60_000,
  });

  const save = useMutation({
    mutationFn: (input: SegmentInput) =>
      segment === null ? SegmentsApi.create(input) : SegmentsApi.update(segment.id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['segments'] });
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : t('editor.saveFailed')),
  });

  const preview = useMutation({
    mutationFn: (rules: SegmentRules) => SegmentsApi.previewRules(rules),
    onSuccess: (p) => setPreviewCount(p.count),
    onError: (e) => {
      setPreviewCount(null);
      setError(e instanceof Error ? e.message : t('editor.previewFailed'));
    },
  });

  const rulesValid = hasUsableRules(form.rules);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>{segment === null ? t('editor.titleNew') : t('editor.titleEdit', { name: segment.name })}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && (
            <Alert severity="error" onClose={() => setError(null)}>
              {error}
            </Alert>
          )}
          <TextField
            label={t('common:field.name')}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            fullWidth
            required
          />
          <TextField
            label={t('common:field.description')}
            value={form.description ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            fullWidth
          />
          <FormControlLabel
            control={
              <Switch
                checked={form.is_active ?? true}
                onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
              />
            }
            label={t('editor.activeLabel')}
          />
          <Typography variant="subtitle2">
            {t('editor.rulesExplainer')}
          </Typography>
          <SegmentRuleBuilder
            rules={form.rules}
            fieldOptions={fieldOptions.data}
            onChange={(rules) => {
              setPreviewCount(null);
              setForm((f) => ({ ...f, rules }));
            }}
          />
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
            <Button
              variant="outlined"
              size="small"
              disabled={!rulesValid || preview.isPending}
              onClick={() => {
                setError(null);
                preview.mutate(form.rules);
              }}
            >
              {t('editor.previewMembers')}
            </Button>
            {previewCount !== null && (
              <Typography variant="body2">
                <strong>{previewCount}</strong> {t('editor.activeGuestsMatch')}
              </Typography>
            )}
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common:actions.close')}</Button>
        <Button
          variant="contained"
          disabled={save.isPending || !form.name.trim() || !rulesValid}
          onClick={() => {
            setError(null);
            save.mutate(form);
          }}
        >
          {t('common:actions.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

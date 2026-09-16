import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { statusLabel, useTranslation } from '../../../i18n';
import { formatStatusLabel } from '../../../utils/formatters';
import { useIsPhone } from '../../../hooks/useIsPhone';
import { LogoLoader } from '../../../components';
import { MobileCardRow } from '../../../components/data-table/MobileCardRow';
import { TableScroll } from '../../../components/data-table/TableScroll';
import { PromotionsApi } from '../../promotions/api/promotionsApi';
import { SegmentsApi } from '../../segments/api';
import { CommunicationsApi } from '../api';
import type {
  CampaignInput,
  EmailCampaign,
  EmailTemplate,
  PreviewResponse,
  TemplateInput,
} from '../types';

const STATUS_COLORS: Record<string, 'default' | 'info' | 'warning' | 'success' | 'error'> = {
  draft: 'default',
  scheduled: 'info',
  running: 'warning',
  completed: 'success',
  cancelled: 'default',
  failed: 'error',
};

function useErrorText() {
  const { t } = useTranslation('communications');
  const [error, setError] = useState<string | null>(null);
  const capture = (e: unknown) =>
    setError(e instanceof Error ? e.message : t('errors:api.server_error'));
  return { error, setError, capture };
}

const EMPTY_CAMPAIGN: CampaignInput = {
  name: '',
  campaign_type: 'announcement',
  subject: '',
  body_html: '',
  promotion_id: null,
  template_id: null,
  segment_id: null,
};

function CampaignDialog({
  open,
  initial,
  campaignId,
  onClose,
}: {
  open: boolean;
  initial: CampaignInput;
  campaignId: number | null;
  onClose: () => void;
}) {
  const { t } = useTranslation('communications');
  const queryClient = useQueryClient();
  const { error, setError, capture } = useErrorText();
  const [form, setForm] = useState<CampaignInput>(initial);
  const promotions = useQuery({
    queryKey: ['communications', 'campaign-promotion-options'],
    queryFn: () =>
      PromotionsApi.listAdmin({
        page: 1,
        page_size: 100,
        status: 'live',
      }),
    enabled: open && form.campaign_type === 'promotion',
  });
  const segments = useQuery({
    queryKey: ['segments', 'campaign-options'],
    queryFn: () => SegmentsApi.list({ is_active: true, page_size: 100 }),
    enabled: open,
  });
  const audience = useQuery({
    queryKey: ['communications', 'audience', form.campaign_type, form.segment_id],
    queryFn: () => CommunicationsApi.audienceCount(form.campaign_type, form.segment_id),
    enabled: open,
  });
  const save = useMutation({
    mutationFn: (input: CampaignInput) =>
      campaignId === null
        ? CommunicationsApi.createCampaign(input)
        : CommunicationsApi.updateCampaign(campaignId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['communications', 'campaigns'] });
      onClose();
    },
    onError: capture,
  });
  const set = (patch: Partial<CampaignInput>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>{campaignId === null ? t('campaigns.new') : t('campaigns.edit')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label={t('campaigns.name')}
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
            fullWidth
          />
          <TextField
            select
            label={t('campaigns.type')}
            value={form.campaign_type}
            onChange={(e) =>
              set({
                campaign_type: e.target.value as CampaignInput['campaign_type'],
                promotion_id: null,
              })
            }
          >
            <MenuItem value="announcement">{t('campaigns.types.announcement')}</MenuItem>
            <MenuItem value="promotion">{t('campaigns.types.promotion')}</MenuItem>
          </TextField>
          {form.campaign_type === 'promotion' && (
            <TextField
              select
              label={t('campaigns.publishedPromotion')}
              value={form.promotion_id ?? ''}
              onChange={(e) =>
                set({ promotion_id: e.target.value ? Number(e.target.value) : null })
              }
              helperText={
                promotions.isError
                  ? t('campaigns.promotionsLoadFailed')
                  : t('campaigns.promotionHelp')
              }
              disabled={promotions.isLoading || promotions.isError}
              required
            >
              {promotions.isLoading ? (
                <MenuItem value="" disabled>
                  {t('campaigns.promotionsLoading')}
                </MenuItem>
              ) : null}
              {!promotions.isLoading && (promotions.data?.items.length ?? 0) === 0 ? (
                <MenuItem value="" disabled>
                  {t('campaigns.noPublishedPromotions')}
                </MenuItem>
              ) : null}
              {(promotions.data?.items ?? []).map((promotion) => (
                <MenuItem key={promotion.id} value={promotion.id}>
                  {promotion.name}
                </MenuItem>
              ))}
            </TextField>
          )}
          <TextField
            select
            label={t('campaigns.segment')}
            value={form.segment_id ?? ''}
            onChange={(e) =>
              set({ segment_id: e.target.value ? Number(e.target.value) : null })
            }
            helperText={
              segments.isError
                ? t('campaigns.segmentsLoadFailed')
                : form.segment_id
                  ? t('campaigns.segmentScopedHelp')
                  : t('campaigns.segmentAllHelp')
            }
            disabled={segments.isLoading || segments.isError}
          >
            <MenuItem value="">{t('campaigns.allEligibleGuests')}</MenuItem>
            {(segments.data?.items ?? []).map((s) => (
              <MenuItem key={s.id} value={s.id}>
                {s.name}
              </MenuItem>
            ))}
          </TextField>
          {audience.data && (
            <Alert severity="info" icon={false} sx={{ py: 0.5 }}>
              {t('campaigns.audienceLabel')} <strong>{audience.data.eligible}</strong>{' '}
              {t('campaigns.audienceEligible')}
              {form.segment_id
                ? t('campaigns.audienceOutsideSegment', { count: audience.data.excluded_segment })
                : ''}
            </Alert>
          )}
          <TextField
            label={t('campaigns.subject')}
            value={form.subject}
            onChange={(e) => set({ subject: e.target.value })}
            fullWidth
          />
          <TextField
            label={t('campaigns.bodyHtml')}
            value={form.body_html}
            onChange={(e) => set({ body_html: e.target.value })}
            fullWidth
            multiline
            minRows={8}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common:actions.close')}</Button>
        <Button
          variant="contained"
          disabled={
            save.isPending ||
            (form.campaign_type === 'promotion' &&
              (form.promotion_id == null || promotions.isLoading || promotions.isError))
          }
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

function CampaignsTab() {
  const { t, tOr } = useTranslation('communications');
  const isPhone = useIsPhone();
  const queryClient = useQueryClient();
  const { error, setError, capture } = useErrorText();
  const [editor, setEditor] = useState<{ id: number | null; input: CampaignInput } | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [deliveriesFor, setDeliveriesFor] = useState<EmailCampaign | null>(null);
  const [testSendFor, setTestSendFor] = useState<EmailCampaign | null>(null);
  const [testEmail, setTestEmail] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const campaigns = useQuery({
    queryKey: ['communications', 'campaigns'],
    queryFn: () => CommunicationsApi.listCampaigns({ page_size: 50 }),
  });
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['communications', 'campaigns'] });

  const act = useMutation({
    mutationFn: async ({
      action,
      campaign,
    }: {
      action: 'schedule' | 'cancel' | 'preview';
      campaign: EmailCampaign;
    }) => {
      if (action === 'schedule') return CommunicationsApi.scheduleCampaign(campaign.id);
      if (action === 'cancel') return CommunicationsApi.cancelCampaign(campaign.id);
      const p = await CommunicationsApi.previewCampaign(campaign.id);
      setPreview(p);
      return campaign;
    },
    onSuccess: invalidate,
    onError: capture,
  });

  const testSend = useMutation({
    mutationFn: () =>
      CommunicationsApi.testSendCampaign(testSendFor!.id, testEmail),
    onSuccess: () => {
      setNotice(t('campaigns.testSent'));
      setTestSendFor(null);
    },
    onError: capture,
  });

  const deliveries = useQuery({
    queryKey: ['communications', 'deliveries', deliveriesFor?.id],
    queryFn: () => CommunicationsApi.listDeliveries(deliveriesFor!.id),
    enabled: deliveriesFor !== null,
  });

  if (campaigns.isLoading) return <LogoLoader variant="page" />;

  return (
    <Box>
      <Stack
        direction="row"
        sx={{
          justifyContent: "space-between",
          mb: 2
        }}>
        <Typography variant="h6">{t('campaigns.title')}</Typography>
        <Button
          variant="contained"
          onClick={() => setEditor({ id: null, input: EMPTY_CAMPAIGN })}
        >
          {t('campaigns.new')}
        </Button>
      </Stack>
      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {notice && (
        <Alert severity="success" onClose={() => setNotice(null)} sx={{ mb: 2 }}>
          {notice}
        </Alert>
      )}
      {isPhone ? (
        <Box>
          {(campaigns.data?.items ?? []).map((c) => (
            <Box
              key={c.id}
              sx={{ borderBottom: '1px solid', borderColor: 'divider' }}
            >
              <MobileCardRow
                title={c.name}
                subtitle={t('campaigns.rowSubtitle', {
                  type: tOr(`campaigns.types.${c.campaign_type}`, formatStatusLabel(c.campaign_type)),
                  count: c.total_recipients,
                })}
                meta={t('campaigns.rowMeta', {
                  sent: c.sent_count,
                  failed: c.failed_count,
                })}
                status={
                  <Chip size="small" label={statusLabel(t, 'campaign', c.status)} color={STATUS_COLORS[c.status] ?? 'default'} />
                }
                footer={
                  <>
                    {c.status === 'draft' && (
                      <>
                        <Button
                          size="small"
                          onClick={() =>
                            setEditor({
                              id: c.id,
                              input: {
                                name: c.name,
                                campaign_type: c.campaign_type,
                                subject: c.subject,
                                body_html: c.body_html,
                                body_text: c.body_text,
                                template_id: c.template_id,
                                promotion_id: c.promotion_id,
                                segment_id: c.segment_id,
                              },
                            })
                          }
                        >
                          {t('common:actions.edit')}
                        </Button>
                        <Button size="small" onClick={() => setTestSendFor(c)}>
                          {t('campaigns.testSend')}
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => act.mutate({ action: 'schedule', campaign: c })}
                        >
                          {t('campaigns.send')}
                        </Button>
                      </>
                    )}
                    {(c.status === 'scheduled' || c.status === 'running') && (
                      <Button
                        size="small"
                        color="error"
                        onClick={() => act.mutate({ action: 'cancel', campaign: c })}
                      >
                        {t('common:actions.cancel')}
                      </Button>
                    )}
                    <Button size="small" onClick={() => act.mutate({ action: 'preview', campaign: c })}>
                      {t('campaigns.preview')}
                    </Button>
                    <Button size="small" onClick={() => setDeliveriesFor(c)}>
                      {t('campaigns.deliveries')}
                    </Button>
                  </>
                }
              />
            </Box>
          ))}
        </Box>
      ) : (
      <TableScroll>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('campaigns.colName')}</TableCell>
              <TableCell>{t('campaigns.colType')}</TableCell>
              <TableCell>{t('campaigns.colStatus')}</TableCell>
              <TableCell>{t('campaigns.colRecipients')}</TableCell>
              <TableCell>{t('campaigns.colSentFailed')}</TableCell>
              <TableCell align="right">{t('campaigns.colActions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(campaigns.data?.items ?? []).map((c) => (
              <TableRow key={c.id} hover>
                <TableCell>{c.name}</TableCell>
                <TableCell>
                  {tOr(`campaigns.types.${c.campaign_type}`, formatStatusLabel(c.campaign_type))}
                </TableCell>
                <TableCell>
                  <Chip size="small" label={statusLabel(t, 'campaign', c.status)} color={STATUS_COLORS[c.status] ?? 'default'} />
                </TableCell>
                <TableCell>{c.total_recipients}</TableCell>
                <TableCell>
                  {c.sent_count} / {c.failed_count}
                </TableCell>
                <TableCell align="right">
                  <Stack direction="row" spacing={1} sx={{
                    justifyContent: "flex-end"
                  }}>
                    {c.status === 'draft' && (
                      <>
                        <Button
                          size="small"
                          onClick={() =>
                            setEditor({
                              id: c.id,
                              input: {
                                name: c.name,
                                campaign_type: c.campaign_type,
                                subject: c.subject,
                                body_html: c.body_html,
                                body_text: c.body_text,
                                template_id: c.template_id,
                                promotion_id: c.promotion_id,
                                segment_id: c.segment_id,
                              },
                            })
                          }
                        >
                          {t('common:actions.edit')}
                        </Button>
                        <Button
                          size="small"
                          onClick={() => setTestSendFor(c)}
                        >
                          {t('campaigns.testSend')}
                        </Button>
                        <Tooltip title={t('campaigns.sendTooltip')}>
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={() => act.mutate({ action: 'schedule', campaign: c })}
                          >
                            {t('campaigns.send')}
                          </Button>
                        </Tooltip>
                      </>
                    )}
                    {(c.status === 'scheduled' || c.status === 'running') && (
                      <Button
                        size="small"
                        color="error"
                        onClick={() => act.mutate({ action: 'cancel', campaign: c })}
                      >
                        {t('common:actions.cancel')}
                      </Button>
                    )}
                    <Button size="small" onClick={() => act.mutate({ action: 'preview', campaign: c })}>
                      {t('campaigns.preview')}
                    </Button>
                    <Button size="small" onClick={() => setDeliveriesFor(c)}>
                      {t('campaigns.deliveries')}
                    </Button>
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableScroll>
      )}
      {editor && (
        <CampaignDialog
          open
          campaignId={editor.id}
          initial={editor.input}
          onClose={() => {
            setEditor(null);
            invalidate();
          }}
        />
      )}
      <Dialog open={preview !== null} onClose={() => setPreview(null)} fullWidth maxWidth="md">
        <DialogTitle>{t('campaigns.previewTitle', { subject: preview?.subject ?? '' })}</DialogTitle>
        <DialogContent>
          {preview && (
            <Stack spacing={2}>
              <Alert severity="info">
                {t('campaigns.previewAudience', {
                  eligible: preview.audience.eligible,
                  noEmail: preview.audience.excluded_no_email,
                  inactive: preview.audience.excluded_inactive,
                  unsubscribed: preview.audience.excluded_unsubscribed,
                  suppressed: preview.audience.excluded_suppressed,
                  segment:
                    preview.audience.excluded_segment > 0
                      ? t('campaigns.previewAudienceSegment', { count: preview.audience.excluded_segment })
                      : '',
                })}
              </Alert>
              <Box
                sx={{ border: '1px solid', borderColor: 'divider', p: 2, borderRadius: 1 }}
                // Rendered preview of staff-authored campaign HTML.
                dangerouslySetInnerHTML={{ __html: preview.body_html }}
              />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPreview(null)}>{t('common:actions.close')}</Button>
        </DialogActions>
      </Dialog>
      <Dialog open={testSendFor !== null} onClose={() => setTestSendFor(null)}>
        <DialogTitle>{t('campaigns.testSendTitle')}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            type="email"
            label={t('campaigns.recipientEmail')}
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
            fullWidth
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTestSendFor(null)}>{t('common:actions.close')}</Button>
          <Button
            variant="contained"
            disabled={testSend.isPending || !testEmail}
            onClick={() => testSend.mutate()}
          >
            {t('campaigns.sendTest')}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={deliveriesFor !== null}
        onClose={() => setDeliveriesFor(null)}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle>{t('campaigns.deliveriesTitle', { name: deliveriesFor?.name ?? '' })}</DialogTitle>
        <DialogContent>
          {isPhone ? (
            <Box>
              {(deliveries.data?.items ?? []).map((d) => (
                <Box
                  key={d.id}
                  sx={{ borderBottom: '1px solid', borderColor: 'divider' }}
                >
                  <MobileCardRow
                    title={d.recipient_masked}
                    subtitle={t('campaigns.deliverySubtitle', {
                      count: d.attempts,
                      error: d.last_error ? ` · ${d.last_error}` : '',
                    })}
                    status={<Chip size="small" variant="outlined" label={statusLabel(t, 'email_delivery', d.status)} />}
                  />
                </Box>
              ))}
            </Box>
          ) : (
          <TableScroll>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('campaigns.colRecipient')}</TableCell>
                  <TableCell>{t('campaigns.colStatus')}</TableCell>
                  <TableCell>{t('campaigns.colAttempts')}</TableCell>
                  <TableCell>{t('campaigns.colLastError')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(deliveries.data?.items ?? []).map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>{d.recipient_masked}</TableCell>
                    <TableCell>{statusLabel(t, 'email_delivery', d.status)}</TableCell>
                    <TableCell>{d.attempts}</TableCell>
                    <TableCell>{d.last_error ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableScroll>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeliveriesFor(null)}>{t('common:actions.close')}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

const EMPTY_TEMPLATE: TemplateInput = {
  code: '',
  name: '',
  subject: '',
  body_html: '',
  variables: [],
};

function TemplatesTab() {
  const { t } = useTranslation('communications');
  const isPhone = useIsPhone();
  const queryClient = useQueryClient();
  const { error, setError, capture } = useErrorText();
  const [editor, setEditor] = useState<{ id: number | null; input: TemplateInput } | null>(null);
  const templates = useQuery({
    queryKey: ['communications', 'templates'],
    queryFn: () => CommunicationsApi.listTemplates(),
  });
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['communications', 'templates'] });
  const save = useMutation({
    mutationFn: ({ id, input }: { id: number | null; input: TemplateInput }) =>
      id === null
        ? CommunicationsApi.createTemplate(input)
        : CommunicationsApi.updateTemplate(id, input),
    onSuccess: () => {
      invalidate();
      setEditor(null);
    },
    onError: capture,
  });
  const deactivate = useMutation({
    mutationFn: (id: number) => CommunicationsApi.deactivateTemplate(id),
    onSuccess: invalidate,
    onError: capture,
  });

  return (
    <Box>
      <Stack
        direction="row"
        sx={{
          justifyContent: "space-between",
          mb: 2
        }}>
        <Typography variant="h6">{t('templates.title')}</Typography>
        <Button variant="contained" onClick={() => setEditor({ id: null, input: EMPTY_TEMPLATE })}>
          {t('templates.new')}
        </Button>
      </Stack>
      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {isPhone ? (
        <Box>
          {(templates.data ?? []).map((tpl: EmailTemplate) => (
            <Box
              key={tpl.id}
              sx={{ borderBottom: '1px solid', borderColor: 'divider' }}
            >
              <MobileCardRow
                title={tpl.name}
                subtitle={tpl.code}
                meta={
                  tpl.variables.length
                    ? t('templates.variablesLine', { vars: tpl.variables.join(', ') })
                    : t('templates.noVariables')
                }
                status={
                  <Chip
                    size="small"
                    variant="outlined"
                    label={tpl.is_active ? t('templates.active') : t('templates.inactive')}
                    color={tpl.is_active ? 'success' : 'default'}
                  />
                }
                footer={
                  <>
                    <Button
                      size="small"
                      onClick={() =>
                        setEditor({
                          id: tpl.id,
                          input: {
                            code: tpl.code,
                            name: tpl.name,
                            subject: tpl.subject,
                            body_html: tpl.body_html,
                            body_text: tpl.body_text,
                            variables: tpl.variables,
                            is_active: tpl.is_active,
                          },
                        })
                      }
                    >
                      {t('common:actions.edit')}
                    </Button>
                    {tpl.is_active && (
                      <Button size="small" color="error" onClick={() => deactivate.mutate(tpl.id)}>
                        {t('templates.deactivate')}
                      </Button>
                    )}
                  </>
                }
              />
            </Box>
          ))}
        </Box>
      ) : (
      <TableScroll>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('templates.colCode')}</TableCell>
              <TableCell>{t('templates.colName')}</TableCell>
              <TableCell>{t('templates.colVariables')}</TableCell>
              <TableCell>{t('templates.colActive')}</TableCell>
              <TableCell align="right">{t('templates.colActions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(templates.data ?? []).map((tpl: EmailTemplate) => (
              <TableRow key={tpl.id} hover>
                <TableCell>{tpl.code}</TableCell>
                <TableCell>{tpl.name}</TableCell>
                <TableCell>{tpl.variables.join(', ') || '—'}</TableCell>
                <TableCell>{tpl.is_active ? t('common:actions.yes') : t('common:actions.no')}</TableCell>
                <TableCell align="right">
                  <Button
                    size="small"
                    onClick={() =>
                      setEditor({
                        id: tpl.id,
                        input: {
                          code: tpl.code,
                          name: tpl.name,
                          subject: tpl.subject,
                          body_html: tpl.body_html,
                          body_text: tpl.body_text,
                          variables: tpl.variables,
                          is_active: tpl.is_active,
                        },
                      })
                    }
                  >
                    {t('common:actions.edit')}
                  </Button>
                  {tpl.is_active && (
                    <Button size="small" color="error" onClick={() => deactivate.mutate(tpl.id)}>
                      {t('templates.deactivate')}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableScroll>
      )}
      {editor && (
        <Dialog open onClose={() => setEditor(null)} fullWidth maxWidth="md">
          <DialogTitle>{editor.id === null ? t('templates.new') : t('templates.edit')}</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField
                label={t('templates.colCode')}
                value={editor.input.code}
                onChange={(e) =>
                  setEditor({ ...editor, input: { ...editor.input, code: e.target.value } })
                }
                helperText={t('templates.codeHelp')}
              />
              <TextField
                label={t('templates.colName')}
                value={editor.input.name}
                onChange={(e) =>
                  setEditor({ ...editor, input: { ...editor.input, name: e.target.value } })
                }
              />
              <TextField
                label={t('templates.subject')}
                value={editor.input.subject}
                onChange={(e) =>
                  setEditor({ ...editor, input: { ...editor.input, subject: e.target.value } })
                }
              />
              <TextField
                label={t('templates.variables')}
                value={(editor.input.variables ?? []).join(', ')}
                onChange={(e) =>
                  setEditor({
                    ...editor,
                    input: {
                      ...editor.input,
                      variables: e.target.value
                        .split(',')
                        .map((v) => v.trim())
                        .filter(Boolean),
                    },
                  })
                }
                helperText={t('templates.variablesHelp')}
              />
              <TextField
                label={t('campaigns.bodyHtml')}
                value={editor.input.body_html}
                onChange={(e) =>
                  setEditor({ ...editor, input: { ...editor.input, body_html: e.target.value } })
                }
                multiline
                minRows={8}
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setEditor(null)}>{t('common:actions.close')}</Button>
            <Button
              variant="contained"
              disabled={save.isPending}
              onClick={() => {
                setError(null);
                save.mutate({ id: editor.id, input: editor.input });
              }}
            >
              {t('common:actions.save')}
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Box>
  );
}

function SuppressionsTab() {
  const { t, tOr } = useTranslation('communications');
  const isPhone = useIsPhone();
  const queryClient = useQueryClient();
  const { error, setError, capture } = useErrorText();
  const [email, setEmail] = useState('');
  const suppressions = useQuery({
    queryKey: ['communications', 'suppressions'],
    queryFn: () => CommunicationsApi.listSuppressions(),
  });
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['communications', 'suppressions'] });
  const add = useMutation({
    mutationFn: () => CommunicationsApi.addSuppression({ email, reason: 'manual' }),
    onSuccess: () => {
      setEmail('');
      invalidate();
    },
    onError: capture,
  });
  const remove = useMutation({
    mutationFn: (target: string) => CommunicationsApi.removeSuppression(target),
    onSuccess: invalidate,
    onError: capture,
  });

  return (
    <Box>
      <Typography variant="h6" sx={{ mb: 1 }}>
        {t('suppressions.title')}
      </Typography>
      <Typography
        variant="body2"
        sx={{
          color: "text.secondary",
          mb: 2
        }}>
        {t('suppressions.description')}
      </Typography>
      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
        <TextField
          size="small"
          type="email"
          label={t('suppressions.emailLabel')}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Button variant="outlined" disabled={!email || add.isPending} onClick={() => add.mutate()}>
          {t('suppressions.suppress')}
        </Button>
      </Stack>
      {isPhone ? (
        <Box>
          {(suppressions.data?.items ?? []).map((s) => (
            <Box
              key={s.id}
              sx={{ borderBottom: '1px solid', borderColor: 'divider' }}
            >
              <MobileCardRow
                title={s.email}
                subtitle={t('suppressions.rowSubtitle', {
                  reason: tOr(`suppressions.reasons.${s.reason}`, formatStatusLabel(s.reason)),
                  source: s.source
                    ? ` · ${tOr(`suppressions.sources.${s.source}`, formatStatusLabel(s.source))}`
                    : '',
                })}
                footer={
                  <Button size="small" color="error" onClick={() => remove.mutate(s.email)}>
                    {t('suppressions.remove')}
                  </Button>
                }
              />
            </Box>
          ))}
        </Box>
      ) : (
      <TableScroll>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('suppressions.colEmail')}</TableCell>
              <TableCell>{t('suppressions.colReason')}</TableCell>
              <TableCell>{t('suppressions.colSource')}</TableCell>
              <TableCell align="right">{t('suppressions.colActions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(suppressions.data?.items ?? []).map((s) => (
              <TableRow key={s.id}>
                <TableCell>{s.email}</TableCell>
                <TableCell>{tOr(`suppressions.reasons.${s.reason}`, formatStatusLabel(s.reason))}</TableCell>
                <TableCell>
                  {s.source
                    ? tOr(`suppressions.sources.${s.source}`, formatStatusLabel(s.source))
                    : '—'}
                </TableCell>
                <TableCell align="right">
                  <Button size="small" color="error" onClick={() => remove.mutate(s.email)}>
                    {t('suppressions.remove')}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableScroll>
      )}
    </Box>
  );
}

export default function CommunicationsPage() {
  const { t } = useTranslation('communications');
  const [tab, setTab] = useState(0);
  const tabs = useMemo(
    () => [
      { label: t('tabs.campaigns'), node: <CampaignsTab /> },
      { label: t('tabs.templates'), node: <TemplatesTab /> },
      { label: t('tabs.suppressions'), node: <SuppressionsTab /> },
    ],
    [t]
  );
  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h5" sx={{ mb: 2 }}>
        {t('pageTitle')}
      </Typography>
      {/* Scrollable: five tabs need ~415px and the narrowest supported
          viewport is 320px, where the last tab rendered outside the page. */}
      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
        sx={{ mb: 3 }}
      >
        {tabs.map((t) => (
          <Tab key={t.label} label={t.label} />
        ))}
      </Tabs>
      {tabs[tab].node}
    </Box>
  );
}

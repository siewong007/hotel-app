import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
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
import { PromotionsApi } from '../../promotions/api/promotionsApi';
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
  const [error, setError] = useState<string | null>(null);
  const capture = (e: unknown) =>
    setError(e instanceof Error ? e.message : 'Request failed');
  return { error, setError, capture };
}

const EMPTY_CAMPAIGN: CampaignInput = {
  name: '',
  campaign_type: 'announcement',
  subject: '',
  body_html: '',
  promotion_id: null,
  template_id: null,
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
  const queryClient = useQueryClient();
  const { error, setError, capture } = useErrorText();
  const [form, setForm] = useState<CampaignInput>(initial);
  const promotions = useQuery({
    queryKey: ['communications', 'campaign-promotion-options'],
    queryFn: () =>
      PromotionsApi.listAdmin({
        page: 1,
        page_size: 100,
        status: 'published',
      }),
    enabled: open && form.campaign_type === 'promotion',
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
      <DialogTitle>{campaignId === null ? 'New campaign' : 'Edit campaign'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label="Name"
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
            fullWidth
          />
          <TextField
            select
            label="Type"
            value={form.campaign_type}
            onChange={(e) =>
              set({
                campaign_type: e.target.value as CampaignInput['campaign_type'],
                promotion_id: null,
              })
            }
          >
            <MenuItem value="announcement">Announcement</MenuItem>
            <MenuItem value="promotion">Promotion</MenuItem>
          </TextField>
          {form.campaign_type === 'promotion' && (
            <TextField
              select
              label="Published promotion"
              value={form.promotion_id ?? ''}
              onChange={(e) =>
                set({ promotion_id: e.target.value ? Number(e.target.value) : null })
              }
              helperText={
                promotions.isError
                  ? 'Published promotions could not be loaded'
                  : 'Choose the offer this campaign advertises'
              }
              disabled={promotions.isLoading || promotions.isError}
              required
            >
              {promotions.isLoading ? (
                <MenuItem value="" disabled>
                  Loading promotions…
                </MenuItem>
              ) : null}
              {!promotions.isLoading && (promotions.data?.items.length ?? 0) === 0 ? (
                <MenuItem value="" disabled>
                  No published promotions available
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
            label="Subject"
            value={form.subject}
            onChange={(e) => set({ subject: e.target.value })}
            fullWidth
          />
          <TextField
            label="Body (HTML)"
            value={form.body_html}
            onChange={(e) => set({ body_html: e.target.value })}
            fullWidth
            multiline
            minRows={8}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
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
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function CampaignsTab() {
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
      setNotice('Test email sent.');
      setTestSendFor(null);
    },
    onError: capture,
  });

  const deliveries = useQuery({
    queryKey: ['communications', 'deliveries', deliveriesFor?.id],
    queryFn: () => CommunicationsApi.listDeliveries(deliveriesFor!.id),
    enabled: deliveriesFor !== null,
  });

  if (campaigns.isLoading) return <CircularProgress sx={{ m: 4 }} />;

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" sx={{ mb: 2 }}>
        <Typography variant="h6">Campaigns</Typography>
        <Button
          variant="contained"
          onClick={() => setEditor({ id: null, input: EMPTY_CAMPAIGN })}
        >
          New campaign
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
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Name</TableCell>
            <TableCell>Type</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Recipients</TableCell>
            <TableCell>Sent / Failed</TableCell>
            <TableCell align="right">Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {(campaigns.data?.items ?? []).map((c) => (
            <TableRow key={c.id} hover>
              <TableCell>{c.name}</TableCell>
              <TableCell>{c.campaign_type}</TableCell>
              <TableCell>
                <Chip size="small" label={c.status} color={STATUS_COLORS[c.status] ?? 'default'} />
              </TableCell>
              <TableCell>{c.total_recipients}</TableCell>
              <TableCell>
                {c.sent_count} / {c.failed_count}
              </TableCell>
              <TableCell align="right">
                <Stack direction="row" spacing={1} justifyContent="flex-end">
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
                            },
                          })
                        }
                      >
                        Edit
                      </Button>
                      <Button
                        size="small"
                        onClick={() => setTestSendFor(c)}
                      >
                        Test send
                      </Button>
                      <Tooltip title="Queues the campaign for sending to all eligible subscribers">
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => act.mutate({ action: 'schedule', campaign: c })}
                        >
                          Send
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
                      Cancel
                    </Button>
                  )}
                  <Button size="small" onClick={() => act.mutate({ action: 'preview', campaign: c })}>
                    Preview
                  </Button>
                  <Button size="small" onClick={() => setDeliveriesFor(c)}>
                    Deliveries
                  </Button>
                </Stack>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

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
        <DialogTitle>Preview — {preview?.subject}</DialogTitle>
        <DialogContent>
          {preview && (
            <Stack spacing={2}>
              <Alert severity="info">
                Eligible recipients: <strong>{preview.audience.eligible}</strong> (excluded — no
                email: {preview.audience.excluded_no_email}, inactive:{' '}
                {preview.audience.excluded_inactive}, unsubscribed:{' '}
                {preview.audience.excluded_unsubscribed}, suppressed:{' '}
                {preview.audience.excluded_suppressed})
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
          <Button onClick={() => setPreview(null)}>Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={testSendFor !== null} onClose={() => setTestSendFor(null)}>
        <DialogTitle>Send test email</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            label="Recipient email"
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
            fullWidth
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTestSendFor(null)}>Close</Button>
          <Button
            variant="contained"
            disabled={testSend.isPending || !testEmail}
            onClick={() => testSend.mutate()}
          >
            Send test
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={deliveriesFor !== null}
        onClose={() => setDeliveriesFor(null)}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle>Deliveries — {deliveriesFor?.name}</DialogTitle>
        <DialogContent>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Recipient</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Attempts</TableCell>
                <TableCell>Last error</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(deliveries.data?.items ?? []).map((d) => (
                <TableRow key={d.id}>
                  <TableCell>{d.recipient_masked}</TableCell>
                  <TableCell>{d.status}</TableCell>
                  <TableCell>{d.attempts}</TableCell>
                  <TableCell>{d.last_error ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeliveriesFor(null)}>Close</Button>
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
      <Stack direction="row" justifyContent="space-between" sx={{ mb: 2 }}>
        <Typography variant="h6">Email templates</Typography>
        <Button variant="contained" onClick={() => setEditor({ id: null, input: EMPTY_TEMPLATE })}>
          New template
        </Button>
      </Stack>
      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Code</TableCell>
            <TableCell>Name</TableCell>
            <TableCell>Variables</TableCell>
            <TableCell>Active</TableCell>
            <TableCell align="right">Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {(templates.data ?? []).map((t: EmailTemplate) => (
            <TableRow key={t.id} hover>
              <TableCell>{t.code}</TableCell>
              <TableCell>{t.name}</TableCell>
              <TableCell>{t.variables.join(', ') || '—'}</TableCell>
              <TableCell>{t.is_active ? 'Yes' : 'No'}</TableCell>
              <TableCell align="right">
                <Button
                  size="small"
                  onClick={() =>
                    setEditor({
                      id: t.id,
                      input: {
                        code: t.code,
                        name: t.name,
                        subject: t.subject,
                        body_html: t.body_html,
                        body_text: t.body_text,
                        variables: t.variables,
                        is_active: t.is_active,
                      },
                    })
                  }
                >
                  Edit
                </Button>
                {t.is_active && (
                  <Button size="small" color="error" onClick={() => deactivate.mutate(t.id)}>
                    Deactivate
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {editor && (
        <Dialog open onClose={() => setEditor(null)} fullWidth maxWidth="md">
          <DialogTitle>{editor.id === null ? 'New template' : 'Edit template'}</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField
                label="Code"
                value={editor.input.code}
                onChange={(e) =>
                  setEditor({ ...editor, input: { ...editor.input, code: e.target.value } })
                }
                helperText="lowercase_with_underscores"
              />
              <TextField
                label="Name"
                value={editor.input.name}
                onChange={(e) =>
                  setEditor({ ...editor, input: { ...editor.input, name: e.target.value } })
                }
              />
              <TextField
                label="Subject"
                value={editor.input.subject}
                onChange={(e) =>
                  setEditor({ ...editor, input: { ...editor.input, subject: e.target.value } })
                }
              />
              <TextField
                label="Allowed variables (comma-separated)"
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
                helperText="Reference them in the body as {{variable}}; values are always HTML-escaped"
              />
              <TextField
                label="Body (HTML)"
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
            <Button onClick={() => setEditor(null)}>Close</Button>
            <Button
              variant="contained"
              disabled={save.isPending}
              onClick={() => {
                setError(null);
                save.mutate({ id: editor.id, input: editor.input });
              }}
            >
              Save
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Box>
  );
}

function SuppressionsTab() {
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
        Suppression list
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Addresses here never receive marketing email, regardless of subscriptions.
      </Typography>
      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
        <TextField
          size="small"
          label="Email to suppress"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Button variant="outlined" disabled={!email || add.isPending} onClick={() => add.mutate()}>
          Suppress
        </Button>
      </Stack>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Email</TableCell>
            <TableCell>Reason</TableCell>
            <TableCell>Source</TableCell>
            <TableCell align="right">Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {(suppressions.data?.items ?? []).map((s) => (
            <TableRow key={s.id}>
              <TableCell>{s.email}</TableCell>
              <TableCell>{s.reason}</TableCell>
              <TableCell>{s.source ?? '—'}</TableCell>
              <TableCell align="right">
                <Button size="small" color="error" onClick={() => remove.mutate(s.email)}>
                  Remove
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}

export default function CommunicationsPage() {
  const [tab, setTab] = useState(0);
  const tabs = useMemo(
    () => [
      { label: 'Campaigns', node: <CampaignsTab /> },
      { label: 'Templates', node: <TemplatesTab /> },
      { label: 'Suppressions', node: <SuppressionsTab /> },
    ],
    []
  );
  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h5" sx={{ mb: 2 }}>
        Communications
      </Typography>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 3 }}>
        {tabs.map((t) => (
          <Tab key={t.label} label={t.label} />
        ))}
      </Tabs>
      {tabs[tab].node}
    </Box>
  );
}

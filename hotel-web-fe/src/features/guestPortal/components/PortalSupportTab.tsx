import { useEffect, useMemo, useState } from 'react';
import { formatStatusLabel } from '../../../utils/formatters';
import AddCommentOutlinedIcon from '@mui/icons-material/AddCommentOutlined';
import ArrowBackOutlinedIcon from '@mui/icons-material/ArrowBackOutlined';
import ReplayOutlinedIcon from '@mui/icons-material/ReplayOutlined';
import SendOutlinedIcon from '@mui/icons-material/SendOutlined';
import SupportAgentOutlinedIcon from '@mui/icons-material/SupportAgentOutlined';
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
  Divider,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import type { ChipProps } from '@mui/material';
import {
  useCreatePortalSupportConversation,
  usePortalSupportConversation,
  usePortalSupportConversations,
  usePortalSupportRealtime,
  useReopenPortalSupportConversation,
  useSendPortalSupportMessage,
  newPortalSupportClientId,
} from '../hooks/usePortalSupport';
import {
  PORTAL_SUPPORT_CATEGORIES,
  type CreatePortalSupportConversationRequest,
  type PortalSupportCategory,
  type PortalSupportConversation,
  type PortalSupportConversationDetail,
  type PortalSupportConversationId,
  type PortalSupportMessage,
  type PortalSupportStatus,
} from '../support/types';
import { guestErrorMessage } from '../utils/feedback';
import { useTranslation, type TranslationVars } from '../../../i18n';
import { useAutoFocusError } from '../../../hooks/useAutoFocusError';

const MAX_MESSAGE_LENGTH = 4_000;

type Translate = (key: string, vars?: TranslationVars) => string;

const STATUS_KEYS: Record<PortalSupportStatus, string> = {
  waiting_for_staff: 'support.status.waiting_for_staff',
  waiting_for_guest: 'support.status.waiting_for_guest',
  resolved: 'support.status.resolved',
  closed: 'support.status.closed',
};

const CATEGORY_KEYS: Record<PortalSupportCategory, string> = {
  booking: 'support.categories.booking',
  stay: 'support.categories.stay',
  billing: 'support.categories.billing',
  loyalty: 'support.categories.loyalty',
  technical: 'support.categories.technical',
  other: 'support.categories.other',
};

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function supportCategoryLabel(category: PortalSupportCategory | string, t: Translate): string {
  const key = CATEGORY_KEYS[category as PortalSupportCategory];
  return key ? t(key) : category;
}

function supportStatusLabel(status: PortalSupportStatus | string, t: Translate): string {
  const key = STATUS_KEYS[status as PortalSupportStatus];
  return key ? t(key) : formatStatusLabel(status);
}

function supportStatusColor(status: PortalSupportStatus): ChipProps['color'] {
  switch (status) {
    case 'waiting_for_staff':
      return 'warning';
    case 'waiting_for_guest':
      return 'info';
    case 'resolved':
      return 'success';
    case 'closed':
    default:
      return 'default';
  }
}

function sameConversationId(
  left: PortalSupportConversationId | null,
  right: PortalSupportConversationId,
): boolean {
  return left !== null && String(left) === String(right);
}

interface NewConversationDialogProps {
  open: boolean;
  isSubmitting: boolean;
  categories: PortalSupportCategory[];
  onClose: () => void;
  onSubmit: (request: CreatePortalSupportConversationRequest) => Promise<void>;
}

function NewConversationDialog({ open, isSubmitting, categories, onClose, onSubmit }: NewConversationDialogProps) {
  const { t } = useTranslation('guestPortal');
  const [category, setCategory] = useState<PortalSupportCategory>('booking');
  const [message, setMessage] = useState('');
  const [clientRequestId, setClientRequestId] = useState(() => newPortalSupportClientId());
  const [error, setError] = useState<string | null>(null);
  const errorRef = useAutoFocusError(error);

  useEffect(() => {
    if (!categories.includes(category)) {
      setCategory(categories[0] ?? 'other');
    }
  }, [categories, category]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedMessage = message.trim();

    if (!trimmedMessage) {
      setError(t('support.newDialog.emptyMessage'));
      return;
    }

    try {
      setError(null);
      await onSubmit({ category, message: trimmedMessage, client_request_id: clientRequestId });
      setCategory('booking');
      setMessage('');
      setClientRequestId(newPortalSupportClientId());
    } catch (submitError) {
      setError(guestErrorMessage(submitError, t('support.newDialog.createFailed')));
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      setError(null);
      setClientRequestId(newPortalSupportClientId());
      onClose();
    }
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      fullWidth
      maxWidth="sm"
      aria-describedby="support-conversation-safety-note"
      slotProps={{
        paper: { sx: { borderRadius: 3 } }
      }}
    >
      <Box component="form" onSubmit={handleSubmit}>
        <DialogTitle sx={{ pb: 1 }}>{t('support.newDialog.title')}</DialogTitle>
        <DialogContent sx={{ pt: '12px !important' }}>
          <Alert id="support-conversation-safety-note" severity="warning" sx={{ mb: 3 }}>
            {t('support.newDialog.safetyNote')}
          </Alert>

          {error && <Alert severity="error" role="alert" ref={errorRef} tabIndex={-1} sx={{ mb: 2 }}>{error}</Alert>}

          <TextField
            select
            fullWidth
            label={t('support.newDialog.categoryLabel')}
            value={category}
            onChange={event => setCategory(event.target.value as PortalSupportCategory)}
            disabled={isSubmitting}
            sx={{ mb: 2 }}
            slotProps={{
              select: { native: true }
            }}
          >
            {PORTAL_SUPPORT_CATEGORIES.filter(option => categories.includes(option.value)).map(option => (
              <option key={option.value} value={option.value}>
                {t(CATEGORY_KEYS[option.value])}
              </option>
            ))}
          </TextField>

          <TextField
            autoFocus
            fullWidth
            multiline
            minRows={5}
            label={t('support.newDialog.messageLabel')}
            placeholder={t('support.newDialog.messagePlaceholder')}
            value={message}
            onChange={event => setMessage(event.target.value)}
            helperText={`${message.length}/${MAX_MESSAGE_LENGTH}`}
            disabled={isSubmitting}
            slotProps={{
              htmlInput: { maxLength: MAX_MESSAGE_LENGTH }
            }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3, gap: 1 }}>
          <Button onClick={handleClose} disabled={isSubmitting} sx={{ minHeight: 44 }}>{t('common:actions.cancel')}</Button>
          <Button type="submit" variant="contained" disabled={isSubmitting} sx={{ minHeight: 44 }} startIcon={isSubmitting ? <CircularProgress size={18} color="inherit" /> : <SendOutlinedIcon />}>
            {t('support.newDialog.send')}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

function ConversationListItem({
  conversation,
  selected,
  onSelect,
}: {
  conversation: PortalSupportConversation;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation('guestPortal');
  const title = conversation.subject?.trim() || supportCategoryLabel(conversation.category, t);

  return (
    <ListItemButton selected={selected} onClick={onSelect} alignItems="flex-start" sx={{ minHeight: 76, py: 1.5, px: 2, transition: 'background-color 160ms ease', '@media (prefers-reduced-motion: reduce)': { transition: 'none' } }}>
      <ListItemText
        primary={title}
        secondary={
          <Stack component="span" direction="row" spacing={0.75} sx={{ mt: 0.75, alignItems: 'center', flexWrap: 'wrap' }}>
            <Chip
              component="span"
              label={supportStatusLabel(conversation.status, t)}
              color={supportStatusColor(conversation.status)}
              size="small"
            />
            <Typography component="span" variant="caption" sx={{
              color: "text.secondary"
            }}>
              {t('support.updatedAt', {
                date: formatDateTime(conversation.last_activity_at || conversation.updated_at),
              })}
            </Typography>
          </Stack>
        }
        slotProps={{
          primary: { noWrap: true, sx: { fontWeight: selected ? 700 : 500 } }
        }}
      />
    </ListItemButton>
  );
}

function MessageBubble({ message }: { message: PortalSupportMessage }) {
  const { t } = useTranslation('guestPortal');
  const isGuest = message.author_type === 'guest';
  const isSystem = message.author_type === 'system';

  if (isSystem) {
    return (
      <Box sx={{ textAlign: 'center', my: 1.5 }}>
        <Typography variant="caption" sx={{
          color: "text.secondary"
        }}>
          {message.body} · {formatDateTime(message.created_at)}
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', justifyContent: isGuest ? 'flex-end' : 'flex-start', mb: 1.5 }}>
      <Box
        sx={theme => ({
          maxWidth: '82%',
          px: 1.5,
          py: 1,
          borderRadius: 2,
          bgcolor: isGuest ? theme.palette.primary.main : 'var(--hotel-surface-raised)',
          color: isGuest ? theme.palette.primary.contrastText : theme.palette.text.primary,
          wordBreak: 'break-word',
        })}
      >
        <Typography variant="caption" sx={{ display: 'block', opacity: 0.8, mb: 0.25 }}>
          {isGuest ? t('support.you') : t('support.hotelSupport')}
        </Typography>
        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
          {message.body}
        </Typography>
        <Typography variant="caption" sx={{ display: 'block', opacity: 0.75, mt: 0.5, textAlign: 'right' }}>
          {formatDateTime(message.created_at)}
        </Typography>
      </Box>
    </Box>
  );
}

function ConversationDetail({
  detail,
  isLoading,
  error,
  onRetry,
  onSend,
  isSending,
  onReopen,
  isReopening,
  onBack,
  onNewConversation,
  canStartConversation,
}: {
  detail: PortalSupportConversationDetail | undefined;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  onSend: (message: string, expectedVersion: number, clientMessageId: string) => Promise<void>;
  isSending: boolean;
  onReopen: () => Promise<void>;
  isReopening: boolean;
  onBack: () => void;
  onNewConversation: () => void;
  canStartConversation: boolean;
}) {
  const { t } = useTranslation('guestPortal');
  const [message, setMessage] = useState('');
  const [clientMessageId, setClientMessageId] = useState(() => newPortalSupportClientId());
  const [sendError, setSendError] = useState<string | null>(null);
  const sendErrorRef = useAutoFocusError(sendError);

  useEffect(() => {
    setMessage('');
    setClientMessageId(newPortalSupportClientId());
    setSendError(null);
  }, [detail?.conversation.id]);

  const mobileNavigation = (
    <Stack
      direction="row"
      sx={{
        justifyContent: "space-between",
        alignItems: "center",
        display: { xs: 'flex', md: 'none' },
        px: 1,
        py: 0.5,
        borderBottom: 1,
        borderColor: 'divider'
      }}>
      <Button startIcon={<ArrowBackOutlinedIcon />} onClick={onBack} sx={{ minHeight: 44 }}>
        {t('support.backToConversations')}
      </Button>
      <Button onClick={onNewConversation} disabled={!canStartConversation} sx={{ minHeight: 44 }}>
        {t('support.new')}
      </Button>
    </Stack>
  );

  if (isLoading) {
    return (
      <Box>
        {mobileNavigation}
        <Box sx={{ display: 'grid', placeItems: 'center', minHeight: 320 }}>
          <CircularProgress />
        </Box>
      </Box>
    );
  }

  if (error) {
    return (
      <Box>
        {mobileNavigation}
        <Box sx={{ p: 3 }}>
          <Alert severity="error" role="alert" action={<Button color="inherit" size="small" onClick={onRetry}>{t('common:actions.retry')}</Button>}>
            {guestErrorMessage(error, t('support.detailLoadFailed'))}
          </Alert>
        </Box>
      </Box>
    );
  }

  if (!detail) {
    return (
      <Box>
        {mobileNavigation}
        <Box sx={{ display: 'grid', placeItems: 'center', minHeight: 320, textAlign: 'center', p: 3 }}>
          <Box>
            <SupportAgentOutlinedIcon color="primary" sx={{ fontSize: 42, mb: 1 }} />
            <Typography variant="h6">{t('support.selectConversation')}</Typography>
            <Typography sx={{
              color: "text.secondary"
            }}>{t('support.selectConversationHint')}</Typography>
          </Box>
        </Box>
      </Box>
    );
  }

  const { conversation, messages } = detail;
  const canReply = conversation.status === 'waiting_for_staff' || conversation.status === 'waiting_for_guest';
  const canReopen = conversation.status === 'resolved' && conversation.can_reopen;

  const handleSend = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedMessage = message.trim();
    if (!trimmedMessage) return;

    try {
      setSendError(null);
      await onSend(trimmedMessage, conversation.version, clientMessageId);
      setMessage('');
      setClientMessageId(newPortalSupportClientId());
    } catch (submitError) {
      setSendError(guestErrorMessage(submitError, t('support.sendFailed')));
    }
  };

  const handleReopen = async () => {
    try {
      setSendError(null);
      await onReopen();
    } catch (reopenError) {
      setSendError(guestErrorMessage(reopenError, t('support.reopenFailed')));
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: { xs: 'calc(100dvh - 172px)', md: 540 }, bgcolor: 'var(--hotel-surface-raised)' }}>
      <Box sx={{ px: { xs: 2, md: 3 }, py: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Box sx={{ mx: { xs: -1, md: 0 }, mt: { xs: -1.5, md: 0 }, mb: { xs: 1, md: 0 } }}>{mobileNavigation}</Box>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1}
          sx={{
            justifyContent: "space-between",
            alignItems: { sm: 'center' }
          }}>
          <Box>
            <Typography variant="h6">{conversation.subject?.trim() || supportCategoryLabel(conversation.category, t)}</Typography>
            <Typography variant="body2" sx={{
              color: "text.secondary"
            }}>
              {t('support.startedAt', { date: formatDateTime(conversation.created_at) })}
            </Typography>
          </Box>
          <Chip label={supportStatusLabel(conversation.status, t)} color={supportStatusColor(conversation.status)} size="small" />
        </Stack>
      </Box>
      <Box role="log" aria-live="polite" aria-label={t('support.messagesAria')} sx={{ flex: 1, overflowY: 'auto', p: { xs: 2, md: 3 }, bgcolor: 'var(--hotel-surface-sunken)' }}>
        {conversation.resolution_summary ? (
          <Alert severity="success" sx={{ mb: 2 }}>
            <Typography variant="subtitle2">{t('support.resolution')}</Typography>
            {conversation.resolution_summary}
          </Alert>
        ) : null}
        {messages.map(messageItem => <MessageBubble key={String(messageItem.id)} message={messageItem} />)}
      </Box>
      <Divider />
      <Box sx={{ p: { xs: 2, md: 3 }, bgcolor: 'var(--hotel-surface-raised)', position: { xs: 'sticky', md: 'static' }, bottom: 0, pb: { xs: 'max(16px, env(safe-area-inset-bottom))', md: 3 }, boxShadow: { xs: 'var(--hotel-shadow-md)', md: 'none' } }}>
        {sendError && <Alert severity="error" role="alert" ref={sendErrorRef} tabIndex={-1} sx={{ mb: 1.5 }} onClose={() => setSendError(null)}>{sendError}</Alert>}

        {canReply && (
          <Box component="form" onSubmit={handleSend}>
            <TextField
              fullWidth
              multiline
              minRows={3}
              label={t('support.replyLabel')}
              placeholder={t('support.replyPlaceholder')}
              value={message}
              onChange={event => setMessage(event.target.value)}
              helperText={`${message.length}/${MAX_MESSAGE_LENGTH}`}
              disabled={isSending}
              slotProps={{
                htmlInput: { maxLength: MAX_MESSAGE_LENGTH }
              }}
            />
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1.5 }}>
              <Button type="submit" variant="contained" disabled={isSending || !message.trim()} sx={{ minHeight: 44 }} startIcon={isSending ? <CircularProgress size={18} color="inherit" /> : <SendOutlinedIcon />}>
                {t('support.sendReply')}
              </Button>
            </Box>
          </Box>
        )}

        {canReopen && (
          <Alert
            severity="success"
            action={
              <Button color="inherit" size="small" onClick={handleReopen} disabled={isReopening} sx={{ minHeight: 44 }} startIcon={isReopening ? <CircularProgress size={16} color="inherit" /> : <ReplayOutlinedIcon />}>
                {t('support.reopen')}
              </Button>
            }
          >
            {t('support.reopenHint')}
          </Alert>
        )}

        {conversation.status === 'resolved' && !conversation.can_reopen && (
          <Alert severity="info">{t('support.resolvedNoReopen')}</Alert>
        )}

        {conversation.status === 'closed' && (
          <Alert severity="info">{t('support.closedNotice')}</Alert>
        )}
      </Box>
    </Box>
  );
}

export function PortalSupportTab({ token }: { token: string }) {
  const { t } = useTranslation('guestPortal');
  const [newConversationOpen, setNewConversationOpen] = useState(false);
  const [selectedConversationId, setSelectedConversationId] = useState<PortalSupportConversationId | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
  usePortalSupportRealtime(token);
  const conversationsQuery = usePortalSupportConversations(token);
  const createConversation = useCreatePortalSupportConversation(token);
  const reopenConversation = useReopenPortalSupportConversation(token);
  const items = useMemo(() => conversationsQuery.data?.items ?? [], [conversationsQuery.data?.items]);
  const availableCategories = useMemo(() => {
    const configured = conversationsQuery.data?.categories;
    if (!configured?.length) return PORTAL_SUPPORT_CATEGORIES.map(option => option.value);
    return PORTAL_SUPPORT_CATEGORIES
      .map(option => option.value)
      .filter(category => configured.includes(category));
  }, [conversationsQuery.data?.categories]);
  const isSupportEnabled = conversationsQuery.data?.enabled ?? true;

  useEffect(() => {
    if (items.length === 0) {
      setSelectedConversationId(null);
      return;
    }

    const selectedStillExists = items.some(item => sameConversationId(selectedConversationId, item.id));
    if (!selectedStillExists) {
      setSelectedConversationId(items[0].id);
    }
  }, [items, selectedConversationId]);

  const detailQuery = usePortalSupportConversation(token, selectedConversationId);
  const sendMessage = useSendPortalSupportMessage(token);

  const handleCreate = async (request: CreatePortalSupportConversationRequest) => {
    const detail = await createConversation.mutateAsync(request);
    setSelectedConversationId(detail.conversation.id);
    setMobileDetailOpen(true);
    setNewConversationOpen(false);
  };

  const detail = detailQuery.data;

  return (
    <Box>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{
          justifyContent: "space-between",
          alignItems: { sm: 'center' },
          mb: 3
        }}>
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 700, color: 'var(--hotel-text)' }}>{t('support.title')}</Typography>
          <Typography
            variant="body2"
            sx={{
              color: "text.secondary",
              mt: 0.5
            }}>{t('support.subtitle')}</Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddCommentOutlinedIcon />}
          onClick={() => setNewConversationOpen(true)}
          disabled={!isSupportEnabled}
          sx={{ minHeight: 44, alignSelf: { xs: 'stretch', sm: 'auto' } }}
        >
          {t('support.newConversation')}
        </Button>
      </Stack>
      {!isSupportEnabled ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          {t('support.disabledNotice')}
        </Alert>
      ) : null}
      <Alert severity="warning" sx={{ mb: 3 }}>
        {t('support.emergencyNotice')}
      </Alert>
      {conversationsQuery.isLoading ? (
        <Box sx={{ display: 'grid', placeItems: 'center', minHeight: 280 }}><CircularProgress /></Box>
      ) : conversationsQuery.error ? (
        <Alert severity="error" role="alert" action={<Button color="inherit" size="small" onClick={() => void conversationsQuery.refetch()}>{t('common:actions.retry')}</Button>}>
          {guestErrorMessage(conversationsQuery.error, t('support.listLoadFailed'))}
        </Alert>
      ) : items.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
          <SupportAgentOutlinedIcon color="primary" sx={{ fontSize: 48, mb: 1 }} />
          <Typography variant="h6" gutterBottom>{t('support.emptyTitle')}</Typography>
          <Typography
            sx={{
              color: "text.secondary",
              mb: 2
            }}>{t('support.emptyBody')}</Typography>
          <Button variant="contained" onClick={() => setNewConversationOpen(true)} disabled={!isSupportEnabled}>{t('support.contactSupport')}</Button>
        </Paper>
      ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(280px, 34%) 1fr' }, gap: { xs: 0, md: 2 }, alignItems: 'stretch' }}>
          <Paper variant="outlined" sx={{ display: isDesktop || !mobileDetailOpen ? 'block' : 'none', maxHeight: { md: 640 }, overflowY: 'auto', borderRadius: { xs: 2, md: 3 }, borderColor: 'var(--hotel-border)', boxShadow: { md: 'var(--hotel-shadow-sm)' } }}>
            <Box sx={{ px: 2, pt: 2, pb: 1 }}><Typography variant="overline" sx={{ color: 'var(--hotel-primary-text)', fontWeight: 700, letterSpacing: '.1em' }}>{t('support.conversationsHeading')}</Typography></Box>
            <List disablePadding aria-label={t('support.listAria')}>
              {items.map((conversation, index) => (
                <Box key={String(conversation.id)}>
                  {index > 0 && <Divider component="li" />}
                  <ConversationListItem
                    conversation={conversation}
                    selected={sameConversationId(selectedConversationId, conversation.id)}
                    onSelect={() => { setSelectedConversationId(conversation.id); setMobileDetailOpen(true); }}
                  />
                </Box>
              ))}
            </List>
          </Paper>

          <Paper variant="outlined" sx={{ display: isDesktop || mobileDetailOpen ? 'block' : 'none', overflow: 'hidden', borderRadius: { xs: 2, md: 3 }, borderColor: 'var(--hotel-border)', boxShadow: { md: 'var(--hotel-shadow-sm)' }, transition: 'opacity 180ms ease', '@media (prefers-reduced-motion: reduce)': { transition: 'none' } }}>
            <ConversationDetail
              detail={detail}
              isLoading={detailQuery.isLoading}
              error={detailQuery.error}
              onRetry={() => void detailQuery.refetch()}
              onSend={async (message, expectedVersion, clientMessageId) => {
                if (!selectedConversationId) return;
                await sendMessage.mutateAsync({
                  conversationId: selectedConversationId,
                  message,
                  expectedVersion,
                  clientMessageId,
                });
              }}
              isSending={sendMessage.isPending}
              onReopen={async () => {
                if (!selectedConversationId) return;
                await reopenConversation.mutateAsync(selectedConversationId);
              }}
              isReopening={reopenConversation.isPending}
              onBack={() => setMobileDetailOpen(false)}
              onNewConversation={() => setNewConversationOpen(true)}
              canStartConversation={isSupportEnabled}
            />
          </Paper>
        </Box>
      )}
      <NewConversationDialog
        open={newConversationOpen}
        isSubmitting={createConversation.isPending}
        categories={availableCategories}
        onClose={() => setNewConversationOpen(false)}
        onSubmit={handleCreate}
      />
    </Box>
  );
}

export default PortalSupportTab;

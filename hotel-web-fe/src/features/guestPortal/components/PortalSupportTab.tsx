import { useEffect, useMemo, useState } from 'react';
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

const MAX_MESSAGE_LENGTH = 4_000;

const STATUS_LABELS: Record<PortalSupportStatus, string> = {
  waiting_for_staff: 'Waiting for support',
  waiting_for_guest: 'Waiting for your reply',
  resolved: 'Resolved',
  closed: 'Closed',
};

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

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

function supportCategoryLabel(category: PortalSupportCategory | string): string {
  return PORTAL_SUPPORT_CATEGORIES.find(option => option.value === category)?.label ?? category;
}

function supportStatusLabel(status: PortalSupportStatus | string): string {
  return STATUS_LABELS[status as PortalSupportStatus] ?? status.replace(/_/g, ' ');
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
  const [category, setCategory] = useState<PortalSupportCategory>('booking');
  const [message, setMessage] = useState('');
  const [clientRequestId, setClientRequestId] = useState(() => newPortalSupportClientId());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!categories.includes(category)) {
      setCategory(categories[0] ?? 'other');
    }
  }, [categories, category]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedMessage = message.trim();

    if (!trimmedMessage) {
      setError('Please describe how we can help.');
      return;
    }

    try {
      setError(null);
      await onSubmit({ category, message: trimmedMessage, client_request_id: clientRequestId });
      setCategory('booking');
      setMessage('');
      setClientRequestId(newPortalSupportClientId());
    } catch (submitError) {
      setError(getErrorMessage(submitError, 'We could not start this conversation. Please try again.'));
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
        <DialogTitle sx={{ pb: 1 }}>Contact hotel support</DialogTitle>
        <DialogContent sx={{ pt: '12px !important' }}>
          <Alert id="support-conversation-safety-note" severity="warning" sx={{ mb: 3 }}>
            This chat is not monitored for emergencies. If you are in immediate danger, contact local emergency services or the hotel front desk now.
          </Alert>

          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

          <TextField
            select
            fullWidth
            label="What do you need help with?"
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
                {option.label}
              </option>
            ))}
          </TextField>

          <TextField
            autoFocus
            fullWidth
            multiline
            minRows={5}
            label="How can we help?"
            placeholder="Please share the details. Do not include card or payment details."
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
          <Button onClick={handleClose} disabled={isSubmitting} sx={{ minHeight: 44 }}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={isSubmitting} sx={{ minHeight: 44 }} startIcon={isSubmitting ? <CircularProgress size={18} color="inherit" /> : <SendOutlinedIcon />}>
            Send message
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
  const title = conversation.subject?.trim() || supportCategoryLabel(conversation.category);

  return (
    <ListItemButton selected={selected} onClick={onSelect} alignItems="flex-start" sx={{ minHeight: 76, py: 1.5, px: 2, transition: 'background-color 160ms ease', '@media (prefers-reduced-motion: reduce)': { transition: 'none' } }}>
      <ListItemText
        primary={title}
        secondary={
          <Stack component="span" direction="row" spacing={0.75} sx={{ mt: 0.75, alignItems: 'center', flexWrap: 'wrap' }}>
            <Chip
              component="span"
              label={supportStatusLabel(conversation.status)}
              color={supportStatusColor(conversation.status)}
              size="small"
            />
            <Typography component="span" variant="caption" sx={{
              color: "text.secondary"
            }}>
              Updated {formatDateTime(conversation.last_activity_at || conversation.updated_at)}
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
          bgcolor: isGuest ? theme.palette.primary.main : theme.palette.grey[100],
          color: isGuest ? theme.palette.primary.contrastText : theme.palette.text.primary,
          wordBreak: 'break-word',
        })}
      >
        <Typography variant="caption" sx={{ display: 'block', opacity: 0.8, mb: 0.25 }}>
          {isGuest ? 'You' : 'Hotel support'}
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
  const [message, setMessage] = useState('');
  const [clientMessageId, setClientMessageId] = useState(() => newPortalSupportClientId());
  const [sendError, setSendError] = useState<string | null>(null);

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
        Back to conversations
      </Button>
      <Button onClick={onNewConversation} disabled={!canStartConversation} sx={{ minHeight: 44 }}>
        New
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
          <Alert severity="error" action={<Button color="inherit" size="small" onClick={onRetry}>Retry</Button>}>
            {getErrorMessage(error, 'We could not load this conversation.')}
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
            <Typography variant="h6">Select a conversation</Typography>
            <Typography sx={{
              color: "text.secondary"
            }}>Choose a support conversation to read or reply.</Typography>
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
      setSendError(getErrorMessage(submitError, 'We could not send your message. Please try again.'));
    }
  };

  const handleReopen = async () => {
    try {
      setSendError(null);
      await onReopen();
    } catch (reopenError) {
      setSendError(getErrorMessage(reopenError, 'We could not reopen this conversation. Please start a new one instead.'));
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: { xs: 'calc(100dvh - 172px)', md: 540 }, bgcolor: '#fffdf9' }}>
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
            <Typography variant="h6">{conversation.subject?.trim() || supportCategoryLabel(conversation.category)}</Typography>
            <Typography variant="body2" sx={{
              color: "text.secondary"
            }}>
              Started {formatDateTime(conversation.created_at)}
            </Typography>
          </Box>
          <Chip label={supportStatusLabel(conversation.status)} color={supportStatusColor(conversation.status)} size="small" />
        </Stack>
      </Box>
      <Box role="log" aria-live="polite" aria-label="Conversation messages" sx={{ flex: 1, overflowY: 'auto', p: { xs: 2, md: 3 }, bgcolor: '#f8f5ef' }}>
        {conversation.resolution_summary ? (
          <Alert severity="success" sx={{ mb: 2 }}>
            <Typography variant="subtitle2">Resolution</Typography>
            {conversation.resolution_summary}
          </Alert>
        ) : null}
        {messages.map(messageItem => <MessageBubble key={String(messageItem.id)} message={messageItem} />)}
      </Box>
      <Divider />
      <Box sx={{ p: { xs: 2, md: 3 }, bgcolor: '#fffdf9', position: { xs: 'sticky', md: 'static' }, bottom: 0, pb: { xs: 'max(16px, env(safe-area-inset-bottom))', md: 3 }, boxShadow: { xs: '0 -8px 24px rgba(6,17,14,.08)', md: 'none' } }}>
        {sendError && <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setSendError(null)}>{sendError}</Alert>}

        {canReply && (
          <Box component="form" onSubmit={handleSend}>
            <TextField
              fullWidth
              multiline
              minRows={3}
              label="Reply to hotel support"
              placeholder="Type your message"
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
                Send reply
              </Button>
            </Box>
          </Box>
        )}

        {canReopen && (
          <Alert
            severity="success"
            action={
              <Button color="inherit" size="small" onClick={handleReopen} disabled={isReopening} sx={{ minHeight: 44 }} startIcon={isReopening ? <CircularProgress size={16} color="inherit" /> : <ReplayOutlinedIcon />}>
                Reopen
              </Button>
            }
          >
            This conversation is resolved. Reopen it if you still need help.
          </Alert>
        )}

        {conversation.status === 'resolved' && !conversation.can_reopen && (
          <Alert severity="info">This resolved conversation can no longer be reopened. Please start a new conversation if you still need help.</Alert>
        )}

        {conversation.status === 'closed' && (
          <Alert severity="info">This conversation is closed. Please start a new conversation if you need further assistance.</Alert>
        )}
      </Box>
    </Box>
  );
}

export function PortalSupportTab({ token }: { token: string }) {
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
          <Typography variant="h6" sx={{ fontWeight: 700, color: '#06110e' }}>Message the hotel team</Typography>
          <Typography
            variant="body2"
            sx={{
              color: "text.secondary",
              mt: 0.5
            }}>Ask about your stay or account and keep every response together.</Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddCommentOutlinedIcon />}
          onClick={() => setNewConversationOpen(true)}
          disabled={!isSupportEnabled}
          sx={{ minHeight: 44, alignSelf: { xs: 'stretch', sm: 'auto' } }}
        >
          New conversation
        </Button>
      </Stack>
      {!isSupportEnabled ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          The hotel is not accepting new support conversations right now. You can still read existing conversations below.
        </Alert>
      ) : null}
      <Alert severity="warning" sx={{ mb: 3 }}>
        For an emergency, contact local emergency services or the hotel front desk. Support chat is not monitored for emergencies.
      </Alert>
      {conversationsQuery.isLoading ? (
        <Box sx={{ display: 'grid', placeItems: 'center', minHeight: 280 }}><CircularProgress /></Box>
      ) : conversationsQuery.error ? (
        <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => void conversationsQuery.refetch()}>Retry</Button>}>
          {getErrorMessage(conversationsQuery.error, 'We could not load your support conversations.')}
        </Alert>
      ) : items.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
          <SupportAgentOutlinedIcon color="primary" sx={{ fontSize: 48, mb: 1 }} />
          <Typography variant="h6" gutterBottom>No support conversations yet</Typography>
          <Typography
            sx={{
              color: "text.secondary",
              mb: 2
            }}>Start a conversation and the hotel team will get back to you here.</Typography>
          <Button variant="contained" onClick={() => setNewConversationOpen(true)} disabled={!isSupportEnabled}>Contact support</Button>
        </Paper>
      ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(280px, 34%) 1fr' }, gap: { xs: 0, md: 2 }, alignItems: 'stretch' }}>
          <Paper variant="outlined" sx={{ display: isDesktop || !mobileDetailOpen ? 'block' : 'none', maxHeight: { md: 640 }, overflowY: 'auto', borderRadius: { xs: 2, md: 3 }, borderColor: 'rgba(6,17,14,.14)', boxShadow: { md: '0 8px 24px rgba(6,17,14,.05)' } }}>
            <Box sx={{ px: 2, pt: 2, pb: 1 }}><Typography variant="overline" sx={{ color: '#8d6b30', fontWeight: 700, letterSpacing: '.1em' }}>Conversations</Typography></Box>
            <List disablePadding aria-label="Support conversations">
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

          <Paper variant="outlined" sx={{ display: isDesktop || mobileDetailOpen ? 'block' : 'none', overflow: 'hidden', borderRadius: { xs: 2, md: 3 }, borderColor: 'rgba(6,17,14,.14)', boxShadow: { md: '0 8px 24px rgba(6,17,14,.05)' }, transition: 'opacity 180ms ease', '@media (prefers-reduced-motion: reduce)': { transition: 'none' } }}>
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

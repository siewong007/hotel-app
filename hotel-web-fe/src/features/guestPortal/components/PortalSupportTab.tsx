import { useEffect, useMemo, useState } from 'react';
import AddCommentOutlinedIcon from '@mui/icons-material/AddCommentOutlined';
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
} from '@mui/material';
import type { ChipProps } from '@mui/material';
import {
  useCreatePortalSupportConversation,
  usePortalSupportConversation,
  usePortalSupportConversations,
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
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
      <Box component="form" onSubmit={handleSubmit}>
        <DialogTitle>Contact hotel support</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            This chat is not monitored for emergencies. If you are in immediate danger, contact local emergency services or the hotel front desk now.
          </Alert>

          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

          <TextField
            select
            fullWidth
            label="What do you need help with?"
            value={category}
            onChange={event => setCategory(event.target.value as PortalSupportCategory)}
            SelectProps={{ native: true }}
            disabled={isSubmitting}
            sx={{ mb: 2 }}
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
            inputProps={{ maxLength: MAX_MESSAGE_LENGTH }}
            helperText={`${message.length}/${MAX_MESSAGE_LENGTH}`}
            disabled={isSubmitting}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={handleClose} disabled={isSubmitting}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={isSubmitting} startIcon={isSubmitting ? <CircularProgress size={18} color="inherit" /> : <SendOutlinedIcon />}>
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
    <ListItemButton selected={selected} onClick={onSelect} alignItems="flex-start" sx={{ py: 1.5 }}>
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
            <Typography component="span" variant="caption" color="text.secondary">
              Updated {formatDateTime(conversation.last_activity_at || conversation.updated_at)}
            </Typography>
          </Stack>
        }
        primaryTypographyProps={{ noWrap: true, fontWeight: selected ? 700 : 500 }}
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
        <Typography variant="caption" color="text.secondary">
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
}: {
  detail: PortalSupportConversationDetail | undefined;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  onSend: (message: string, expectedVersion: number, clientMessageId: string) => Promise<void>;
  isSending: boolean;
  onReopen: () => Promise<void>;
  isReopening: boolean;
}) {
  const [message, setMessage] = useState('');
  const [clientMessageId, setClientMessageId] = useState(() => newPortalSupportClientId());
  const [sendError, setSendError] = useState<string | null>(null);

  useEffect(() => {
    setMessage('');
    setClientMessageId(newPortalSupportClientId());
    setSendError(null);
  }, [detail?.conversation.id]);

  if (isLoading) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', minHeight: 320 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error" action={<Button color="inherit" size="small" onClick={onRetry}>Retry</Button>}>
          {getErrorMessage(error, 'We could not load this conversation.')}
        </Alert>
      </Box>
    );
  }

  if (!detail) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', minHeight: 320, textAlign: 'center', p: 3 }}>
        <Box>
          <SupportAgentOutlinedIcon color="primary" sx={{ fontSize: 42, mb: 1 }} />
          <Typography variant="h6">Select a conversation</Typography>
          <Typography color="text.secondary">Choose a support conversation to read or reply.</Typography>
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
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: { xs: 430, md: 500 } }}>
      <Box sx={{ px: { xs: 2, md: 3 }, py: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="space-between" alignItems={{ sm: 'center' }}>
          <Box>
            <Typography variant="h6">{conversation.subject?.trim() || supportCategoryLabel(conversation.category)}</Typography>
            <Typography variant="body2" color="text.secondary">
              Started {formatDateTime(conversation.created_at)}
            </Typography>
          </Box>
          <Chip label={supportStatusLabel(conversation.status)} color={supportStatusColor(conversation.status)} size="small" />
        </Stack>
      </Box>

      <Box role="log" aria-live="polite" sx={{ flex: 1, overflowY: 'auto', p: { xs: 2, md: 3 }, bgcolor: 'background.default' }}>
        {conversation.resolution_summary ? (
          <Alert severity="success" sx={{ mb: 2 }}>
            <Typography variant="subtitle2">Resolution</Typography>
            {conversation.resolution_summary}
          </Alert>
        ) : null}
        {messages.map(messageItem => <MessageBubble key={String(messageItem.id)} message={messageItem} />)}
      </Box>

      <Divider />
      <Box sx={{ p: { xs: 2, md: 3 } }}>
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
              inputProps={{ maxLength: MAX_MESSAGE_LENGTH }}
              helperText={`${message.length}/${MAX_MESSAGE_LENGTH}`}
              disabled={isSending}
            />
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1.5 }}>
              <Button type="submit" variant="contained" disabled={isSending || !message.trim()} startIcon={isSending ? <CircularProgress size={18} color="inherit" /> : <SendOutlinedIcon />}>
                Send reply
              </Button>
            </Box>
          </Box>
        )}

        {canReopen && (
          <Alert
            severity="success"
            action={
              <Button color="inherit" size="small" onClick={handleReopen} disabled={isReopening} startIcon={isReopening ? <CircularProgress size={16} color="inherit" /> : <ReplayOutlinedIcon />}>
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
    setNewConversationOpen(false);
  };

  const detail = detailQuery.data;

  return (
    <Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="space-between" alignItems={{ sm: 'center' }} sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h5">Support &amp; Help</Typography>
          <Typography variant="body2" color="text.secondary">Message the hotel team about your stay or account.</Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddCommentOutlinedIcon />}
          onClick={() => setNewConversationOpen(true)}
          disabled={!isSupportEnabled}
        >
          New conversation
        </Button>
      </Stack>

      {!isSupportEnabled ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          The hotel is not accepting new support conversations right now. You can still read existing conversations below.
        </Alert>
      ) : null}

      <Alert severity="warning" sx={{ mb: 2 }}>
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
          <Typography color="text.secondary" sx={{ mb: 2 }}>Start a conversation and the hotel team will get back to you here.</Typography>
          <Button variant="contained" onClick={() => setNewConversationOpen(true)} disabled={!isSupportEnabled}>Contact support</Button>
        </Paper>
      ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(260px, 34%) 1fr' }, gap: 2, alignItems: 'stretch' }}>
          <Paper variant="outlined" sx={{ maxHeight: { md: 600 }, overflowY: 'auto' }}>
            <List disablePadding aria-label="Support conversations">
              {items.map((conversation, index) => (
                <Box key={String(conversation.id)}>
                  {index > 0 && <Divider component="li" />}
                  <ConversationListItem
                    conversation={conversation}
                    selected={sameConversationId(selectedConversationId, conversation.id)}
                    onSelect={() => setSelectedConversationId(conversation.id)}
                  />
                </Box>
              ))}
            </List>
          </Paper>

          <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
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

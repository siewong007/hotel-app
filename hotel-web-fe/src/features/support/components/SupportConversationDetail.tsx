import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import {
  AssignmentInd as ClaimIcon,
  CheckCircleOutline as ResolveIcon,
  Close as CloseIcon,
  EscalatorWarning as EscalateIcon,
  PersonAddAlt as AssignIcon,
  Reply as ReplyIcon,
  RestartAlt as ReopenIcon,
  StickyNote2Outlined as InternalNoteIcon,
} from '@mui/icons-material';
import { useMemo, useState } from 'react';
import { newSupportClientId } from '../api';
import type {
  SupportActionPayload,
  SupportAgent,
  SupportConversationDetailResponse,
  SupportEvent,
  SupportMessage,
  SupportPriority,
} from '../types';
import { SUPPORT_PRIORITY_OPTIONS } from '../types';
import {
  formatSupportDate,
  humanizeSupportValue,
  SupportPriorityChip,
  SupportSlaChip,
  SupportStatusChip,
} from './SupportStatusChip';

type ComposerMode = 'reply' | 'note';
type DialogMode = 'assign' | 'resolve' | 'escalate' | 'close' | 'reopen' | null;

type TimelineItem =
  | { type: 'message'; timestamp: string; value: SupportMessage }
  | { type: 'event'; timestamp: string; value: SupportEvent };

interface SupportConversationDetailProps {
  detail?: SupportConversationDetailResponse;
  isLoading: boolean;
  agents: SupportAgent[];
  currentUserId?: number;
  canWrite: boolean;
  canAssign: boolean;
  canEscalate: boolean;
  canManage: boolean;
  isBusy: boolean;
  onAction: (payload: SupportActionPayload) => Promise<void>;
  onSendMessage: (payload: { message: string; client_message_id: string; expected_version: number }) => Promise<void>;
}

function getTimelineItems(detail: SupportConversationDetailResponse): TimelineItem[] {
  return [
    ...detail.messages.map((value): TimelineItem => ({ type: 'message', timestamp: value.created_at, value })),
    ...detail.events.map((value): TimelineItem => ({ type: 'event', timestamp: value.created_at, value })),
  ].sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());
}

function messageLabel(message: SupportMessage): string {
  if (message.author_type === 'guest') return message.author_name || 'Guest';
  if (message.author_type === 'staff') return message.author_name || 'Hotel support';
  return message.author_name || 'System';
}

function eventLabel(event: SupportEvent): string {
  return event.event_type === 'internal_note' ? 'Internal note' : humanizeSupportValue(event.event_type);
}

export default function SupportConversationDetail({
  detail,
  isLoading,
  agents,
  currentUserId,
  canWrite,
  canAssign,
  canEscalate,
  canManage,
  isBusy,
  onAction,
  onSendMessage,
}: SupportConversationDetailProps) {
  const [composerMode, setComposerMode] = useState<ComposerMode>('reply');
  const [draft, setDraft] = useState('');
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [assigneeId, setAssigneeId] = useState<string>('');
  const [reason, setReason] = useState('');
  const [resolutionCode, setResolutionCode] = useState('');
  const [resolutionSummary, setResolutionSummary] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const conversation = detail?.conversation;
  const timeline = useMemo(() => detail ? getTimelineItems(detail) : [], [detail]);

  const resetDialog = () => {
    setDialogMode(null);
    setAssigneeId('');
    setReason('');
    setResolutionCode('');
    setResolutionSummary('');
  };

  const performAction = async (payload: Omit<SupportActionPayload, 'expected_version' | 'client_action_id'>) => {
    if (!conversation) return;

    setLocalError(null);
    try {
      await onAction({
        ...payload,
        expected_version: conversation.version,
        client_action_id: newSupportClientId(),
      });
      resetDialog();
      if (payload.action === 'add_internal_note') setDraft('');
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Unable to update this conversation');
    }
  };

  const handleComposerSubmit = async () => {
    if (!conversation || !draft.trim()) return;

    setLocalError(null);
    try {
      if (activeComposerMode === 'note') {
        await performAction({ action: 'add_internal_note', reason: draft.trim() });
        return;
      }

      await onSendMessage({
        message: draft.trim(),
        client_message_id: newSupportClientId(),
        expected_version: conversation.version,
      });
      setDraft('');
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Unable to send the reply');
    }
  };

  const handleDialogSubmit = () => {
    if (dialogMode === 'assign') {
      void performAction({
        action: 'assign',
        assignee_id: assigneeId ? Number(assigneeId) : null,
        reason: reason.trim() || undefined,
      });
      return;
    }

    if (dialogMode === 'resolve') {
      void performAction({
        action: 'resolve',
        resolution_code: resolutionCode.trim() || undefined,
        resolution_summary: resolutionSummary.trim() || undefined,
      });
      return;
    }

    if (dialogMode) {
      void performAction({ action: dialogMode, reason: reason.trim() || undefined });
    }
  };

  const handlePriorityChange = (priority: SupportPriority) => {
    if (!conversation || priority === conversation.priority) return;
    void performAction({ action: 'set_priority', priority });
  };

  if (isLoading) {
    return (
      <Stack alignItems="center" justifyContent="center" height="100%" minHeight={360} spacing={1}>
        <CircularProgress size={28} />
        <Typography variant="body2" color="text.secondary">Loading conversation…</Typography>
      </Stack>
    );
  }

  if (!conversation) {
    return (
      <Stack alignItems="center" justifyContent="center" height="100%" minHeight={360} spacing={0.5} sx={{ px: 3, textAlign: 'center' }}>
        <Typography variant="subtitle1">Select a conversation</Typography>
        <Typography variant="body2" color="text.secondary">
          Choose a conversation from the queue to view messages and actions.
        </Typography>
      </Stack>
    );
  }

  const isAssignedToCurrentUser = conversation.assigned_to_user_id === currentUserId;
  const isActive = ['waiting_for_staff', 'waiting_for_guest'].includes(conversation.status);
  const canWorkOnConversation = canManage || isAssignedToCurrentUser
    || (!conversation.assigned_to_user_id && canAssign);
  const canReply = canWrite
    && canWorkOnConversation
    && isActive;
  const canAddInternalNote = canWrite && (canManage || isAssignedToCurrentUser);
  const activeComposerMode = composerMode === 'note' && !canAddInternalNote ? 'reply' : composerMode;
  const canResolve = canWrite
    && (canManage || isAssignedToCurrentUser)
    && isActive;
  const canReopen = canManage && ['resolved', 'closed'].includes(conversation.status);
  const canClose = canManage && conversation.status === 'resolved';
  const canRelease = canAssign && Boolean(conversation.assigned_to_user_id)
    && (canManage || isAssignedToCurrentUser);

  return (
    <Stack height="100%" minHeight={0}>
      <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Stack spacing={1.25}>
          <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ sm: 'flex-start' }} justifyContent="space-between" gap={1}>
            <Box>
              <Typography variant="h6">{conversation.guest_name || 'Guest'}</Typography>
              <Typography variant="body2" color="text.secondary">
                {conversation.conversation_number} · {humanizeSupportValue(conversation.category)}
              </Typography>
            </Box>
            <Stack direction="row" gap={0.75} flexWrap="wrap" useFlexGap>
              <SupportStatusChip status={conversation.status} />
              <SupportPriorityChip priority={conversation.priority} />
              <SupportSlaChip
                isAtRisk={conversation.is_sla_at_risk}
                isBreached={conversation.is_sla_breached}
                dueAt={conversation.first_response_due_at ?? conversation.resolution_due_at}
              />
            </Stack>
          </Stack>

          <Stack direction="row" gap={1.5} flexWrap="wrap" useFlexGap>
            <Typography variant="caption" color="text.secondary">
              {conversation.booking_reference ? `Booking ${conversation.booking_reference}` : 'No linked booking'}
            </Typography>
            {conversation.room_number ? (
              <Typography variant="caption" color="text.secondary">Room {conversation.room_number}</Typography>
            ) : null}
            {conversation.stay_status ? (
              <Typography variant="caption" color="text.secondary">{humanizeSupportValue(conversation.stay_status)}</Typography>
            ) : null}
            <Typography variant="caption" color="text.secondary">
              {conversation.assigned_to_name ? `Assigned to ${conversation.assigned_to_name}` : 'Unassigned'}
            </Typography>
          </Stack>

          <Stack direction="row" gap={0.75} flexWrap="wrap" useFlexGap alignItems="center">
            {canAssign && !conversation.assigned_to_user_id && conversation.status !== 'closed' ? (
              <Button size="small" variant="outlined" startIcon={<ClaimIcon />} disabled={isBusy} onClick={() => void performAction({ action: 'claim' })}>
                Claim
              </Button>
            ) : null}
            {canAssign && isActive ? (
              <Button size="small" variant="outlined" startIcon={<AssignIcon />} disabled={isBusy} onClick={() => setDialogMode('assign')}>
                Assign
              </Button>
            ) : null}
            {canRelease && conversation.status !== 'closed' ? (
              <Button size="small" variant="text" disabled={isBusy} onClick={() => void performAction({ action: 'release' })}>
                Return to queue
              </Button>
            ) : null}
            {canManage && isActive ? (
              <FormControl size="small" sx={{ minWidth: 132 }}>
                <InputLabel id="support-priority-label">Priority</InputLabel>
                <Select
                  labelId="support-priority-label"
                  label="Priority"
                  value={conversation.priority}
                  disabled={isBusy}
                  onChange={(event) => handlePriorityChange(event.target.value as SupportPriority)}
                >
                  {SUPPORT_PRIORITY_OPTIONS.map(priority => (
                    <MenuItem key={priority} value={priority}>{humanizeSupportValue(priority)}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            ) : null}
            {canEscalate && isActive ? (
              <Button size="small" color="warning" variant="outlined" startIcon={<EscalateIcon />} disabled={isBusy} onClick={() => setDialogMode('escalate')}>
                Escalate
              </Button>
            ) : null}
            {canResolve ? (
              <Button size="small" color="success" variant="contained" startIcon={<ResolveIcon />} disabled={isBusy} onClick={() => setDialogMode('resolve')}>
                Resolve
              </Button>
            ) : null}
            {canClose ? (
              <Button size="small" variant="outlined" startIcon={<CloseIcon />} disabled={isBusy} onClick={() => setDialogMode('close')}>
                Close
              </Button>
            ) : null}
            {canReopen ? (
              <Button size="small" variant="outlined" startIcon={<ReopenIcon />} disabled={isBusy} onClick={() => setDialogMode('reopen')}>
                Reopen
              </Button>
            ) : null}
          </Stack>
        </Stack>
      </Box>

      <Box flex={1} minHeight={0} overflow="auto" sx={{ p: 2, bgcolor: 'background.default' }}>
        <Stack spacing={1.25}>
          {timeline.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 5 }}>
              No activity yet.
            </Typography>
          ) : timeline.map((item) => {
            if (item.type === 'event') {
              const isInternalNote = item.value.event_type === 'internal_note';
              return (
                <Paper
                  key={`event-${item.value.id}`}
                  variant="outlined"
                  sx={{ alignSelf: 'stretch', p: 1.25, bgcolor: isInternalNote ? 'warning.50' : 'action.hover' }}
                >
                  <Stack direction="row" justifyContent="space-between" gap={1}>
                    <Stack direction="row" gap={0.75} alignItems="center">
                      {isInternalNote ? <InternalNoteIcon fontSize="small" color="warning" /> : null}
                      <Typography variant="caption" fontWeight={700}>
                        {eventLabel(item.value)}
                      </Typography>
                      {isInternalNote ? <Typography variant="caption" color="warning.dark">Staff only</Typography> : null}
                    </Stack>
                    <Typography variant="caption" color="text.secondary">{formatSupportDate(item.value.created_at)}</Typography>
                  </Stack>
                  {item.value.body ? <Typography variant="body2" sx={{ mt: 0.75, whiteSpace: 'pre-wrap' }}>{item.value.body}</Typography> : null}
                  {item.value.actor_name ? <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.75 }}>{item.value.actor_name}</Typography> : null}
                </Paper>
              );
            }

            const isGuest = item.value.author_type === 'guest';
            return (
              <Box key={`message-${item.value.id}`} alignSelf={isGuest ? 'flex-start' : 'flex-end'} maxWidth={{ xs: '100%', sm: '80%' }}>
                <Paper
                  elevation={0}
                  sx={{
                    p: 1.5,
                    bgcolor: isGuest ? 'background.paper' : 'primary.main',
                    color: isGuest ? 'text.primary' : 'primary.contrastText',
                    border: isGuest ? 1 : 0,
                    borderColor: 'divider',
                  }}
                >
                  <Stack direction="row" justifyContent="space-between" gap={2}>
                    <Typography variant="caption" fontWeight={700}>{messageLabel(item.value)}</Typography>
                    <Typography variant="caption" sx={{ color: isGuest ? 'text.secondary' : 'inherit', opacity: 0.8 }}>
                      {formatSupportDate(item.value.created_at)}
                    </Typography>
                  </Stack>
                  <Typography variant="body2" sx={{ mt: 0.75, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                    {item.value.body}
                  </Typography>
                </Paper>
              </Box>
            );
          })}
        </Stack>
      </Box>

      <Divider />
      <Box sx={{ p: 2 }}>
        {localError ? <Alert severity="error" sx={{ mb: 1.25 }} onClose={() => setLocalError(null)}>{localError}</Alert> : null}
        {!canReply ? (
          <Alert severity="info">
            {!conversation.assigned_to_user_id && canWrite && !canAssign
              ? 'A support coordinator must claim this conversation before you can reply.'
              : 'This conversation must be reopened before another reply or internal note can be added.'}
          </Alert>
        ) : (
          <Stack spacing={1}>
            <Tabs
              value={activeComposerMode}
              onChange={(_, value: ComposerMode) => setComposerMode(value)}
              aria-label="Message visibility"
              sx={{ minHeight: 36 }}
            >
              <Tab value="reply" icon={<ReplyIcon fontSize="small" />} iconPosition="start" label="Reply to guest" sx={{ minHeight: 36 }} />
              {canAddInternalNote ? (
                <Tab value="note" icon={<InternalNoteIcon fontSize="small" />} iconPosition="start" label="Internal note" sx={{ minHeight: 36 }} />
              ) : null}
            </Tabs>
            {activeComposerMode === 'note' ? (
              <Alert severity="warning" icon={<InternalNoteIcon />}>
                Internal notes are only visible to hotel staff and never appear in the guest portal.
              </Alert>
            ) : null}
            <TextField
              fullWidth
              multiline
              minRows={3}
              label={activeComposerMode === 'note' ? 'Internal note' : 'Reply to guest'}
              placeholder={activeComposerMode === 'note' ? 'Add private context for the next staff member…' : 'Write a response the guest will see…'}
              value={draft}
              disabled={isBusy}
              onChange={(event) => setDraft(event.target.value)}
            />
            <Stack direction="row" justifyContent="flex-end">
              <Button
                variant="contained"
                color={activeComposerMode === 'note' ? 'warning' : 'primary'}
                startIcon={activeComposerMode === 'note' ? <InternalNoteIcon /> : <ReplyIcon />}
                disabled={!draft.trim() || isBusy}
                onClick={() => void handleComposerSubmit()}
              >
                {activeComposerMode === 'note' ? 'Add internal note' : 'Send reply'}
              </Button>
            </Stack>
          </Stack>
        )}
      </Box>

      <Dialog open={dialogMode !== null} onClose={isBusy ? undefined : resetDialog} fullWidth maxWidth="sm">
        <DialogTitle>
          {dialogMode === 'assign' && 'Assign conversation'}
          {dialogMode === 'resolve' && 'Resolve conversation'}
          {dialogMode === 'escalate' && 'Escalate conversation'}
          {dialogMode === 'close' && 'Close conversation'}
          {dialogMode === 'reopen' && 'Reopen conversation'}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {dialogMode === 'assign' ? (
              <>
                <FormControl fullWidth>
                  <InputLabel id="support-assignee-label">Assignee</InputLabel>
                  <Select
                    labelId="support-assignee-label"
                    label="Assignee"
                    value={assigneeId}
                    onChange={(event) => setAssigneeId(event.target.value)}
                  >
                    <MenuItem value=""><em>Unassigned queue</em></MenuItem>
                    {agents.map(agent => (
                      <MenuItem key={agent.id} value={String(agent.id)} disabled={agent.is_available === false}>
                        {agent.name}{agent.is_available === false ? ' (unavailable)' : ''}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <TextField
                  fullWidth
                  label="Handoff note (optional)"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  multiline
                  minRows={2}
                />
              </>
            ) : null}

            {dialogMode === 'resolve' ? (
              <>
                <TextField
                  fullWidth
                  label="Resolution code"
                  value={resolutionCode}
                  onChange={(event) => setResolutionCode(event.target.value)}
                  required
                  placeholder="For example: request_completed"
                />
                <TextField
                  fullWidth
                  required
                  label="Resolution summary"
                  value={resolutionSummary}
                  onChange={(event) => setResolutionSummary(event.target.value)}
                  multiline
                  minRows={3}
                  helperText="This summary is visible to the guest."
                />
              </>
            ) : null}

            {dialogMode === 'escalate' || dialogMode === 'close' || dialogMode === 'reopen' ? (
              <TextField
                fullWidth
                required={dialogMode === 'escalate' || dialogMode === 'close'}
                label={dialogMode === 'escalate'
                  ? 'Escalation reason'
                  : dialogMode === 'close'
                    ? 'Closing reason'
                    : 'Reopen reason (optional)'}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                multiline
                minRows={3}
              />
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={resetDialog} disabled={isBusy}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleDialogSubmit}
            disabled={isBusy
              || (dialogMode === 'resolve' && (!resolutionCode.trim() || !resolutionSummary.trim()))
              || (['escalate', 'close'].includes(dialogMode ?? '') && !reason.trim())}
          >
            {dialogMode === 'assign' ? 'Assign' : dialogMode === 'resolve' ? 'Resolve' : dialogMode === 'escalate' ? 'Escalate' : dialogMode === 'reopen' ? 'Reopen' : 'Close'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

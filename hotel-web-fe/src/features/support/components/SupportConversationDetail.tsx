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
  CheckCircleOutlined as ResolveIcon,
  Close as CloseIcon,
  EscalatorWarning as EscalateIcon,
  PersonAddAlt as AssignIcon,
  Reply as ReplyIcon,
  RestartAlt as ReopenIcon,
  StickyNote2Outlined as InternalNoteIcon,
} from '@mui/icons-material';
import { useMemo, useRef, useState } from 'react';
import { useTranslation, type UseTranslationResult } from '../../../i18n/useTranslation';
import { statusLabel } from '../../../i18n/statusLabel';
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
  supportCategoryLabel,
  SupportPriorityChip,
  SupportSlaChip,
  SupportStatusChip,
} from './SupportStatusChip';
import { getSupportConversationAccess } from '../utils';

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

function messageLabel(t: UseTranslationResult['t'], message: SupportMessage): string {
  if (message.author_type === 'guest') return message.author_name || t('detail.guestFallback');
  if (message.author_type === 'staff') return message.author_name || t('detail.staffFallback');
  return message.author_name || t('detail.systemFallback');
}

function eventLabel(t: UseTranslationResult['t'], event: SupportEvent): string {
  return event.event_type === 'internal_note'
    ? t('detail.internalNote')
    : statusLabel(t, 'generic', event.event_type);
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
  const { t, tOr } = useTranslation('support');
  const [composerMode, setComposerMode] = useState<ComposerMode>('reply');
  const [draft, setDraft] = useState('');
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [assigneeId, setAssigneeId] = useState<string>('');
  const [reason, setReason] = useState('');
  const [resolutionCode, setResolutionCode] = useState('');
  const [resolutionSummary, setResolutionSummary] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const pendingActionClientIds = useRef(new Map<string, string>());
  const pendingMessageClientIds = useRef(new Map<string, string>());

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
    const actionPayload = {
      ...payload,
      expected_version: conversation.version,
    };
    const retryKey = JSON.stringify({ conversationId: conversation.id, payload: actionPayload });
    const clientActionId = pendingActionClientIds.current.get(retryKey) ?? newSupportClientId();
    pendingActionClientIds.current.set(retryKey, clientActionId);

    try {
      await onAction({
        ...actionPayload,
        client_action_id: clientActionId,
      });
      pendingActionClientIds.current.delete(retryKey);
      resetDialog();
      if (payload.action === 'add_internal_note') setDraft('');
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : t('detail.actionFailed'));
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

      const message = draft.trim();
      const retryKey = JSON.stringify({
        conversationId: conversation.id,
        expectedVersion: conversation.version,
        message,
      });
      const clientMessageId = pendingMessageClientIds.current.get(retryKey) ?? newSupportClientId();
      pendingMessageClientIds.current.set(retryKey, clientMessageId);

      await onSendMessage({
        message,
        client_message_id: clientMessageId,
        expected_version: conversation.version,
      });
      pendingMessageClientIds.current.delete(retryKey);
      setDraft('');
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : t('detail.sendFailed'));
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
      <Stack
        spacing={1}
        sx={{
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          minHeight: 360
        }}>
        <CircularProgress size={28} />
        <Typography variant="body2" sx={{
          color: "text.secondary"
        }}>{t('detail.loading')}</Typography>
      </Stack>
    );
  }

  if (!conversation) {
    return (
      <Stack
        spacing={0.5}
        sx={{
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          minHeight: 360,
          px: 3,
          textAlign: 'center'
        }}>
        <Typography variant="subtitle1">{t('detail.selectTitle')}</Typography>
        <Typography variant="body2" sx={{
          color: "text.secondary"
        }}>
          {t('detail.selectHint')}
        </Typography>
      </Stack>
    );
  }

  const access = getSupportConversationAccess(conversation, {
    currentUserId,
    canWrite,
    canAssign,
    canEscalate,
    canManage,
  }, (key) => t(key));
  const activeComposerMode = composerMode === 'note' && !access.canAddInternalNote ? 'reply' : composerMode;

  return (
    <Stack
      sx={{
        height: "100%",
        minHeight: 0
      }}>
      <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Stack spacing={1.25}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            sx={{
              alignItems: { sm: 'flex-start' },
              justifyContent: "space-between",
              gap: 1
            }}>
            <Box>
              <Typography variant="h6">{conversation.guest_name || t('detail.guestFallback')}</Typography>
              <Typography variant="body2" sx={{
                color: "text.secondary"
              }}>
                {conversation.conversation_number} · {supportCategoryLabel(tOr, conversation.category)}
              </Typography>
            </Box>
            <Stack
              direction="row"
              useFlexGap
              sx={{
                gap: 0.75,
                flexWrap: "wrap"
              }}>
              <SupportStatusChip status={conversation.status} />
              <SupportPriorityChip priority={conversation.priority} />
              <SupportSlaChip
                isAtRisk={conversation.is_sla_at_risk}
                isBreached={conversation.is_sla_breached}
                dueAt={conversation.first_response_due_at ?? conversation.resolution_due_at}
              />
            </Stack>
          </Stack>

          <Stack
            direction="row"
            useFlexGap
            sx={{
              gap: 1.5,
              flexWrap: "wrap"
            }}>
            <Typography variant="caption" sx={{
              color: "text.secondary"
            }}>
              {conversation.booking_reference ? t('detail.bookingLinked', { reference: conversation.booking_reference }) : t('detail.noBooking')}
            </Typography>
            {conversation.room_number ? (
              <Typography variant="caption" sx={{
                color: "text.secondary"
              }}>{t('detail.room', { number: conversation.room_number })}</Typography>
            ) : null}
            {conversation.stay_status ? (
              <Typography variant="caption" sx={{
                color: "text.secondary"
              }}>{statusLabel(t, 'booking', conversation.stay_status)}</Typography>
            ) : null}
            <Typography variant="caption" sx={{
              color: "text.secondary"
            }}>
              {conversation.assigned_to_name ? t('detail.assignedTo', { name: conversation.assigned_to_name }) : t('detail.unassigned')}
            </Typography>
          </Stack>

          <Stack
            direction="row"
            useFlexGap
            sx={{
              gap: 0.75,
              flexWrap: "wrap",
              alignItems: "center"
            }}>
            {access.canClaim ? (
              <Button size="small" variant="outlined" startIcon={<ClaimIcon />} disabled={isBusy} onClick={() => void performAction({ action: 'claim' })}>
                {t('detail.actions.claim')}
              </Button>
            ) : null}
            {access.canAssign ? (
              <Button size="small" variant="outlined" startIcon={<AssignIcon />} disabled={isBusy} onClick={() => setDialogMode('assign')}>
                {t('detail.actions.assign')}
              </Button>
            ) : null}
            {access.canRelease ? (
              <Button size="small" variant="text" disabled={isBusy} onClick={() => void performAction({ action: 'release' })}>
                {t('detail.actions.release')}
              </Button>
            ) : null}
            {canManage && access.isActive ? (
              <FormControl size="small" sx={{ minWidth: 132 }}>
                <InputLabel id="support-priority-label">{t('detail.priority')}</InputLabel>
                <Select
                  labelId="support-priority-label"
                  label={t('detail.priority')}
                  value={conversation.priority}
                  disabled={isBusy}
                  onChange={(event) => handlePriorityChange(event.target.value as SupportPriority)}
                >
                  {SUPPORT_PRIORITY_OPTIONS.map(priority => (
                    <MenuItem key={priority} value={priority}>{statusLabel(t, 'priority', priority)}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            ) : null}
            {access.canEscalate ? (
              <Button size="small" color="warning" variant="outlined" startIcon={<EscalateIcon />} disabled={isBusy} onClick={() => setDialogMode('escalate')}>
                {t('detail.actions.escalate')}
              </Button>
            ) : null}
            {access.canResolve ? (
              <Button size="small" color="success" variant="contained" startIcon={<ResolveIcon />} disabled={isBusy} onClick={() => setDialogMode('resolve')}>
                {t('detail.actions.resolve')}
              </Button>
            ) : null}
            {access.canClose ? (
              <Button size="small" variant="outlined" startIcon={<CloseIcon />} disabled={isBusy} onClick={() => setDialogMode('close')}>
                {t('detail.actions.close')}
              </Button>
            ) : null}
            {access.canReopen ? (
              <Button size="small" variant="outlined" startIcon={<ReopenIcon />} disabled={isBusy} onClick={() => setDialogMode('reopen')}>
                {t('detail.actions.reopen')}
              </Button>
            ) : null}
          </Stack>
        </Stack>
      </Box>
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          p: 2,
          bgcolor: 'background.default'
        }}>
        <Stack spacing={1.25}>
          {timeline.length === 0 ? (
            <Typography
              variant="body2"
              sx={{
                color: "text.secondary",
                textAlign: 'center',
                py: 5
              }}>
              {t('detail.noActivity')}
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
                  <Stack
                    direction="row"
                    sx={{
                      justifyContent: "space-between",
                      gap: 1
                    }}>
                    <Stack
                      direction="row"
                      sx={{
                        gap: 0.75,
                        alignItems: "center"
                      }}>
                      {isInternalNote ? <InternalNoteIcon fontSize="small" color="warning" /> : null}
                      <Typography variant="caption" sx={{
                        fontWeight: 700
                      }}>
                        {eventLabel(t, item.value)}
                      </Typography>
                      {isInternalNote ? <Typography variant="caption" sx={{
                        color: "warning.dark"
                      }}>{t('detail.staffOnly')}</Typography> : null}
                    </Stack>
                    <Typography variant="caption" sx={{
                      color: "text.secondary"
                    }}>{formatSupportDate(item.value.created_at)}</Typography>
                  </Stack>
                  {item.value.body ? <Typography variant="body2" sx={{ mt: 0.75, whiteSpace: 'pre-wrap' }}>{item.value.body}</Typography> : null}
                  {item.value.actor_name ? <Typography
                    variant="caption"
                    sx={{
                      color: "text.secondary",
                      display: "block",
                      mt: 0.75
                    }}>{item.value.actor_name}</Typography> : null}
                </Paper>
              );
            }

            const isGuest = item.value.author_type === 'guest';
            return (
              <Box
                key={`message-${item.value.id}`}
                sx={{
                  alignSelf: isGuest ? 'flex-start' : 'flex-end',
                  maxWidth: { xs: '100%', sm: '80%' }
                }}>
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
                  <Stack
                    direction="row"
                    sx={{
                      justifyContent: "space-between",
                      gap: 2
                    }}>
                    <Typography variant="caption" sx={{
                      fontWeight: 700
                    }}>{messageLabel(t, item.value)}</Typography>
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
        {!access.canReply ? (
          <Alert severity="info">
            {access.blockedReplyMessage}
          </Alert>
        ) : (
          <Stack spacing={1}>
            <Tabs
              value={activeComposerMode}
              onChange={(_, value: ComposerMode) => setComposerMode(value)}
              aria-label={t('detail.composerAria')}
              sx={{ minHeight: 36 }}
            >
              <Tab value="reply" icon={<ReplyIcon fontSize="small" />} iconPosition="start" label={t('detail.replyTab')} sx={{ minHeight: 36 }} />
              {access.canAddInternalNote ? (
                <Tab value="note" icon={<InternalNoteIcon fontSize="small" />} iconPosition="start" label={t('detail.noteTab')} sx={{ minHeight: 36 }} />
              ) : null}
            </Tabs>
            {activeComposerMode === 'note' ? (
              <Alert severity="warning" icon={<InternalNoteIcon />}>
                {t('detail.noteAlert')}
              </Alert>
            ) : null}
            <TextField
              fullWidth
              multiline
              minRows={3}
              label={activeComposerMode === 'note' ? t('detail.noteLabel') : t('detail.replyLabel')}
              placeholder={activeComposerMode === 'note' ? t('detail.notePlaceholder') : t('detail.replyPlaceholder')}
              value={draft}
              disabled={isBusy}
              onChange={(event) => setDraft(event.target.value)}
            />
            <Stack direction="row" sx={{
              justifyContent: "flex-end"
            }}>
              <Button
                variant="contained"
                color={activeComposerMode === 'note' ? 'warning' : 'primary'}
                startIcon={activeComposerMode === 'note' ? <InternalNoteIcon /> : <ReplyIcon />}
                disabled={!draft.trim() || isBusy}
                onClick={() => void handleComposerSubmit()}
              >
                {activeComposerMode === 'note' ? t('detail.addNote') : t('detail.sendReply')}
              </Button>
            </Stack>
          </Stack>
        )}
      </Box>
      <Dialog open={dialogMode !== null} onClose={isBusy ? undefined : resetDialog} fullWidth maxWidth="sm">
        <DialogTitle>
          {dialogMode === 'assign' && t('detail.dialog.assignTitle')}
          {dialogMode === 'resolve' && t('detail.dialog.resolveTitle')}
          {dialogMode === 'escalate' && t('detail.dialog.escalateTitle')}
          {dialogMode === 'close' && t('detail.dialog.closeTitle')}
          {dialogMode === 'reopen' && t('detail.dialog.reopenTitle')}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {dialogMode === 'assign' ? (
              <>
                <FormControl fullWidth>
                  <InputLabel id="support-assignee-label">{t('detail.dialog.assignee')}</InputLabel>
                  <Select
                    labelId="support-assignee-label"
                    label={t('detail.dialog.assignee')}
                    value={assigneeId}
                    onChange={(event) => setAssigneeId(event.target.value)}
                  >
                    <MenuItem value=""><em>{t('detail.dialog.unassignedQueue')}</em></MenuItem>
                    {agents.map(agent => (
                      <MenuItem key={agent.id} value={String(agent.id)} disabled={agent.is_available === false}>
                        {agent.name}{agent.is_available === false ? ` ${t('detail.dialog.unavailable')}` : ''}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <TextField
                  fullWidth
                  label={t('detail.dialog.handoffNote')}
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
                  label={t('detail.dialog.resolutionCode')}
                  value={resolutionCode}
                  onChange={(event) => setResolutionCode(event.target.value)}
                  required
                  placeholder={t('detail.dialog.resolutionCodePlaceholder')}
                />
                <TextField
                  fullWidth
                  required
                  label={t('detail.dialog.resolutionSummary')}
                  value={resolutionSummary}
                  onChange={(event) => setResolutionSummary(event.target.value)}
                  multiline
                  minRows={3}
                  helperText={t('detail.dialog.resolutionSummaryHelper')}
                />
              </>
            ) : null}

            {dialogMode === 'escalate' || dialogMode === 'close' || dialogMode === 'reopen' ? (
              <TextField
                fullWidth
                required={dialogMode === 'escalate' || dialogMode === 'close'}
                label={dialogMode === 'escalate'
                  ? t('detail.dialog.escalationReason')
                  : dialogMode === 'close'
                    ? t('detail.dialog.closingReason')
                    : t('detail.dialog.reopenReason')}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                multiline
                minRows={3}
              />
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={resetDialog} disabled={isBusy}>{t('common:actions.cancel')}</Button>
          <Button
            variant="contained"
            onClick={handleDialogSubmit}
            disabled={isBusy
              || (dialogMode === 'resolve' && (!resolutionCode.trim() || !resolutionSummary.trim()))
              || (['escalate', 'close'].includes(dialogMode ?? '') && !reason.trim())}
          >
            {dialogMode === 'assign'
              ? t('detail.actions.assign')
              : dialogMode === 'resolve'
                ? t('detail.actions.resolve')
                : dialogMode === 'escalate'
                  ? t('detail.actions.escalate')
                  : dialogMode === 'reopen'
                    ? t('detail.actions.reopen')
                    : t('detail.actions.close')}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

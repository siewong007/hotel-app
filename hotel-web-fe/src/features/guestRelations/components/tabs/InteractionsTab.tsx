import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  FormControlLabel,
  IconButton,
  Paper,
  Skeleton,
  Stack,
  Switch,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  CallOutlined as CallIcon,
  CheckCircleOutlined as CompleteIcon,
  DeleteOutlineOutlined as DeleteIcon,
  EditOutlined as EditIcon,
  EmailOutlined as EmailIcon,
  EventAvailableOutlined as FollowUpIcon,
  FlagOutlined as AlertFlagIcon,
  HandshakeOutlined as InPersonIcon,
  LockOutlined as PrivateIcon,
  PersonAddOutlined as AssigneeIcon,
  ReplayOutlined as ReopenIcon,
  StickyNote2Outlined as NoteIcon,
} from '@mui/icons-material';
import type { SvgIconProps } from '@mui/material';
import { useAuth } from '../../../../auth/AuthContext';
import { useConfirm } from '../../../../components';
import { getQueryErrorMessage } from '../../../../api/queryConfig';
import { emitApiNotification } from '../../../../utils/apiNotifications';
import { errorMessage } from '../../../../utils';
import { formatHotelDate, formatHotelDateTime, isHotelDatePast, toHotelDateString } from '../../../../utils/date';
import type {
  GuestInteraction,
  GuestInteractionInput,
  GuestInteractionType,
  GuestInteractionUpdate,
  GuestProfileBooking,
} from '../../../../types';
import { useSupportAgents } from '../../../support/hooks/useSupportQueries';
import {
  useCreateInteraction,
  useDeleteInteraction,
  useGuestInteractionsFeed,
  useUpdateInteraction,
} from '../../hooks/useGuestRelationsQueries';
import InteractionForm, {
  emptyInteractionDraft,
  followUpDateToISO,
  type InteractionFormDraft,
} from '../InteractionForm';

const PAGE_SIZE = 20;

const TYPE_META: Record<
  GuestInteractionType,
  { label: string; Icon: React.ComponentType<SvgIconProps> }
> = {
  note: { label: 'Note', Icon: NoteIcon },
  call: { label: 'Call', Icon: CallIcon },
  email: { label: 'Email', Icon: EmailIcon },
  in_person: { label: 'In person', Icon: InPersonIcon },
  follow_up: { label: 'Follow-up', Icon: FollowUpIcon },
};

const typeMeta = (type: GuestInteractionType) =>
  TYPE_META[type] ?? TYPE_META.note;

interface InteractionsTabProps {
  guestId: number;
  /** Profile reservations — options for the related-booking select and
   *  labels for booking chips on existing notes. */
  reservations: GuestProfileBooking[];
  /** Set by the header's "Add Note" quick action — the tab focuses its add
   *  form once it lands, then calls `onAddNoteHandled` so later manual visits
   *  don't steal focus. */
  addNoteRequested: boolean;
  onAddNoteHandled: () => void;
}

/**
 * Guest 360 interactions timeline — staff notes/calls/emails/meetings and
 * follow-ups over `guest_notes`, newest first, "load more" accumulation via
 * `useGuestInteractionsFeed`. Write actions need `guests:update`; private
 * notes additionally restrict edit/delete to the author or `guests:manage`
 * (mirroring the backend rule). The assignee picker needs the support agents
 * endpoint (`support:assign`) and is hidden without it.
 */
const InteractionsTab: React.FC<InteractionsTabProps> = ({
  guestId,
  reservations,
  addNoteRequested,
  onAddNoteHandled,
}) => {
  const { user, hasPermission } = useAuth();
  const confirm = useConfirm();
  const canWrite = hasPermission('guests:update');
  const canManageGuests = hasPermission('guests:manage');
  const canAssign = hasPermission('support:assign');
  const currentUserId = user?.id ? Number(user.id) : null;

  const [includeCompleted, setIncludeCompleted] = useState(false);
  const feedQuery = useGuestInteractionsFeed(guestId, {
    pageSize: PAGE_SIZE,
    includeCompletedFollowups: includeCompleted,
  });
  const notes = useMemo(
    () => feedQuery.data?.pages.flatMap((page) => page.data) ?? [],
    [feedQuery.data],
  );
  const total = feedQuery.data?.pages[0]?.total ?? 0;

  const createMutation = useCreateInteraction();
  const updateMutation = useUpdateInteraction();
  const deleteMutation = useDeleteInteraction();
  const agentsQuery = useSupportAgents(canAssign);

  const [addError, setAddError] = useState<string | null>(null);
  const [addFormKey, setAddFormKey] = useState(0);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  // Focus the add form once per "Add Note" click — including when the tab was
  // already active (the consume callback resets the parent's flag so
  // remounting the tab later doesn't refocus).
  const addContentRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (!addNoteRequested) return;
    addContentRef.current?.focus();
    onAddNoteHandled();
  }, [addNoteRequested, onAddNoteHandled]);

  const bookingLabel = (bookingId: number | null): string | null => {
    if (bookingId == null) return null;
    const booking = reservations.find((r) => r.id === bookingId);
    return booking?.booking_number || `#${bookingId}`;
  };

  /** Mirrors the backend mutation rule: private rows are mutable only by
   *  their author or a `guests:manage` holder; public rows need
   *  `guests:update`. */
  const canModify = (note: GuestInteraction): boolean => {
    if (!canWrite) return false;
    if (!note.is_private) return true;
    return canManageGuests || (note.created_by != null && note.created_by === currentUserId);
  };

  const handleCreate = async (draft: InteractionFormDraft) => {
    const payload: GuestInteractionInput = {
      interaction_type: draft.interaction_type,
      subject: draft.subject || undefined,
      content: draft.content,
      booking_id: draft.booking_id ?? undefined,
      is_alert: draft.is_alert,
      is_private: draft.is_private,
      follow_up_at: draft.follow_up_at ? followUpDateToISO(draft.follow_up_at) : undefined,
      assigned_to: canAssign && draft.assigned_to != null ? draft.assigned_to : undefined,
    };
    setAddError(null);
    try {
      await createMutation.mutateAsync({ guestId, data: payload });
      emitApiNotification({ message: 'Interaction added', severity: 'success' });
      // Remount the form to a blank draft.
      setAddFormKey((key) => key + 1);
    } catch (err) {
      setAddError(errorMessage(err, 'Failed to add interaction'));
    }
  };

  const handleSaveEdit = async (note: GuestInteraction, draft: InteractionFormDraft) => {
    const payload: GuestInteractionUpdate = {
      // `""` clears the subject column — the only clearable text field.
      subject: draft.subject,
      content: draft.content,
      interaction_type: draft.interaction_type,
      is_alert: draft.is_alert,
      is_private: draft.is_private,
    };
    // follow_up_at / assigned_to can be set or moved, never cleared — omit
    // rather than send an unrepresentable null.
    if (draft.follow_up_at) {
      payload.follow_up_at = followUpDateToISO(draft.follow_up_at);
    }
    if (
      canAssign &&
      draft.assigned_to != null &&
      draft.assigned_to !== note.assigned_to
    ) {
      payload.assigned_to = draft.assigned_to;
    }
    setEditError(null);
    try {
      await updateMutation.mutateAsync({ guestId, interactionId: note.id, data: payload });
      emitApiNotification({ message: 'Interaction updated', severity: 'success' });
      setEditingId(null);
    } catch (err) {
      setEditError(errorMessage(err, 'Failed to update interaction'));
    }
  };

  const handleToggleFollowUp = async (note: GuestInteraction) => {
    setListError(null);
    try {
      await updateMutation.mutateAsync({
        guestId,
        interactionId: note.id,
        // true stamps once; false clears (reopens) the completion.
        data: { follow_up_completed: note.follow_up_completed_at == null },
      });
      emitApiNotification({
        message:
          note.follow_up_completed_at == null
            ? 'Follow-up marked complete'
            : 'Follow-up reopened',
        severity: 'success',
      });
    } catch (err) {
      setListError(errorMessage(err, 'Failed to update follow-up'));
    }
  };

  const handleDelete = async (note: GuestInteraction) => {
    const confirmed = await confirm({
      title: 'Delete this interaction?',
      message:
        'The note will be removed from the guest timeline. This cannot be undone.',
      confirmText: 'Delete',
      severity: 'error',
    });
    if (!confirmed) return;
    setListError(null);
    try {
      await deleteMutation.mutateAsync({ guestId, interactionId: note.id });
      emitApiNotification({ message: 'Interaction deleted', severity: 'success' });
    } catch (err) {
      setListError(errorMessage(err, 'Failed to delete interaction'));
    }
  };

  const editDraftFor = (note: GuestInteraction): InteractionFormDraft => ({
    interaction_type: note.interaction_type,
    subject: note.subject ?? '',
    content: note.content,
    booking_id: note.booking_id,
    is_alert: note.is_alert,
    is_private: note.is_private,
    follow_up_at: toHotelDateString(note.follow_up_at),
    assigned_to: note.assigned_to,
  });

  const renderNote = (note: GuestInteraction) => {
    const meta = typeMeta(note.interaction_type);
    const TypeIcon = meta.Icon;
    const label = bookingLabel(note.booking_id);
    const completed = note.follow_up_completed_at != null;
    const overdue =
      note.follow_up_at != null && !completed && isHotelDatePast(note.follow_up_at);
    const mutable = canModify(note);
    const isEditing = editingId === note.id;

    return (
      <Paper
        key={note.id}
        variant="outlined"
        sx={{
          p: 1.5,
          borderLeft: 3,
          borderLeftColor: note.is_alert
            ? 'warning.main'
            : overdue
              ? 'error.main'
              : 'divider',
        }}
      >
        {isEditing ? (
          <InteractionForm
            mode="edit"
            initial={editDraftFor(note)}
            canAssign={canAssign}
            agents={agentsQuery.data}
            agentsLoading={agentsQuery.isPending}
            agentsError={agentsQuery.isError}
            assigneeName={note.assigned_to_name}
            submitting={updateMutation.isPending}
            submitLabel="Save changes"
            error={editError}
            onSubmit={(draft) => void handleSaveEdit(note, draft)}
            onCancel={() => {
              setEditingId(null);
              setEditError(null);
            }}
          />
        ) : (
          <>
            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}
            >
              <Chip
                size="small"
                variant="outlined"
                icon={<TypeIcon sx={{ fontSize: 14 }} />}
                label={meta.label}
              />
              {note.is_private && (
                <Chip
                  size="small"
                  color="default"
                  icon={<PrivateIcon sx={{ fontSize: 14 }} />}
                  label="Private"
                />
              )}
              {note.is_alert && (
                <Chip
                  size="small"
                  color="warning"
                  icon={<AlertFlagIcon sx={{ fontSize: 14 }} />}
                  label="Alert"
                />
              )}
              {label && (
                <Chip size="small" variant="outlined" label={`Booking ${label}`} />
              )}
              {note.follow_up_at != null && (
                <Chip
                  size="small"
                  variant={completed ? 'outlined' : 'filled'}
                  color={completed ? 'success' : overdue ? 'error' : 'info'}
                  icon={<FollowUpIcon sx={{ fontSize: 14 }} />}
                  label={
                    completed
                      ? `Follow-up done ${formatHotelDate(note.follow_up_completed_at)}`
                      : `Follow up ${formatHotelDate(note.follow_up_at)}`
                  }
                />
              )}
              {note.assigned_to_name && (
                <Chip
                  size="small"
                  variant="outlined"
                  icon={<AssigneeIcon sx={{ fontSize: 14 }} />}
                  label={`Assigned to ${note.assigned_to_name}`}
                />
              )}
              <Box sx={{ flex: 1 }} />
              {mutable && note.follow_up_at != null && (
                <Tooltip title={completed ? 'Reopen follow-up' : 'Mark follow-up complete'}>
                  <span>
                    <IconButton
                      size="small"
                      onClick={() => void handleToggleFollowUp(note)}
                      disabled={updateMutation.isPending}
                      aria-label={completed ? 'Reopen follow-up' : 'Mark follow-up complete'}
                    >
                      {completed ? (
                        <ReopenIcon fontSize="small" />
                      ) : (
                        <CompleteIcon fontSize="small" />
                      )}
                    </IconButton>
                  </span>
                </Tooltip>
              )}
              {mutable && (
                <>
                  <Tooltip title="Edit">
                    <span>
                      <IconButton
                        size="small"
                        onClick={() => {
                          setEditError(null);
                          setEditingId(note.id);
                        }}
                        disabled={updateMutation.isPending}
                        aria-label="Edit interaction"
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title="Delete">
                    <span>
                      <IconButton
                        size="small"
                        onClick={() => void handleDelete(note)}
                        disabled={deleteMutation.isPending}
                        aria-label="Delete interaction"
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                </>
              )}
            </Stack>

            {note.subject && (
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mt: 1 }}>
                {note.subject}
              </Typography>
            )}
            <Typography
              variant="body2"
              sx={{ mt: note.subject ? 0.5 : 1, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
            >
              {note.content}
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.75 }}>
              {note.created_by_name ? `${note.created_by_name} · ` : ''}
              {formatHotelDateTime(note.created_at)}
              {note.updated_at !== note.created_at &&
                ` · edited ${formatHotelDateTime(note.updated_at)}`}
            </Typography>
          </>
        )}
      </Paper>
    );
  };

  return (
    <Stack spacing={2.5}>
      {/* Add form — always mounted at the top so the header's "Add Note"
          quick action lands on something already visible. */}
      {canWrite && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1.5 }}>
            Add interaction
          </Typography>
          <InteractionForm
            key={addFormKey}
            mode="create"
            initial={emptyInteractionDraft()}
            reservations={reservations}
            canAssign={canAssign}
            agents={agentsQuery.data}
            agentsLoading={agentsQuery.isPending}
            agentsError={agentsQuery.isError}
            submitting={createMutation.isPending}
            submitLabel="Add note"
            error={addError}
            onSubmit={(draft) => void handleCreate(draft)}
            contentInputRef={addContentRef}
          />
        </Paper>
      )}

      <Box>
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}
        >
          <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
            Timeline{total > 0 ? ` (${total})` : ''}
          </Typography>
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={includeCompleted}
                onChange={(event) => setIncludeCompleted(event.target.checked)}
              />
            }
            label={
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                Include completed follow-ups
              </Typography>
            }
          />
        </Stack>

        {listError && (
          <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setListError(null)}>
            {listError}
          </Alert>
        )}

        {feedQuery.isPending ? (
          <Stack spacing={1.5}>
            <Skeleton variant="rounded" height={96} />
            <Skeleton variant="rounded" height={96} />
            <Skeleton variant="rounded" height={96} />
          </Stack>
        ) : feedQuery.isError ? (
          <Alert
            severity="error"
            action={
              <Button color="inherit" size="small" onClick={() => void feedQuery.refetch()}>
                Retry
              </Button>
            }
          >
            {getQueryErrorMessage(feedQuery.error, 'Failed to load interactions') ??
              'Failed to load interactions'}
          </Alert>
        ) : notes.length === 0 ? (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            No interactions recorded yet.
            {canWrite ? ' Use the form above to add the first note.' : ''}
          </Typography>
        ) : (
          <Stack spacing={1.5}>
            {notes.map(renderNote)}
            {feedQuery.hasNextPage && (
              <>
                <Divider />
                <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                  <Button
                    size="small"
                    onClick={() => void feedQuery.fetchNextPage()}
                    disabled={feedQuery.isFetchingNextPage}
                    sx={{ textTransform: 'none' }}
                    startIcon={
                      feedQuery.isFetchingNextPage ? (
                        <CircularProgress size={14} />
                      ) : undefined
                    }
                  >
                    {feedQuery.isFetchingNextPage
                      ? 'Loading…'
                      : `Load more (${notes.length} of ${total})`}
                  </Button>
                </Box>
              </>
            )}
          </Stack>
        )}
      </Box>
    </Stack>
  );
};

export default InteractionsTab;

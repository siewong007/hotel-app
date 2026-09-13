import React, { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
} from '@mui/material';
import { ModernDatePicker } from '../../../components';
import type {
  GuestInteractionType,
  GuestProfileBooking,
} from '../../../types';
import type { SupportAgent } from '../../support/types';
import { formatStatusLabel } from '../../../utils/formatters';
import { formatHotelDate, toHotelDateString } from '../../../utils/date';

export const INTERACTION_TYPE_OPTIONS: GuestInteractionType[] = [
  'note',
  'call',
  'email',
  'in_person',
  'follow_up',
];

const MAX_SUBJECT_CHARS = 255;
const MAX_CONTENT_CHARS = 4000;

/**
 * Field values shared by the add and edit forms. `follow_up_at` stays a
 * `YYYY-MM-DD` picker value ('' = unset); `assigned_to`/`booking_id` are
 * `null` when unset. Callers translate to the wire shape per mode — the
 * update contract cannot express "clear follow_up_at/assigned_to", so ''
 * and null both mean "omit".
 */
export interface InteractionFormDraft {
  interaction_type: GuestInteractionType;
  subject: string;
  content: string;
  booking_id: number | null;
  is_alert: boolean;
  is_private: boolean;
  follow_up_at: string;
  assigned_to: number | null;
}

export const emptyInteractionDraft = (): InteractionFormDraft => ({
  interaction_type: 'note',
  subject: '',
  content: '',
  booking_id: null,
  is_alert: false,
  is_private: false,
  follow_up_at: '',
  assigned_to: null,
});

/**
 * `guest_notes.follow_up_at` is a `timestamptz` while the picker produces a
 * hotel-local calendar date. Anchoring at noon UTC keeps the stored instant
 * on the picked date for every timezone the app deploys to — midnight UTC
 * would render a day early for hotels west of Greenwich, and viewer-local
 * parsing drifts for remote staff.
 */
export const followUpDateToISO = (pickerDate: string): string => `${pickerDate}T12:00:00Z`;

interface InteractionFormProps {
  mode: 'create' | 'edit';
  initial: InteractionFormDraft;
  /** Booking select options (create mode only — `booking_id` is not
   *  editable post-create). */
  reservations?: GuestProfileBooking[];
  canAssign: boolean;
  agents?: SupportAgent[];
  agentsLoading?: boolean;
  agentsError?: boolean;
  /** Edit mode when the note already has an assignee: hides the empty
   *  option since an assignment can be moved but never cleared. */
  assigneeName?: string | null;
  submitting: boolean;
  submitLabel: string;
  onSubmit: (draft: InteractionFormDraft) => void;
  onCancel?: () => void;
  error?: string | null;
  /** Lets the parent focus the content field (Add Note quick action). */
  contentInputRef?: React.Ref<HTMLTextAreaElement>;
}

/** Shared add/edit form for a guest interaction. Owns only field state —
 * submission, permission gating and payload shape live in the caller. */
const InteractionForm: React.FC<InteractionFormProps> = ({
  mode,
  initial,
  reservations,
  canAssign,
  agents,
  agentsLoading,
  agentsError,
  assigneeName,
  submitting,
  submitLabel,
  onSubmit,
  onCancel,
  error,
  contentInputRef,
}) => {
  const [draft, setDraft] = useState<InteractionFormDraft>(initial);

  const patch = (fields: Partial<InteractionFormDraft>) =>
    setDraft((prev) => ({ ...prev, ...fields }));

  // The current assignee may have left the agent pool — keep it selectable so
  // an edit doesn't silently reassign.
  const assigneeOptions = useMemo(() => {
    const options = agents ?? [];
    if (
      initial.assigned_to != null &&
      !options.some((agent) => agent.id === initial.assigned_to)
    ) {
      return [
        { id: initial.assigned_to, name: assigneeName || `User #${initial.assigned_to}` },
        ...options,
      ];
    }
    return options;
  }, [agents, initial.assigned_to, assigneeName]);

  // An existing assignment can be moved but never cleared (the update
  // contract has no null representation), so the empty option only exists
  // while the note is unassigned.
  const allowEmptyAssignee = initial.assigned_to == null;

  const bookingOptions = useMemo(() => reservations ?? [], [reservations]);

  const handleSubmit = () => {
    if (!draft.content.trim()) return;
    onSubmit({ ...draft, subject: draft.subject.trim(), content: draft.content.trim() });
  };

  return (
    <Stack spacing={1.5}>
      {error && <Alert severity="error">{error}</Alert>}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: '1fr 2fr' },
          gap: 1.5,
        }}
      >
        <TextField
          select
          label="Type"
          size="small"
          value={draft.interaction_type}
          onChange={(event) =>
            patch({ interaction_type: event.target.value as GuestInteractionType })
          }
          disabled={submitting}
        >
          {INTERACTION_TYPE_OPTIONS.map((type) => (
            <MenuItem key={type} value={type}>
              {formatStatusLabel(type)}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          label="Subject (optional)"
          size="small"
          value={draft.subject}
          onChange={(event) => patch({ subject: event.target.value })}
          slotProps={{ htmlInput: { maxLength: MAX_SUBJECT_CHARS } }}
          disabled={submitting}
        />
      </Box>

      <TextField
        label={mode === 'create' ? 'Note content' : 'Content'}
        size="small"
        value={draft.content}
        onChange={(event) => patch({ content: event.target.value })}
        required
        multiline
        minRows={3}
        slotProps={{ htmlInput: { maxLength: MAX_CONTENT_CHARS } }}
        disabled={submitting}
        inputRef={contentInputRef}
      />

      {mode === 'create' && (
        <TextField
          select
          label="Related booking (optional)"
          size="small"
          value={draft.booking_id ?? ''}
          onChange={(event) =>
            patch({ booking_id: event.target.value === '' ? null : Number(event.target.value) })
          }
          disabled={submitting}
        >
          <MenuItem value="">None</MenuItem>
          {bookingOptions.map((booking) => (
            <MenuItem key={booking.id} value={booking.id}>
              {booking.booking_number || `#${booking.id}`} ·{' '}
              {formatHotelDate(booking.check_in_date)} –{' '}
              {formatHotelDate(booking.check_out_date)}
              {booking.room_number ? ` · Room ${booking.room_number}` : ''}
            </MenuItem>
          ))}
        </TextField>
      )}

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: canAssign ? '1fr 1fr' : '1fr' },
          gap: 1.5,
          alignItems: 'start',
        }}
      >
        <ModernDatePicker
          label="Follow-up date (optional)"
          value={draft.follow_up_at}
          onChange={(value) => patch({ follow_up_at: value })}
          minDate={toHotelDateString(new Date())}
          size="small"
          margin="none"
          disabled={submitting}
          helperText={
            initial.follow_up_at
              ? 'Follow-ups can be moved but not cleared'
              : 'Leave empty for no follow-up'
          }
        />
        {canAssign && (
          <TextField
            select
            label="Assignee (optional)"
            size="small"
            value={draft.assigned_to ?? ''}
            onChange={(event) =>
              patch({
                assigned_to:
                  event.target.value === '' ? null : Number(event.target.value),
              })
            }
            disabled={submitting || agentsLoading}
            helperText={
              agentsError
                ? 'Could not load support staff'
                : allowEmptyAssignee
                  ? undefined
                  : 'Assignments can be moved but not cleared'
            }
          >
            {allowEmptyAssignee && <MenuItem value="">Unassigned</MenuItem>}
            {assigneeOptions.map((agent) => (
              <MenuItem key={agent.id} value={agent.id}>
                {agent.name}
              </MenuItem>
            ))}
          </TextField>
        )}
      </Box>

      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={{ xs: 0, sm: 2 }}
        sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
      >
        <Stack direction="row" spacing={2}>
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                checked={draft.is_alert}
                onChange={(event) => patch({ is_alert: event.target.checked })}
                disabled={submitting}
              />
            }
            label="Show as alert"
          />
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                checked={draft.is_private}
                onChange={(event) => patch({ is_private: event.target.checked })}
                disabled={submitting}
              />
            }
            label="Private — author & managers only"
          />
        </Stack>
        <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
          {onCancel && (
            <Button onClick={onCancel} disabled={submitting} sx={{ textTransform: 'none' }}>
              Cancel
            </Button>
          )}
          <Button
            variant="contained"
            onClick={handleSubmit}
            disabled={submitting || !draft.content.trim()}
            sx={{ textTransform: 'none' }}
          >
            {submitting ? 'Saving…' : submitLabel}
          </Button>
        </Stack>
      </Stack>
    </Stack>
  );
};

export default InteractionForm;

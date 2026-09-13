import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  TextField,
} from '@mui/material';
import { errorMessage } from '../../../utils';
import type {
  CreateStaffSupportConversationRequest,
  GuestSupportConversationCategory,
} from '../../../types';
import { formatStatusLabel } from '../../../utils/formatters';
import { SUPPORT_PRIORITY_OPTIONS, type SupportPriority } from '../../support/types';
import { useSupportAgents } from '../../support/hooks/useSupportQueries';
import { useCreateSupportConversation } from '../hooks/useGuestRelationsQueries';

const SUPPORT_CATEGORIES: GuestSupportConversationCategory[] = [
  'service_request',
  'complaint',
  'booking',
  'stay',
  'billing',
  'loyalty',
  'technical',
  'other',
];

interface OpenSupportDialogProps {
  open: boolean;
  guestId: number;
  guestName: string;
  /** `support:assign` — assigning on create carries the same privilege as the
   *  assign action, and the agents endpoint refuses callers without it. */
  canAssign: boolean;
  onClose: () => void;
  onCreated?: (message: string) => void;
}

/** Staff-side "open a support conversation for this guest" — the Guest 360
 *  quick action backing `POST /support/conversations`. */
const OpenSupportDialog: React.FC<OpenSupportDialogProps> = ({
  open,
  guestId,
  guestName,
  canAssign,
  onClose,
  onCreated,
}) => {
  const createConversation = useCreateSupportConversation();
  const agentsQuery = useSupportAgents(open && canAssign);

  const [category, setCategory] = useState<GuestSupportConversationCategory>('service_request');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [priority, setPriority] = useState<SupportPriority>('normal');
  const [assigneeId, setAssigneeId] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCategory('service_request');
    setSubject('');
    setMessage('');
    setPriority('normal');
    setAssigneeId('');
    setFormError(null);
  }, [open]);

  const handleSubmit = async () => {
    if (!message.trim()) {
      setFormError('A first message is required');
      return;
    }
    const payload: CreateStaffSupportConversationRequest = {
      guest_id: guestId,
      category,
      subject: subject.trim() || undefined,
      message: message.trim(),
      priority,
      assignee_id: canAssign && assigneeId ? Number(assigneeId) : undefined,
    };
    try {
      setFormError(null);
      const result = await createConversation.mutateAsync(payload);
      onCreated?.(
        `Support conversation ${result.conversation.conversation_number} opened for ${guestName}`,
      );
      onClose();
    } catch (err) {
      setFormError(errorMessage(err, 'Failed to open support conversation'));
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Open support conversation — {guestName}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          {formError && (
            <Alert severity="error" onClose={() => setFormError(null)}>
              {formError}
            </Alert>
          )}
          <TextField
            select
            label="Category"
            value={category}
            onChange={(event) => setCategory(event.target.value as GuestSupportConversationCategory)}
            size="small"
            fullWidth
          >
            {SUPPORT_CATEGORIES.map((value) => (
              <MenuItem key={value} value={value}>
                {formatStatusLabel(value)}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Subject"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            size="small"
            fullWidth
            placeholder="Short summary shown in the support queue"
          />
          <TextField
            label="First message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            size="small"
            fullWidth
            required
            multiline
            minRows={3}
            placeholder="What does the guest need?"
          />
          <TextField
            select
            label="Priority"
            value={priority}
            onChange={(event) => setPriority(event.target.value as SupportPriority)}
            size="small"
            fullWidth
          >
            {SUPPORT_PRIORITY_OPTIONS.map((value) => (
              <MenuItem key={value} value={value}>
                {formatStatusLabel(value)}
              </MenuItem>
            ))}
          </TextField>
          {canAssign && (
            <TextField
              select
              label="Assignee (optional)"
              value={assigneeId}
              onChange={(event) => setAssigneeId(event.target.value)}
              size="small"
              fullWidth
              disabled={agentsQuery.isPending}
              helperText={agentsQuery.isError ? 'Could not load support staff' : undefined}
            >
              <MenuItem value="">Unassigned</MenuItem>
              {(agentsQuery.data ?? []).map((agent) => (
                <MenuItem key={agent.id} value={String(agent.id)}>
                  {agent.name}
                </MenuItem>
              ))}
            </TextField>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={() => void handleSubmit()}
          disabled={createConversation.isPending || !message.trim()}
        >
          {createConversation.isPending ? 'Opening…' : 'Open conversation'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default OpenSupportDialog;

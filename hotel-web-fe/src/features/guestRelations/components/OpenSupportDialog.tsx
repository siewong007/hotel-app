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
import { statusLabel } from '../../../i18n/statusLabel';
import { useTranslation } from '../../../i18n/useTranslation';
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
  const { t, tOr } = useTranslation('support');
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
      setFormError(t('openDialog.firstMessageRequired'));
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
        t('openDialog.created', { number: result.conversation.conversation_number, name: guestName }),
      );
      onClose();
    } catch (err) {
      setFormError(errorMessage(err, t('openDialog.failed')));
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('openDialog.title', { name: guestName })}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          {formError && (
            <Alert severity="error" onClose={() => setFormError(null)}>
              {formError}
            </Alert>
          )}
          <TextField
            select
            label={t('openDialog.category')}
            value={category}
            onChange={(event) => setCategory(event.target.value as GuestSupportConversationCategory)}
            size="small"
            fullWidth
          >
            {SUPPORT_CATEGORIES.map((value) => (
              <MenuItem key={value} value={value}>
                {tOr(`categories.${value}`, formatStatusLabel(value))}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label={t('openDialog.subject')}
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            size="small"
            fullWidth
            placeholder={t('openDialog.subjectPlaceholder')}
          />
          <TextField
            label={t('openDialog.firstMessage')}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            size="small"
            fullWidth
            required
            multiline
            minRows={3}
            placeholder={t('openDialog.firstMessagePlaceholder')}
          />
          <TextField
            select
            label={t('openDialog.priority')}
            value={priority}
            onChange={(event) => setPriority(event.target.value as SupportPriority)}
            size="small"
            fullWidth
          >
            {SUPPORT_PRIORITY_OPTIONS.map((value) => (
              <MenuItem key={value} value={value}>
                {statusLabel(t, 'priority', value)}
              </MenuItem>
            ))}
          </TextField>
          {canAssign && (
            <TextField
              select
              label={t('openDialog.assignee')}
              value={assigneeId}
              onChange={(event) => setAssigneeId(event.target.value)}
              size="small"
              fullWidth
              disabled={agentsQuery.isPending}
              helperText={agentsQuery.isError ? t('openDialog.agentsError') : undefined}
            >
              <MenuItem value="">{t('openDialog.unassigned')}</MenuItem>
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
        <Button onClick={onClose}>{t('common:actions.cancel')}</Button>
        <Button
          variant="contained"
          onClick={() => void handleSubmit()}
          disabled={createConversation.isPending || !message.trim()}
        >
          {createConversation.isPending ? t('openDialog.opening') : t('openDialog.open')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default OpenSupportDialog;

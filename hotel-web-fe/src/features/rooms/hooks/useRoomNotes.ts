import { useCallback, useState } from 'react';

import { RoomsService } from '../../../api';
import type { Room } from '../../../types';
import type { ApiNotificationSeverity } from '../../../utils/apiNotifications';
import { errorMessage } from '../../../utils/errorMessage';
import { useTranslation } from '../../../i18n/useTranslation';

interface UseRoomNotesParams {
  reload: () => Promise<void> | void;
  showSnackbar: (message: string, severity: ApiNotificationSeverity) => void;
}

export function useRoomNotes({ reload, showSnackbar }: UseRoomNotesParams) {
  const { t } = useTranslation('rooms');
  const [notesDialogOpen, setNotesDialogOpen] = useState(false);
  const [notesRoom, setNotesRoom] = useState<Room | null>(null);
  const [editingNotes, setEditingNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);

  const openRoomNotes = useCallback((room: Room) => {
    setNotesRoom(room);
    setEditingNotes(room.notes || '');
    setNotesDialogOpen(true);
  }, []);

  const closeRoomNotes = useCallback(() => {
    if (savingNotes) return;
    setNotesDialogOpen(false);
  }, [savingNotes]);

  const saveRoomNotes = useCallback(async () => {
    if (!notesRoom) return;

    try {
      setSavingNotes(true);
      await RoomsService.updateRoom(notesRoom.id, { notes: editingNotes || '' } as Partial<Room>);
      showSnackbar(t('notifications.roomNotesUpdated'), 'success');
      await reload();
      setNotesDialogOpen(false);
    } catch (error) {
      showSnackbar(errorMessage(error, t('errors.updateRoomNotes')), 'error');
    } finally {
      setSavingNotes(false);
    }
  }, [editingNotes, notesRoom, reload, showSnackbar, t]);

  return {
    notesDialogOpen,
    notesRoom,
    editingNotes,
    setEditingNotes,
    savingNotes,
    openRoomNotes,
    closeRoomNotes,
    saveRoomNotes,
  };
}

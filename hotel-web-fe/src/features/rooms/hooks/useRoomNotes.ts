import { useCallback, useState } from 'react';

import { HotelAPIService } from '../../../api';
import type { Room } from '../../../types';
import type { ApiNotificationSeverity } from '../../../utils/apiNotifications';

interface UseRoomNotesParams {
  reload: () => Promise<void> | void;
  showSnackbar: (message: string, severity: ApiNotificationSeverity) => void;
}

export function useRoomNotes({ reload, showSnackbar }: UseRoomNotesParams) {
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
      await HotelAPIService.updateRoom(notesRoom.id, { notes: editingNotes || '' } as Partial<Room>);
      showSnackbar('Room notes updated', 'success');
      await reload();
      setNotesDialogOpen(false);
    } catch (error: any) {
      showSnackbar(error.message || 'Failed to update room notes', 'error');
    } finally {
      setSavingNotes(false);
    }
  }, [editingNotes, notesRoom, reload, showSnackbar]);

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

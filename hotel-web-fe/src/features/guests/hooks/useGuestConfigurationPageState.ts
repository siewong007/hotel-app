/**
 * Custom hook for GuestConfigurationPage.tsx (1,927 lines).
 * Extracts 21 useState calls and 15 handler functions.
 */
import { useState, useCallback } from 'react';
import { Guest } from '../../../types';
import { emitApiNotification } from '../../../utils/apiNotifications';

export function useGuestConfigurationPageState() {
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'all' | string>('all');
  const [segment, setSegment] = useState<'all' | 'member' | 'non' | 'incomplete' | 'tourist'>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedGuestId, setSelectedGuestId] = useState<number | null>(null);
  const [guestDetailsOpen, setGuestDetailsOpen] = useState(true);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [bookingsDialogOpen, setBookingsDialogOpen] = useState(false);
  const [creditsDialogOpen, setCreditsDialogOpen] = useState(false);
  const [bookingDialogOpen, setBookingDialogOpen] = useState(false);
  const [bookingGuest, setBookingGuest] = useState<Guest | null>(null);
  const [formData, setFormData] = useState({
    first_name: '', last_name: '', email: '', phone: '', ic_number: '',
    nationality: '', guest_type: 'individual' as string, tourism_type: 'local' as string,
    company_name: '', address_line1: '', city: '', state_province: '',
    postal_code: '', country: '', title: '', alt_phone: '',
  });
  const [editingGuest, setEditingGuest] = useState<Guest | null>(null);
  const [deletingGuest, setDeletingGuest] = useState<Guest | null>(null);
  const [viewingGuest, setViewingGuest] = useState<Guest | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const handleFilterTypeChange = useCallback((_: React.MouseEvent<HTMLElement>, value: string | null) => {
    setFilterType(value || 'all');
  }, []);

  const handleSearchChange = useCallback((value: string) => {
    setSearchTerm(value);
  }, []);

  const handleCreateClick = useCallback(() => {
    setFormData({
      first_name: '', last_name: '', email: '', phone: '', ic_number: '',
      nationality: '', guest_type: 'individual', tourism_type: 'local',
      company_name: '', address_line1: '', city: '', state_province: '',
      postal_code: '', country: '', title: '', alt_phone: '',
    });
    setDialogError(null);
    setCreateDialogOpen(true);
  }, []);

  const handleEditClick = useCallback((guest: Guest) => {
    setEditingGuest(guest);
    setFormData({
      // first_name/last_name are not part of the Guest API type (only full_name is);
      // legacy saved payloads may still carry them — see the BookingCreatedPayload
      // note in rooms/RoomManagementPage.tsx.
      first_name: (guest as Guest & { first_name?: string }).first_name || '',
      last_name: (guest as Guest & { last_name?: string }).last_name || '',
      email: guest.email || '', phone: guest.phone || '', ic_number: guest.ic_number || '',
      nationality: guest.nationality || '', guest_type: guest.guest_type || 'individual',
      tourism_type: guest.tourism_type || '', company_name: guest.company_name || '',
      address_line1: guest.address_line1 || '', city: guest.city || '',
      state_province: guest.state_province || '', postal_code: guest.postal_code || '',
      country: guest.country || '', title: guest.title || '', alt_phone: guest.alt_phone || '',
    });
    setDialogError(null);
    setEditDialogOpen(true);
  }, []);

  const handleDeleteClick = useCallback((guest: Guest) => {
    setDeletingGuest(guest);
    setDeleteDialogOpen(true);
  }, []);

  const handleViewBookings = useCallback((guest: Guest) => {
    setSelectedGuestId(guest.id);
    setBookingsDialogOpen(true);
  }, []);

  const handleViewCredits = useCallback((guest: Guest) => {
    setSelectedGuestId(guest.id);
    setCreditsDialogOpen(true);
  }, []);

  const handleCreateBookingForGuest = useCallback(async (guest: Guest) => {
    setBookingGuest(guest);
    setBookingDialogOpen(true);
  }, []);

  return {
    error, setError, searchTerm, setSearchTerm, filterType, setFilterType,
    segment, setSegment, currentPage, setCurrentPage, selectedGuestId, setSelectedGuestId,
    guestDetailsOpen, setGuestDetailsOpen, createDialogOpen, setCreateDialogOpen,
    editDialogOpen, setEditDialogOpen, deleteDialogOpen, setDeleteDialogOpen,
    bookingsDialogOpen, setBookingsDialogOpen, creditsDialogOpen, setCreditsDialogOpen,
    bookingDialogOpen, setBookingDialogOpen, bookingGuest, setBookingGuest,
    formData, setFormData, editingGuest, setEditingGuest, deletingGuest, setDeletingGuest,
    viewingGuest, setViewingGuest, formLoading, setFormLoading, dialogError, setDialogError,
    handleFilterTypeChange, handleSearchChange, handleCreateClick, handleEditClick,
    handleDeleteClick, handleViewBookings, handleViewCredits, handleCreateBookingForGuest,
  };
}

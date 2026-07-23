import React, { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Button,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  CircularProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Chip,
  Grid,
  Pagination,
  MenuItem,
  alpha,
} from '@mui/material';
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  Person as PersonIcon,
  Search as SearchIcon,
  History as HistoryIcon,
  CardGiftcard as GiftIcon,
  PhoneOutlined as PhoneIcon,
  MailOutline as MailIcon,
  BadgeOutlined as IdIcon,
  ApartmentOutlined as CompanyIcon,
  ArrowForward as ArrowRightIcon,
  Close as CloseIcon,
  Edit as EditIcon,
  FileDownloadOutlined as ExportIcon,
  AutoAwesome as ConvertIcon,
  VerifiedUserOutlined as EkycIcon,
  WarningAmberOutlined as MissingTourismIcon,
} from '@mui/icons-material';
import { Guest } from '../../../types';
import { DataTable, type ColumnDef } from '../../../components';
import { useAuth } from '../../../auth/AuthContext';
import { useSearchParams } from '../../../router';
import { validateEmail } from '../../../utils/validation';
import { useCurrency } from '../../../hooks/useCurrency';
import UnifiedBookingModal from '../../rooms/components/UnifiedBooking';
import { emitApiNotification } from '../../../utils/apiNotifications';
import { getPaginationState, normalizePage, toPaginationSearchParams } from '../../../utils/pagination';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import {
  useApplyGuestTourismFromLastCheckIn,
  useCreateGuest,
  useDeleteGuest,
  useGuestBookings,
  useGuestCredits,
  useGuests,
  useGuestsPage,
  useUpdateGuest,
} from '../hooks/useGuestQueries';
import { useRooms } from '../../rooms/hooks/useRoomQueries';
import { Star as MemberIcon } from '@mui/icons-material';
import EkycCreateDialog from '../../ekyc/components/EkycCreateDialog';
import GuestFormDialog from './GuestFormDialog';
import { ContactRow, StatTile } from './GuestDetailPanelParts';
import { AVATAR_PALETTE, GUEST_DESIGN } from '../constants';
import type { GuestFormData } from '../types';
import {
  getGuestSegmentCounts,
  getGuestSegmentQueryParams,
  guestHasMissingProfileInfo,
  guestHasMissingTourismType,
  type GuestSegment,
} from '../utils';
import { formatLocalDate } from '../../../utils/date';
const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
const avatarFor = (id: number) => {
  const [bg, fg] = AVATAR_PALETTE[id % AVATAR_PALETTE.length];
  return { bg, fg };
};


const PAGE_SIZE = 50;

const csvCell = (value: unknown) => {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
};

const duplicateGuestReference = (message: string) => {
  const match = message.match(
    /A guest with the name '([^']+)' already exists(?: \(Guest ID #(\d+)\))?/i
  );
  if (!match) return null;
  return {
    name: match[1],
    id: match[2],
  };
};

type GuestBookingHistoryRow = {
  id: string | number;
  booking_number?: string | null;
  check_in_date: string;
  check_out_date: string;
  nights?: number | null;
  status: string;
  total_amount: string | number;
  created_at?: string;
  room_number?: string | null;
  room_type?: string | null;
};

const CHECKED_OUT_BOOKING_STATUSES = new Set(['checked_out', 'completed']);
const VOID_BOOKING_STATUSES = new Set(['voided', 'comp_void']);

const getBookingHistoryDateTime = (value?: string | null) => {
  if (!value) return Number.POSITIVE_INFINITY;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
};

const compareBookingHistoryRows = (a: GuestBookingHistoryRow, b: GuestBookingHistoryRow) => {
  const checkInDiff = getBookingHistoryDateTime(a.check_in_date) - getBookingHistoryDateTime(b.check_in_date);
  if (checkInDiff !== 0) return checkInDiff;

  const checkOutDiff = getBookingHistoryDateTime(a.check_out_date) - getBookingHistoryDateTime(b.check_out_date);
  if (checkOutDiff !== 0) return checkOutDiff;

  return Number(a.id) - Number(b.id);
};

const bookingStatusLabel = (status: string) => {
  const labels: Record<string, string> = {
    checked_out: 'Checked out',
    completed: 'Completed',
    voided: 'Voided',
    comp_void: 'Comp void',
    checked_in: 'Checked in',
    auto_checked_in: 'Checked in',
    confirmed: 'Reserved',
    pending: 'Pending',
  };
  return labels[status] ?? status.replace(/_/g, ' ');
};

const bookingStatusChipColor = (status: string): 'default' | 'success' | 'warning' | 'info' => {
  if (CHECKED_OUT_BOOKING_STATUSES.has(status)) return 'success';
  if (VOID_BOOKING_STATUSES.has(status)) return 'default';
  if (status === 'checked_in' || status === 'auto_checked_in') return 'warning';
  return 'info';
};

const formatBookingHistoryDate = (time: number) =>
  Number.isFinite(time) ? new Date(time).toLocaleDateString() : '—';

const GuestConfigurationPage: React.FC = () => {
  const [pageSearchParams] = useSearchParams();
  const { hasPermission } = useAuth();
  const { format: formatCurrency } = useCurrency();
  const hasAccess = hasPermission('guests:read') || hasPermission('guests:manage');
  const canCreateEkyc = hasPermission('ekyc:approve');

  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [segment, setSegment] = useState<GuestSegment>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const debouncedSearchTerm = useDebouncedValue(searchTerm, searchTerm ? 400 : 0);
  const segmentQueryParams = React.useMemo(
    () => getGuestSegmentQueryParams(segment),
    [segment]
  );
  const guestsQueryParams = React.useMemo(() => ({
    ...toPaginationSearchParams({ page: normalizePage(currentPage), pageSize: PAGE_SIZE }),
    ...(debouncedSearchTerm.trim() ? { search: debouncedSearchTerm.trim() } : {}),
    ...segmentQueryParams,
  }), [currentPage, debouncedSearchTerm, segmentQueryParams]);
  const guestsQuery = useGuestsPage(guestsQueryParams, hasAccess);
  const statsTotalQuery = useGuestsPage(toPaginationSearchParams({ page: 1, pageSize: 1 }), hasAccess);
  const statsMembersQuery = useGuestsPage({ ...toPaginationSearchParams({ page: 1, pageSize: 1 }), guest_type: 'member' }, hasAccess);
  const statsMissingInfoQuery = useGuestsPage({ ...toPaginationSearchParams({ page: 1, pageSize: 1 }), missing_info: true }, hasAccess);
  const statsMissingTourismQuery = useGuestsPage({ ...toPaginationSearchParams({ page: 1, pageSize: 1 }), missing_tourism: true }, hasAccess);
  const statsTouristsQuery = useGuestsPage({ ...toPaginationSearchParams({ page: 1, pageSize: 1 }), tourism_type: 'foreign' }, hasAccess);
  const roomsQuery = useRooms(hasAccess);
  const createGuestMutation = useCreateGuest();
  const updateGuestMutation = useUpdateGuest();
  const applyGuestTourismMutation = useApplyGuestTourismFromLastCheckIn();
  const deleteGuestMutation = useDeleteGuest();
  const guests = React.useMemo(() => guestsQuery.data?.data ?? [], [guestsQuery.data]);
  const rooms = roomsQuery.data ?? [];
  const totalGuests = guestsQuery.data?.total ?? 0;
  const statsTotal = statsTotalQuery.data?.total ?? 0;
  const statsMembers = statsMembersQuery.data?.total ?? 0;
  const statsMissingInfo = statsMissingInfoQuery.data?.total ?? 0;
  const statsMissingTourism = statsMissingTourismQuery.data?.total ?? 0;
  const statsTourists = statsTouristsQuery.data?.total ?? 0;
  const loading = guestsQuery.isPending;
  const queryError = guestsQuery.error || statsTotalQuery.error || statsMembersQuery.error || statsMissingInfoQuery.error || statsMissingTourismQuery.error || statsTouristsQuery.error || roomsQuery.error;
  const pageError = error || (queryError instanceof Error ? queryError.message : null);
  // Currently selected guest in the right detail pane.
  const [selectedGuestId, setSelectedGuestId] = useState<number | null>(null);
  const [guestDetailsOpen, setGuestDetailsOpen] = useState(true);
  const routedGuestSearch = pageSearchParams.get('search') || '';
  const routedGuestId = pageSearchParams.get('guest_id') || '';

  useEffect(() => {
    if (!routedGuestSearch && !routedGuestId) return;

    const nextSearch = routedGuestSearch || routedGuestId;
    setSearchTerm(nextSearch);
    setSegment('all');
    setCurrentPage(1);
    setGuestDetailsOpen(true);

    const guestId = Number(routedGuestId);
    setSelectedGuestId(Number.isFinite(guestId) ? guestId : null);
  }, [routedGuestSearch, routedGuestId]);

  // Dialog states
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [bookingsDialogOpen, setBookingsDialogOpen] = useState(false);
  const [creditsDialogOpen, setCreditsDialogOpen] = useState(false);
  const [bookingDialogOpen, setBookingDialogOpen] = useState(false);
  const [bookingGuest, setBookingGuest] = useState<Guest | null>(null);
  const [ekycGuest, setEkycGuest] = useState<Guest | null>(null);

  // The booking modal searches its guest list client-side, so it needs the
  // full roster — not the 50-row page shown in the table. Load it lazily, only
  // while the modal is open, so existing guests beyond the current page stay
  // searchable instead of forcing a duplicate "create new".
  const allGuestsQuery = useGuests(undefined, hasAccess && bookingDialogOpen);
  const allGuests = allGuestsQuery.data ?? [];

  // Credits state
  interface GuestCredits {
    guest_id: number;
    guest_name: string;
    total_nights: number;
    credits_by_room_type: {
      id: number;
      guest_id: number;
      room_type_id: number;
      room_type_name: string;
      room_type_code: string;
      nights_available: number;
    }[];
  }

  // Form states
  const [formData, setFormData] = useState<GuestFormData>({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    ic_number: '',
    nationality: '',
    address_line1: '',
    city: '',
    state_province: '',
    postal_code: '',
    country: '',
    company_name: '',
    guest_type: 'non_member',
    tourism_type: 'local',
    discount_percentage: 0,
  });

  const [editingGuest, setEditingGuest] = useState<Guest | null>(null);
  const [deletingGuest, setDeletingGuest] = useState<Guest | null>(null);
  const [viewingGuest, setViewingGuest] = useState<Guest | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [tourismConversionGuestId, setTourismConversionGuestId] = useState<number | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const guestBookingsQuery = useGuestBookings(viewingGuest?.id, bookingsDialogOpen && !!viewingGuest);
  const guestCreditsQuery = useGuestCredits(viewingGuest?.id, creditsDialogOpen && !!viewingGuest);
  const guestBookings = React.useMemo(
    () => (guestBookingsQuery.data ?? []) as GuestBookingHistoryRow[],
    [guestBookingsQuery.data]
  );
  const bookingsLoading = guestBookingsQuery.isPending && bookingsDialogOpen;
  const guestCredits = (guestCreditsQuery.data ?? null) as GuestCredits | null;
  const creditsLoading = guestCreditsQuery.isPending && creditsDialogOpen;

  const orderedGuestBookings = React.useMemo(
    () => [...guestBookings].sort(compareBookingHistoryRows),
    [guestBookings]
  );
  const checkedOutGuestBookings = React.useMemo(
    () => orderedGuestBookings.filter((booking) => CHECKED_OUT_BOOKING_STATUSES.has(booking.status)),
    [orderedGuestBookings]
  );
  const voidGuestBookings = React.useMemo(
    () => orderedGuestBookings.filter((booking) => VOID_BOOKING_STATUSES.has(booking.status)),
    [orderedGuestBookings]
  );
  const otherGuestBookings = React.useMemo(
    () => orderedGuestBookings.filter((booking) => (
      !CHECKED_OUT_BOOKING_STATUSES.has(booking.status) && !VOID_BOOKING_STATUSES.has(booking.status)
    )),
    [orderedGuestBookings]
  );

  const guestBookingColumns = React.useMemo<ColumnDef<GuestBookingHistoryRow, any>[]>(() => [
    {
      id: 'sequence',
      header: '#',
      accessorFn: (_booking, index) => index + 1,
      enableSorting: false,
      meta: { align: 'right' },
    },
    { id: 'booking_number', header: 'Booking #', accessorFn: (b: any) => b.booking_number },
    {
      id: 'room',
      header: 'Room',
      accessorFn: (b: GuestBookingHistoryRow) => (
        b.room_number ? `${b.room_number}${b.room_type ? ` (${b.room_type})` : ''}` : '—'
      ),
    },
    {
      id: 'check_in',
      header: 'Check In',
      accessorFn: (b: GuestBookingHistoryRow) => getBookingHistoryDateTime(b.check_in_date),
      cell: (info) => formatBookingHistoryDate(info.getValue() as number),
    },
    {
      id: 'check_out',
      header: 'Check Out',
      accessorFn: (b: GuestBookingHistoryRow) => getBookingHistoryDateTime(b.check_out_date),
      cell: (info) => formatBookingHistoryDate(info.getValue() as number),
    },
    { id: 'nights', header: 'Nights', accessorFn: (b: GuestBookingHistoryRow) => b.nights ?? 0, meta: { align: 'right' } },
    {
      id: 'status',
      header: 'Status',
      accessorFn: (b: GuestBookingHistoryRow) => b.status,
      cell: (info) => {
        const status = String(info.getValue());
        return <Chip label={bookingStatusLabel(status)} color={bookingStatusChipColor(status)} size="small" />;
      },
    },
    {
      id: 'amount',
      header: 'Amount',
      accessorFn: (b: GuestBookingHistoryRow) => Number.parseFloat(String(b.total_amount)) || 0,
      cell: (info) => formatCurrency(info.getValue() as number),
      meta: { align: 'right' },
    },
  ], [formatCurrency]);

  const loadGuests = useCallback(async () => {
    await Promise.all([
      guestsQuery.refetch(),
      statsTotalQuery.refetch(),
      statsMembersQuery.refetch(),
      statsMissingInfoQuery.refetch(),
      statsMissingTourismQuery.refetch(),
      statsTouristsQuery.refetch(),
    ]);
  }, [guestsQuery, statsMembersQuery, statsMissingInfoQuery, statsMissingTourismQuery, statsTotalQuery, statsTouristsQuery]);

  const loadRooms = useCallback(async () => {
    await roomsQuery.refetch();
  }, [roomsQuery]);

  // The API applies the active segment to the paginated query. Keep this as a
  // defensive client-side guard so stale placeholder rows never leak between
  // segment transitions.
  const visibleGuests = React.useMemo(() => {
    return guests.filter((g) => {
      if (segment === 'member' && g.guest_type !== 'member') return false;
      if (segment === 'non' && g.guest_type !== 'non_member') return false;
      if (segment === 'incomplete' && !guestHasMissingProfileInfo(g)) return false;
      if (segment === 'tourist' && g.tourism_type !== 'foreign') return false;
      if (segment === 'missingTourism' && !guestHasMissingTourismType(g)) return false;
      return true;
    });
  }, [guests, segment]);

  const handleExportGuests = () => {
    if (visibleGuests.length === 0) {
      emitApiNotification({ message: 'No guests in the current view to export', severity: 'info' });
      return;
    }

    const header = [
      'ID',
      'Name',
      'Email',
      'Phone',
      'IC / Passport',
      'Guest Type',
      'Tourism Type',
      'Company',
      'Nationality',
      'Country',
      'Bookings',
      'Last Stay',
    ];
    const rows = visibleGuests.map((guest) => [
      guest.id,
      guest.full_name,
      guest.email,
      guest.phone,
      guest.ic_number,
      guest.guest_type,
      guest.tourism_type,
      guest.company_name,
      guest.nationality,
      guest.country,
      guest.bookings_count ?? 0,
      guest.last_stay_date ?? '',
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map(csvCell).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `guests_${formatLocalDate()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    emitApiNotification({ message: 'Guest CSV exported', severity: 'success' });
  };

  // Group visible guests A→Z for the section headers in the list.
  const guestsByLetter = React.useMemo(() => {
    const groups = new Map<string, Guest[]>();
    visibleGuests.forEach((g) => {
      const letter = (g.full_name?.[0] || '#').toUpperCase();
      if (!groups.has(letter)) groups.set(letter, []);
      groups.get(letter)!.push(g);
    });
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [visibleGuests]);

  // Default-select the first visible guest, and move the detail pane when the
  // current selection no longer belongs to the active segment/page.
  useEffect(() => {
    if (!guestDetailsOpen) return;
    if (visibleGuests.length === 0) {
      if (selectedGuestId != null) setSelectedGuestId(null);
      return;
    }
    if (selectedGuestId == null || !visibleGuests.some((g) => g.id === selectedGuestId)) {
      setSelectedGuestId(visibleGuests[0].id);
    }
  }, [guestDetailsOpen, selectedGuestId, visibleGuests]);

  const selectedGuest = guestDetailsOpen ? visibleGuests.find((g) => g.id === selectedGuestId) || null : null;

  const handleSearchChange = (value: string) => {
    setSearchTerm(value);
    setCurrentPage(1);
  };

  const resetForm = () => {
    setFormData({
      first_name: '',
      last_name: '',
      email: '',
      phone: '',
      ic_number: '',
      nationality: '',
      address_line1: '',
      city: '',
      state_province: '',
      postal_code: '',
      country: '',
      company_name: '',
      guest_type: 'non_member',
      tourism_type: 'local',
      discount_percentage: 0,
    });
  };

  const handleCreateClick = () => {
    resetForm();
    setDialogError(null);
    setCreateDialogOpen(true);
  };

  const handleEditClick = (guest: Guest) => {
    setEditingGuest(guest);
    setDialogError(null);
    const [firstName, ...lastNameParts] = guest.full_name.split(' ');
    setFormData({
      first_name: firstName || '',
      last_name: lastNameParts.join(' ') || '',
      email: guest.email || '',
      phone: guest.phone || '',
      ic_number: guest.ic_number || '',
      nationality: guest.nationality || '',
      address_line1: guest.address_line1 || '',
      city: guest.city || '',
      state_province: guest.state_province || '',
      postal_code: guest.postal_code || '',
      country: guest.country || '',
      company_name: guest.company_name || '',
      guest_type: guest.guest_type || 'non_member',
      tourism_type: guest.tourism_type,
      discount_percentage: guest.discount_percentage || 0,
    });
    setEditDialogOpen(true);
  };

  const handleDeleteClick = (guest: Guest) => {
    setDeletingGuest(guest);
    setDeleteDialogOpen(true);
  };

  const handleViewBookings = (guest: Guest) => {
    setViewingGuest(guest);
    setBookingsDialogOpen(true);
  };

  const handleViewCredits = (guest: Guest) => {
    setViewingGuest(guest);
    setCreditsDialogOpen(true);
  };

  const handleCreateBookingForGuest = async (guest: Guest) => {
    setBookingGuest(guest);
    setBookingDialogOpen(true);
    if (rooms.length === 0) {
      await loadRooms();
    }
  };

  const focusDuplicateGuestSearch = (message: string) => {
    const duplicate = duplicateGuestReference(message);
    if (!duplicate) return;

    setSearchTerm(duplicate.id || duplicate.name);
    setSegment('all');
    setCurrentPage(1);
    setSelectedGuestId(null);
    setGuestDetailsOpen(true);
  };

  const handleCreateGuest = async () => {
    if (!formData.first_name || !formData.last_name) {
      setDialogError('First name and last name are required');
      return;
    }

    const tourismType = formData.tourism_type || 'local';

    // Email and phone are both optional — contact details are collected at
    // check-in, so guest creation/editing is not blocked when both are absent.

    // Validate email format only if provided
    if (formData.email && formData.email.trim()) {
      const emailError = validateEmail(formData.email);
      if (emailError) {
        setDialogError(emailError);
        return;
      }
    }

    try {
      setFormLoading(true);
      setDialogError(null);
      // Sanitize form data - convert empty strings to undefined
      const sanitizedData = {
        ...formData,
        tourism_type: tourismType,
        email: formData.email?.trim() || undefined,
        phone: formData.phone?.trim() || undefined,
        ic_number: formData.ic_number?.trim() || undefined,
        nationality: formData.nationality?.trim() || undefined,
        address_line1: formData.address_line1?.trim() || undefined,
        city: formData.city?.trim() || undefined,
        state_province: formData.state_province?.trim() || undefined,
        postal_code: formData.postal_code?.trim() || undefined,
        country: formData.country?.trim() || undefined,
        company_name: formData.company_name?.trim() || undefined,
      };
      await createGuestMutation.mutateAsync(sanitizedData);
      emitApiNotification({ message: 'Guest created successfully', severity: 'success' });
      setCreateDialogOpen(false);
      setDialogError(null);
      resetForm();
      await loadGuests();
    } catch (err: any) {
      const message = err.message || 'Failed to create guest';
      setDialogError(message);
      focusDuplicateGuestSearch(message);
    } finally {
      setFormLoading(false);
    }
  };

  const handleUpdateGuest = async () => {
    if (!editingGuest) return;

    // Validate required fields
    if (!formData.first_name || !formData.last_name) {
      setDialogError('First name and last name are required');
      return;
    }

    // Email and phone are both optional — contact details are collected at
    // check-in, so guest creation/editing is not blocked when both are absent.

    // Validate email format only if provided
    if (formData.email && formData.email.trim()) {
      const emailError = validateEmail(formData.email);
      if (emailError) {
        setDialogError(emailError);
        return;
      }
    }

    try {
      setFormLoading(true);
      setDialogError(null);
      await updateGuestMutation.mutateAsync({ guestId: editingGuest.id, data: formData });
      emitApiNotification({ message: 'Guest updated successfully', severity: 'success' });
      setEditDialogOpen(false);
      setEditingGuest(null);
      setDialogError(null);
      resetForm();
      await loadGuests();
    } catch (err: any) {
      const message = err.message || 'Failed to update guest';
      setDialogError(message);
      focusDuplicateGuestSearch(message);
    } finally {
      setFormLoading(false);
    }
  };

  const handleApplyTourismFromLastCheckIn = async (guest: Guest) => {
    try {
      setTourismConversionGuestId(guest.id);
      setError(null);
      const response = await applyGuestTourismMutation.mutateAsync(guest.id);
      const tourismLabel = response.guest.tourism_type === 'foreign' ? 'Tourist' : 'Local';
      const bookingLabel = response.source.booking_number || `#${response.source.booking_id}`;
      emitApiNotification({
        message: `${guest.full_name} marked ${tourismLabel} from booking ${bookingLabel}`,
        severity: 'success',
      });
      await loadGuests();
    } catch (err: any) {
      setError(err.message || 'Failed to update guest tourism type');
    } finally {
      setTourismConversionGuestId(null);
    }
  };

  const handleDeleteGuest = async () => {
    if (!deletingGuest) return;

    try {
      setFormLoading(true);
      await deleteGuestMutation.mutateAsync(deletingGuest.id);
      emitApiNotification({ message: 'Guest deleted successfully', severity: 'success' });
      setDeleteDialogOpen(false);
      setDeletingGuest(null);
      await loadGuests();
    } catch (err: any) {
      setError(err.message || 'Failed to delete guest');
    } finally {
      setFormLoading(false);
    }
  };

  const guestPagination = React.useMemo(
    () => getPaginationState({ page: currentPage, pageSize: PAGE_SIZE, totalItems: totalGuests }),
    [currentPage, totalGuests]
  );

  if (!hasAccess) {
    return (
      <Alert severity="warning">
        You do not have permission to access this page. Contact your administrator for access.
      </Alert>
    );
  }

  const nonMemberStats = statsTotal - statsMembers;
  const segmentCounts = getGuestSegmentCounts({
    total: statsTotal,
    members: statsMembers,
    missingInfo: statsMissingInfo,
    missingTourism: statsMissingTourism,
    tourists: statsTourists,
  });

  // Map a segment key to a config used to render the chip. Counts come from
  // total-only API queries, so they stay accurate across paginated guest lists.
  const segmentChips: Array<{
    k: GuestSegment;
    label: string;
    count: number;
    icon?: React.ReactNode;
    tone?: string;
  }> = [
    { k: 'all', label: 'All guests', count: segmentCounts.all },
    { k: 'member', label: 'Members', count: segmentCounts.member, icon: <MemberIcon sx={{ fontSize: 14 }} />, tone: GUEST_DESIGN.gold },
    { k: 'non', label: 'Non-members', count: segmentCounts.non },
    { k: 'incomplete', label: 'Missing info', count: segmentCounts.incomplete, tone: GUEST_DESIGN.amber },
    { k: 'tourist', label: 'Tourists', count: segmentCounts.tourist, tone: GUEST_DESIGN.blue },
    { k: 'missingTourism', label: 'Missing tourism', count: segmentCounts.missingTourism, icon: <MissingTourismIcon sx={{ fontSize: 14 }} />, tone: GUEST_DESIGN.rose },
  ];

  const onSegmentChange = (next: GuestSegment) => {
    setSegment(next);
    setCurrentPage(1);
  };

  const today = new Date();
  const dateLabel = today.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, color: GUEST_DESIGN.ink }}>
      {pageError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {pageError}
        </Alert>
      )}

      {/* Page header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography sx={{ fontSize: 11, color: GUEST_DESIGN.ink3, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            People · {dateLabel}
          </Typography>
          <Typography sx={{ m: 0, fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', mt: 0.5 }}>
            Guests
          </Typography>
          <Typography sx={{ m: 0, mt: 0.4, fontSize: 13, color: GUEST_DESIGN.ink3 }}>
            <Box component="strong" sx={{ color: GUEST_DESIGN.ink, fontVariantNumeric: 'tabular-nums' }}>{statsTotal}</Box> total
            {' · '}
            <Box component="strong" sx={{ color: GUEST_DESIGN.gold, fontVariantNumeric: 'tabular-nums' }}>{statsMembers}</Box> members
            {' · '}
            <Box component="strong" sx={{ color: GUEST_DESIGN.ink3, fontVariantNumeric: 'tabular-nums' }}>{nonMemberStats}</Box> non-members
            {' · '}
            <Box component="strong" sx={{ color: GUEST_DESIGN.rose, fontVariantNumeric: 'tabular-nums' }}>{statsMissingTourism}</Box> missing tourism
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            startIcon={<ExportIcon />}
            onClick={handleExportGuests}
            sx={{
              px: 1.75,
              py: 1.1,
              borderRadius: 1.5,
              border: `1px solid ${GUEST_DESIGN.rule}`,
              bgcolor: 'background.paper',
              color: GUEST_DESIGN.ink2,
              fontSize: 13,
              fontWeight: 600,
              textTransform: 'none',
              '&:hover': { bgcolor: GUEST_DESIGN.paper2 },
            }}
            disabled={loading}
            title="Export visible guests"
          >
            Export CSV
          </Button>
          <Button
            startIcon={<AddIcon />}
            onClick={handleCreateClick}
            sx={{
              px: 2,
              py: 1.1,
              borderRadius: 1.5,
              bgcolor: GUEST_DESIGN.green700,
              color: '#fff',
              fontSize: 13,
              fontWeight: 700,
              textTransform: 'none',
              boxShadow: '0 4px 14px -8px rgba(31,129,99,0.5)',
              '&:hover': { bgcolor: GUEST_DESIGN.green600 },
            }}
          >
            Add guest
          </Button>
        </Box>
      </Box>

      {/* Two-pane layout: list (flex) + sticky detail (400px) */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: selectedGuest ? '1fr 400px' : '1fr' }, gap: 1.75, alignItems: 'flex-start' }}>
        {/* LEFT: list */}
        <Box sx={{ bgcolor: 'background.paper', border: `1px solid ${GUEST_DESIGN.rule}`, borderRadius: 1.5, overflow: 'hidden' }}>
          {/* Search */}
          <Box sx={{ p: '14px 16px 0' }}>
            <Box
              component="label"
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.25,
                px: 1.75,
                py: 1.25,
                bgcolor: GUEST_DESIGN.paper2,
                border: `1px solid ${GUEST_DESIGN.rule}`,
                borderRadius: 1.25,
              }}
            >
              <SearchIcon sx={{ color: GUEST_DESIGN.ink4, fontSize: 18 }} />
              <Box
                component="input"
                value={searchTerm}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleSearchChange(e.target.value)}
                placeholder="Search by ID, name, phone, email, IC number, or company…"
                sx={{
                  border: 0,
                  background: 'transparent',
                  outline: 'none',
                  flex: 1,
                  fontSize: 14,
                  fontFamily: 'inherit',
                  color: 'inherit',
                  '::placeholder': { color: GUEST_DESIGN.ink4 },
                }}
              />
              {searchTerm && (
                <IconButton
                  size="small"
                  onClick={() => handleSearchChange('')}
                  sx={{ color: GUEST_DESIGN.ink4 }}
                >
                  <CloseIcon sx={{ fontSize: 16 }} />
                </IconButton>
              )}
            </Box>
          </Box>

          {/* Segment chips */}
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, p: '12px 16px', borderBottom: `1px solid ${GUEST_DESIGN.rule}` }}>
            {segmentChips.map((f) => {
              const active = segment === f.k;
              return (
                <Box
                  key={f.k}
                  component="button"
                  onClick={() => onSegmentChange(f.k)}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.75,
                    px: 1.5,
                    py: 0.85,
                    borderRadius: 999,
                    fontSize: 12.5,
                    fontWeight: 600,
                    cursor: 'pointer',
                    border: active ? `1px solid ${GUEST_DESIGN.ink}` : `1px solid ${GUEST_DESIGN.rule}`,
                    bgcolor: active ? GUEST_DESIGN.ink : 'background.paper',
                    color: active ? '#fff' : GUEST_DESIGN.ink2,
                    fontFamily: 'inherit',
                    transition: 'background-color 120ms',
                    '&:hover': { bgcolor: active ? GUEST_DESIGN.ink : GUEST_DESIGN.paper2 },
                  }}
                >
                  {f.icon && (
                    <Box sx={{ display: 'inline-flex', color: active ? '#fff' : (f.tone || GUEST_DESIGN.ink3) }}>
                      {f.icon}
                    </Box>
                  )}
                  {f.label}
                  <Box
                    component="span"
                    sx={{
                      fontSize: 11,
                      fontWeight: 700,
                      px: 0.85,
                      py: '1px',
                      borderRadius: 999,
                      minWidth: 18,
                      textAlign: 'center',
                      bgcolor: active ? 'rgba(255,255,255,0.18)' : (f.tone ? alpha(f.tone, 0.12) : GUEST_DESIGN.paper3),
                      color: active ? '#fff' : (f.tone || GUEST_DESIGN.ink3),
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {f.count}
                  </Box>
                </Box>
              );
            })}
          </Box>

          {/* Count + sort row */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', px: 2, py: 1.25, bgcolor: GUEST_DESIGN.paper2, borderBottom: `1px solid ${GUEST_DESIGN.rule}`, fontSize: 11.5, color: GUEST_DESIGN.ink3 }}>
            <Box>
              {visibleGuests.length} of {totalGuests} guests
              {(searchTerm || segment !== 'all') && ' (filtered)'}
            </Box>
            <Box sx={{ fontSize: 11.5, color: GUEST_DESIGN.ink2, fontWeight: 600 }}>
              Sort: A–Z
            </Box>
          </Box>

          {/* List body */}
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
              <CircularProgress size={28} />
            </Box>
          ) : visibleGuests.length === 0 ? (
            <Box sx={{ p: '48px 20px', textAlign: 'center', color: GUEST_DESIGN.ink3 }}>
              <Typography sx={{ fontSize: 14, fontWeight: 600 }}>No guests match</Typography>
              <Typography sx={{ fontSize: 12.5, mt: 0.5 }}>Try clearing the search or selecting a different filter.</Typography>
            </Box>
          ) : (
            guestsByLetter.map(([letter, group]) => (
              <Box key={letter}>
                <Box sx={{ px: 2, py: 1, bgcolor: GUEST_DESIGN.paper2, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: GUEST_DESIGN.ink3, borderBottom: `1px solid ${GUEST_DESIGN.rule}` }}>
                  {letter}
                </Box>
                {group.map((g) => {
                  const av = avatarFor(g.id);
                  const isMember = g.guest_type === 'member';
                  const isSelected = selectedGuestId === g.id;
                  return (
                    <Box
                      key={g.id}
                      component="button"
                      onClick={() => {
                        setSelectedGuestId(g.id);
                        setGuestDetailsOpen(true);
                      }}
                      sx={{
                        width: '100%',
                        display: 'grid',
                        gridTemplateColumns: 'auto 1fr auto',
                        gap: 1.75,
                        px: '13px',
                        py: '14px',
                        alignItems: 'center',
                        textAlign: 'left',
                        cursor: 'pointer',
                        border: 0,
                        borderBottom: `1px solid ${GUEST_DESIGN.rule}`,
                        borderLeft: `3px solid ${isSelected ? GUEST_DESIGN.green600 : 'transparent'}`,
                        bgcolor: isSelected ? GUEST_DESIGN.green50 : 'transparent',
                        fontFamily: 'inherit',
                        color: 'inherit',
                        transition: 'background-color 120ms',
                        '&:hover': { bgcolor: isSelected ? GUEST_DESIGN.green50 : GUEST_DESIGN.paper2 },
                      }}
                    >
                      <Box sx={{ position: 'relative', flexShrink: 0 }}>
                        <Box sx={{
                          width: 42,
                          height: 42,
                          borderRadius: '50%',
                          bgcolor: av.bg,
                          color: av.fg,
                          display: 'grid',
                          placeItems: 'center',
                          fontWeight: 700,
                          fontSize: 13,
                          border: '1px solid rgba(0,0,0,0.05)',
                        }}>
                          {initialsOf(g.full_name)}
                        </Box>
                        {isMember && (
                          <Box sx={{
                            position: 'absolute',
                            bottom: -2,
                            right: -2,
                            width: 18,
                            height: 18,
                            borderRadius: '50%',
                            bgcolor: GUEST_DESIGN.goldBg,
                            border: '2px solid',
                            borderColor: 'background.paper',
                            display: 'grid',
                            placeItems: 'center',
                            color: GUEST_DESIGN.gold,
                          }}>
                            <MemberIcon sx={{ fontSize: 10 }} />
                          </Box>
                        )}
                      </Box>

                      <Box sx={{ minWidth: 0 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.4 }}>
                          <Typography sx={{ fontSize: 14.5, fontWeight: 700, color: GUEST_DESIGN.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {g.full_name}
                          </Typography>
                          {isMember && (
                            <Box sx={{
                              fontSize: 10.5,
                              fontWeight: 700,
                              color: GUEST_DESIGN.gold,
                              px: 0.85,
                              py: '2px',
                              bgcolor: GUEST_DESIGN.goldBg,
                              borderRadius: 999,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 0.4,
                              flexShrink: 0,
                            }}>
                              <MemberIcon sx={{ fontSize: 10 }} /> Member
                            </Box>
                          )}
                          {g.tourism_type === 'foreign' && (
                            <Box sx={{
                              fontSize: 10.5,
                              fontWeight: 700,
                              color: GUEST_DESIGN.blue,
                              px: 0.85,
                              py: '2px',
                              bgcolor: GUEST_DESIGN.blueBg,
                              borderRadius: 999,
                              flexShrink: 0,
                            }}>
                              Tourist
                            </Box>
                          )}
                          {g.tourism_type === 'local' && (
                            <Box sx={{
                              fontSize: 10.5,
                              fontWeight: 700,
                              color: GUEST_DESIGN.green700,
                              px: 0.85,
                              py: '2px',
                              bgcolor: GUEST_DESIGN.green50,
                              borderRadius: 999,
                              flexShrink: 0,
                            }}>
                              Local
                            </Box>
                          )}
                          {guestHasMissingTourismType(g) && (
                            <Box sx={{
                              fontSize: 10.5,
                              fontWeight: 700,
                              color: GUEST_DESIGN.rose,
                              px: 0.85,
                              py: '2px',
                              bgcolor: alpha(GUEST_DESIGN.rose, 0.1),
                              borderRadius: 999,
                              flexShrink: 0,
                            }}>
                              Missing tourism
                            </Box>
                          )}
                        </Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.75, fontSize: 12.5, color: GUEST_DESIGN.ink3, flexWrap: 'wrap' }}>
                          {g.phone ? (
                            <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.6, fontVariantNumeric: 'tabular-nums' }}>
                              <PhoneIcon sx={{ fontSize: 12 }} /> {g.phone}
                            </Box>
                          ) : (
                            <Box sx={{ color: GUEST_DESIGN.ink4, fontStyle: 'italic' }}>No phone on file</Box>
                          )}
                          {g.email && (
                            <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.6, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              <MailIcon sx={{ fontSize: 12, flexShrink: 0 }} /> <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.email}</span>
                            </Box>
                          )}
                          {g.company_name && (
                            <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.6 }}>
                              <CompanyIcon sx={{ fontSize: 12 }} /> {g.company_name}
                            </Box>
                          )}
                        </Box>
                      </Box>

                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexShrink: 0 }}>
                        <Box sx={{ textAlign: 'right', lineHeight: 1.2 }}>
                          <Typography sx={{ fontSize: 13.5, fontWeight: 700, color: GUEST_DESIGN.ink, fontVariantNumeric: 'tabular-nums' }}>
                            {(g.bookings_count ?? 0) === 0
                              ? 'No stays'
                              : `${g.bookings_count} ${g.bookings_count === 1 ? 'stay' : 'stays'}`}
                          </Typography>
                          <Typography sx={{ fontSize: 11.5, color: GUEST_DESIGN.ink3, mt: 0.25 }}>
                            {g.last_stay_date
                              ? `Last: ${new Date(g.last_stay_date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`
                              : 'Never stayed'}
                          </Typography>
                        </Box>
                        <ArrowRightIcon sx={{ fontSize: 16, color: GUEST_DESIGN.green700, opacity: isSelected ? 1 : 0.35 }} />
                      </Box>
                    </Box>
                  );
                })}
              </Box>
            ))
          )}

          {/* Pagination footer */}
          {guestPagination.hasMultiplePages && (
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', px: 2, py: 1.5, bgcolor: GUEST_DESIGN.paper2, borderTop: `1px solid ${GUEST_DESIGN.rule}`, fontSize: 12, color: GUEST_DESIGN.ink3 }}>
              <Box>
                Showing {guestPagination.startItem}–{guestPagination.endItem} of {guestPagination.totalItems}
              </Box>
              <Pagination
                count={guestPagination.totalPages}
                page={guestPagination.currentPage}
                onChange={(_, page) => setCurrentPage(page)}
                size="small"
                showFirstButton
                showLastButton
                sx={{
                  '& .MuiPaginationItem-root': { fontSize: 12, fontWeight: 600 },
                  '& .Mui-selected': { bgcolor: `${GUEST_DESIGN.green700} !important`, color: '#fff' },
                }}
              />
            </Box>
          )}
        </Box>

        {/* RIGHT: detail panel */}
        {selectedGuest && (
          <Box sx={{ position: { lg: 'sticky' }, top: { lg: 24 } }}>
            {(() => {
              const g = selectedGuest;
              const av = avatarFor(g.id);
              const isMember = g.guest_type === 'member';
              const completion = [g.email, g.phone, g.ic_number, g.company_name].filter(Boolean).length;
              const completionPct = Math.round((completion / 4) * 100);
              const completionColor = completionPct >= 75
                ? GUEST_DESIGN.green700
                : completionPct >= 50
                  ? GUEST_DESIGN.amber
                  : GUEST_DESIGN.rose;
              const firstName = g.full_name.split(' ')[0];
              return (
                <Box sx={{
                  bgcolor: 'background.paper',
                  border: `1px solid ${GUEST_DESIGN.rule}`,
                  borderRadius: 1.5,
                  overflow: 'auto',
                  maxHeight: { lg: 'calc(100vh - 88px)' },
                }}>
                  {/* Header */}
                  <Box sx={{ p: '20px 20px 18px', borderBottom: `1px solid ${GUEST_DESIGN.rule}`, position: 'relative' }}>
                    <IconButton
                      onClick={() => {
                        setSelectedGuestId(null);
                        setGuestDetailsOpen(false);
                      }}
                      size="small"
                      sx={{ position: 'absolute', top: 14, right: 14, color: GUEST_DESIGN.ink3 }}
                      title="Close details"
                    >
                      <CloseIcon sx={{ fontSize: 18 }} />
                    </IconButton>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.75, mb: 1.75 }}>
                      <Box sx={{ position: 'relative' }}>
                        <Box sx={{
                          width: 60,
                          height: 60,
                          borderRadius: '50%',
                          bgcolor: av.bg,
                          color: av.fg,
                          display: 'grid',
                          placeItems: 'center',
                          fontWeight: 700,
                          fontSize: 18,
                        }}>
                          {initialsOf(g.full_name)}
                        </Box>
                        {isMember && (
                          <Box sx={{
                            position: 'absolute',
                            bottom: -2,
                            right: -2,
                            width: 24,
                            height: 24,
                            borderRadius: '50%',
                            bgcolor: GUEST_DESIGN.goldBg,
                            border: '2px solid',
                            borderColor: 'background.paper',
                            display: 'grid',
                            placeItems: 'center',
                            color: GUEST_DESIGN.gold,
                          }}>
                            <MemberIcon sx={{ fontSize: 14 }} />
                          </Box>
                        )}
                      </Box>
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography sx={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.01em', lineHeight: 1.2 }}>
                          {g.full_name}
                        </Typography>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.6, flexWrap: 'wrap' }}>
                          {isMember ? (
                            <Box sx={{
                              fontSize: 11,
                              fontWeight: 700,
                              color: GUEST_DESIGN.gold,
                              px: 1,
                              py: '2px',
                              bgcolor: GUEST_DESIGN.goldBg,
                              borderRadius: 999,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 0.4,
                            }}>
                              <MemberIcon sx={{ fontSize: 11 }} /> Loyalty Member
                            </Box>
                          ) : (
                            <Box sx={{
                              fontSize: 11,
                              fontWeight: 600,
                              color: GUEST_DESIGN.ink3,
                              px: 1,
                              py: '2px',
                              bgcolor: GUEST_DESIGN.paper3,
                              borderRadius: 999,
                            }}>
                              Non-member
                            </Box>
                          )}
                          {g.tourism_type && (
                            <Box sx={{
                              fontSize: 11,
                              fontWeight: 700,
                              color: g.tourism_type === 'foreign' ? GUEST_DESIGN.blue : GUEST_DESIGN.green700,
                              px: 1,
                              py: '2px',
                              bgcolor: g.tourism_type === 'foreign' ? GUEST_DESIGN.blueBg : GUEST_DESIGN.green50,
                              borderRadius: 999,
                            }}>
                              {g.tourism_type === 'foreign' ? 'Tourist' : 'Local'}
                            </Box>
                          )}
                          {guestHasMissingTourismType(g) && (
                            <Box sx={{
                              fontSize: 11,
                              fontWeight: 700,
                              color: GUEST_DESIGN.rose,
                              px: 1,
                              py: '2px',
                              bgcolor: alpha(GUEST_DESIGN.rose, 0.1),
                              borderRadius: 999,
                            }}>
                              Missing tourism
                            </Box>
                          )}
                        </Box>
                      </Box>
                    </Box>

                    {/* Profile completeness */}
                    <Box sx={{ bgcolor: GUEST_DESIGN.paper2, borderRadius: 1, px: 1.5, py: 1.25 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.75, fontSize: 11.5 }}>
                        <Box sx={{ fontWeight: 600, color: GUEST_DESIGN.ink2 }}>Profile completeness</Box>
                        <Box sx={{ fontWeight: 700, color: completionColor, fontVariantNumeric: 'tabular-nums' }}>{completionPct}%</Box>
                      </Box>
                      <Box sx={{ height: 6, bgcolor: 'background.paper', borderRadius: 3, overflow: 'hidden' }}>
                        <Box sx={{ width: `${completionPct}%`, height: '100%', bgcolor: completionColor, borderRadius: 3 }} />
                      </Box>
                    </Box>
                  </Box>

                  {/* Contact */}
                  <Box sx={{ p: '16px 20px', borderBottom: `1px solid ${GUEST_DESIGN.rule}` }}>
                    <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: GUEST_DESIGN.ink3, mb: 1.5 }}>
                      Contact
                    </Typography>
                    <ContactRow icon={<PersonIcon />} label="Guest account username" value={g.account_username} placeholder="No guest account" readOnly />
                    <ContactRow icon={<PhoneIcon />} label="Phone" value={g.phone} placeholder="Add phone number" onAdd={() => handleEditClick(g)} />
                    <ContactRow icon={<MailIcon />} label="Email" value={g.email} placeholder="Add email address" onAdd={() => handleEditClick(g)} />
                    <ContactRow icon={<IdIcon />} label="IC / Passport" value={g.ic_number} placeholder="Add ID document" onAdd={() => handleEditClick(g)} />
                    <ContactRow icon={<CompanyIcon />} label="Company" value={g.company_name} placeholder="Add company" onAdd={() => handleEditClick(g)} />
                  </Box>

                  {/* Stays + perks */}
                  <Box sx={{ p: '16px 20px', borderBottom: `1px solid ${GUEST_DESIGN.rule}`, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.25 }}>
                    <StatTile
                      label="Stays"
                      value={(g.bookings_count ?? 0) === 0 ? '—' : String(g.bookings_count)}
                      accent={(g.bookings_count ?? 0) > 0 ? 'green' : undefined}
                      onClick={() => handleViewBookings(g)}
                    />
                    <StatTile
                      label="Last visit"
                      value={
                        g.last_stay_date
                          ? new Date(g.last_stay_date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
                          : '—'
                      }
                      small
                    />
                    <StatTile label="Discount" value={g.discount_percentage ? `${g.discount_percentage}%` : '—'} accent={g.discount_percentage ? 'gold' : undefined} />
                    <StatTile label="Credits" value={'View'} accent="green" onClick={() => handleViewCredits(g)} />
                  </Box>

                  {/* Actions */}
                  <Box sx={{ p: '14px 20px 20px', display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <Button
                      startIcon={<AddIcon />}
                      onClick={() => handleCreateBookingForGuest(g)}
                      sx={{
                        py: 1.5,
                        borderRadius: 1.25,
                        bgcolor: GUEST_DESIGN.green700,
                        color: '#fff',
                        fontWeight: 700,
                        fontSize: 13.5,
                        textTransform: 'none',
                        boxShadow: '0 4px 14px -8px rgba(31,129,99,0.5)',
                        '&:hover': { bgcolor: GUEST_DESIGN.green600 },
                      }}
                    >
                      New booking for {firstName}
                    </Button>
                    {canCreateEkyc && (
                      <Button
                        startIcon={<EkycIcon sx={{ fontSize: 16 }} />}
                        onClick={() => setEkycGuest(g)}
                        sx={{
                          py: 1.25,
                          borderRadius: 1.25,
                          border: `1px solid ${GUEST_DESIGN.rule}`,
                          color: GUEST_DESIGN.green700,
                          fontWeight: 700,
                          fontSize: 12.5,
                          textTransform: 'none',
                          '&:hover': { bgcolor: GUEST_DESIGN.green50 },
                        }}
                      >
                        Create eKYC
                      </Button>
                    )}
                    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
                      <Button
                        startIcon={<HistoryIcon sx={{ fontSize: 16 }} />}
                        onClick={() => handleViewBookings(g)}
                        sx={{
                          py: 1.25,
                          borderRadius: 1.25,
                          border: `1px solid ${GUEST_DESIGN.rule}`,
                          fontWeight: 600,
                          fontSize: 12.5,
                          color: GUEST_DESIGN.ink2,
                          textTransform: 'none',
                          '&:hover': { bgcolor: GUEST_DESIGN.paper2 },
                        }}
                      >
                        Stay history
                      </Button>
                      <Button
                        startIcon={<EditIcon sx={{ fontSize: 16 }} />}
                        onClick={() => handleEditClick(g)}
                        sx={{
                          py: 1.25,
                          borderRadius: 1.25,
                          border: `1px solid ${GUEST_DESIGN.rule}`,
                          fontWeight: 600,
                          fontSize: 12.5,
                          color: GUEST_DESIGN.ink2,
                          textTransform: 'none',
                          '&:hover': { bgcolor: GUEST_DESIGN.paper2 },
                        }}
                      >
                        Edit profile
                      </Button>
                    </Box>
                    <Button
                      startIcon={
                        tourismConversionGuestId === g.id
                          ? <CircularProgress size={16} />
                          : <ConvertIcon sx={{ fontSize: 16 }} />
                      }
                      onClick={() => handleApplyTourismFromLastCheckIn(g)}
                      disabled={tourismConversionGuestId === g.id}
                      sx={{
                        py: 1.25,
                        borderRadius: 1.25,
                        border: `1px solid ${GUEST_DESIGN.rule}`,
                        color: GUEST_DESIGN.blue,
                        fontWeight: 700,
                        fontSize: 12.5,
                        textTransform: 'none',
                        '&:hover': { bgcolor: GUEST_DESIGN.blueBg },
                        '&.Mui-disabled': { color: GUEST_DESIGN.ink4 },
                      }}
                    >
                      Set tourism from last check-in
                    </Button>
                    {!isMember && (
                      <Button
                        startIcon={<ConvertIcon sx={{ fontSize: 16 }} />}
                        onClick={() => handleEditClick(g)}
                        sx={{
                          py: 1.25,
                          borderRadius: 1.25,
                          bgcolor: GUEST_DESIGN.goldBg,
                          color: GUEST_DESIGN.gold,
                          fontWeight: 700,
                          fontSize: 12.5,
                          textTransform: 'none',
                          '&:hover': { bgcolor: alpha(GUEST_DESIGN.gold, 0.18) },
                        }}
                      >
                        Convert to Member
                      </Button>
                    )}
                    <Button
                      startIcon={<DeleteIcon sx={{ fontSize: 16 }} />}
                      onClick={() => handleDeleteClick(g)}
                      sx={{
                        py: 1.25,
                        borderRadius: 1.25,
                        color: GUEST_DESIGN.rose,
                        fontWeight: 600,
                        fontSize: 12.5,
                        mt: 0.5,
                        textTransform: 'none',
                        '&:hover': { bgcolor: alpha(GUEST_DESIGN.rose, 0.08) },
                      }}
                    >
                      Delete guest
                    </Button>
                  </Box>
                </Box>
              );
            })()}
          </Box>
        )}
      </Box>

      <UnifiedBookingModal
        open={bookingDialogOpen}
        onClose={() => {
          setBookingDialogOpen(false);
          setBookingGuest(null);
        }}
        room={null}
        rooms={rooms}
        guests={allGuests}
        initialGuest={bookingGuest}
        onSuccess={async (message) => {
          emitApiNotification({ message, severity: 'success' });
          await loadGuests();
        }}
        onError={(message) => {
          setError(message);
        }}
        onRefreshData={async () => {
          await Promise.all([loadGuests(), loadRooms()]);
        }}
      />

      {canCreateEkyc && (
        <EkycCreateDialog
          open={Boolean(ekycGuest)}
          initialGuest={ekycGuest}
          lockGuest
          onClose={() => setEkycGuest(null)}
          onCreated={(message) => {
            emitApiNotification({ message, severity: 'success' });
            void loadGuests();
          }}
        />
      )}

      <GuestFormDialog
        open={createDialogOpen}
        mode="create"
        formData={formData}
        setFormData={setFormData}
        error={dialogError}
        loading={formLoading}
        onErrorClose={() => setDialogError(null)}
        onClose={() => { setCreateDialogOpen(false); setDialogError(null); }}
        onSubmit={handleCreateGuest}
      />

      <GuestFormDialog
        open={editDialogOpen}
        mode="edit"
        guestName={editingGuest?.full_name}
        formData={formData}
        setFormData={setFormData}
        error={dialogError}
        loading={formLoading}
        onErrorClose={() => setDialogError(null)}
        onClose={() => { setEditDialogOpen(false); setDialogError(null); }}
        onSubmit={handleUpdateGuest}
      />

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Delete Guest</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            Are you sure you want to delete guest <strong>{deletingGuest?.full_name}</strong>?
          </Alert>
          <Typography variant="body2" color="text.secondary">
            This action cannot be undone. All bookings associated with this guest will also be deleted. The guest cannot be deleted if they are currently checked in.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleDeleteGuest}
            variant="contained"
            color="error"
            disabled={formLoading}
          >
            {formLoading ? <CircularProgress size={20} /> : 'Delete Guest'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Booking History Dialog */}
      <Dialog open={bookingsDialogOpen} onClose={() => setBookingsDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Booking History: {viewingGuest?.full_name}</DialogTitle>
        <DialogContent>
          {bookingsLoading ? (
            <Box display="flex" justifyContent="center" py={3}>
              <CircularProgress />
            </Box>
          ) : guestBookings.length === 0 ? (
            <Alert severity="info" sx={{ mt: 2 }}>
              No bookings found for this guest.
            </Alert>
          ) : (
            <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
              {checkedOutGuestBookings.length > 0 && (
                <Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    <Typography variant="subtitle2" fontWeight={700}>
                      Checked out bookings
                    </Typography>
                    <Chip label={checkedOutGuestBookings.length} size="small" color="success" />
                  </Box>
                  <DataTable<GuestBookingHistoryRow>
                    data={checkedOutGuestBookings}
                    columns={guestBookingColumns}
                    emptyMessage="No checked out bookings found for this guest."
                    getRowId={(row) => String(row.id)}
                  />
                </Box>
              )}
              {voidGuestBookings.length > 0 && (
                <Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    <Typography variant="subtitle2" fontWeight={700}>
                      Void bookings
                    </Typography>
                    <Chip label={voidGuestBookings.length} size="small" />
                  </Box>
                  <DataTable<GuestBookingHistoryRow>
                    data={voidGuestBookings}
                    columns={guestBookingColumns}
                    emptyMessage="No void bookings found for this guest."
                    getRowId={(row) => String(row.id)}
                  />
                </Box>
              )}
              {otherGuestBookings.length > 0 && (
                <Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    <Typography variant="subtitle2" fontWeight={700}>
                      Other bookings
                    </Typography>
                    <Chip label={otherGuestBookings.length} size="small" color="info" />
                  </Box>
                  <DataTable<GuestBookingHistoryRow>
                    data={otherGuestBookings}
                    columns={guestBookingColumns}
                    emptyMessage="No other bookings found for this guest."
                    getRowId={(row) => String(row.id)}
                  />
                </Box>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBookingsDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Credits Dialog */}
      <Dialog open={creditsDialogOpen} onClose={() => setCreditsDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <GiftIcon color="secondary" />
          Free Gift Credits: {viewingGuest?.full_name}
        </DialogTitle>
        <DialogContent>
          {creditsLoading ? (
            <Box display="flex" justifyContent="center" py={3}>
              <CircularProgress />
            </Box>
          ) : guestCredits ? (
            <Box>
              {/* Credits by Room Type */}
              {guestCredits.credits_by_room_type.length > 0 && (
                <Box mb={3}>
                  <Typography variant="subtitle2" color="text.secondary" mb={1}>
                    Credits by Room Type:
                  </Typography>
                  {guestCredits.credits_by_room_type.map((credit) => (
                    <Box
                      key={credit.id}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        backgroundColor: 'success.light',
                        borderRadius: 1,
                        px: 2,
                        py: 1,
                        mb: 1,
                      }}
                    >
                      <Box>
                        <Typography variant="body1" fontWeight={600}>
                          {credit.room_type_name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Code: {credit.room_type_code}
                        </Typography>
                      </Box>
                      <Chip
                        icon={<GiftIcon sx={{ fontSize: 16 }} />}
                        label={`${credit.nights_available} night${credit.nights_available !== 1 ? 's' : ''}`}
                        color="success"
                      />
                    </Box>
                  ))}
                </Box>
              )}

              {/* Total */}
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  borderTop: '2px solid',
                  borderColor: 'divider',
                  pt: 2,
                  mt: 2,
                }}
              >
                <Typography variant="h6" fontWeight={600}>
                  Total Available:
                </Typography>
                <Chip
                  icon={<GiftIcon />}
                  label={`${guestCredits.total_nights} night${guestCredits.total_nights !== 1 ? 's' : ''}`}
                  color="secondary"
                  sx={{ fontSize: '1rem', py: 2 }}
                />
              </Box>

              {guestCredits.total_nights === 0 && (
                <Alert severity="info" sx={{ mt: 2 }}>
                  This guest has no complimentary credits available.
                </Alert>
              )}
            </Box>
          ) : (
            <Alert severity="info">
              No credits information available.
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreditsDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default GuestConfigurationPage;

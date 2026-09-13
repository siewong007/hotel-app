import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  IconButton,
  InputAdornment,
  Pagination,
  Paper,
  TextField,
} from '@mui/material';
import {
  Add as AddIcon,
  BlockOutlined as BlacklistedIcon,
  Close as CloseIcon,
  ErrorOutlineOutlined as MissingInfoIcon,
  FileDownloadOutlined as ExportIcon,
  FlightTakeoffOutlined as TouristIcon,
  GroupOutlined as TotalIcon,
  PersonOutlined as NonMemberIcon,
  PersonOutlined as PersonIcon,
  Search as SearchIcon,
  SearchOffOutlined as SearchOffIcon,
  Star as MemberIcon,
  SupportAgentOutlined as OpenRequestsIcon,
  WarningAmberOutlined as MissingTourismIcon,
  WorkspacePremiumOutlined as VipIcon,
} from '@mui/icons-material';
import type { Guest } from '../../../types';
import { errorMessage } from '../../../utils';
import { getQueryErrorMessage } from '../../../api/queryConfig';
import { EmptyState, PageHeader, StatStrip } from '../../../components';
import type { StatStripItem } from '../../../components';
import { useAuth } from '../../../auth/AuthContext';
import { useConfirm } from '../../../components/common/ConfirmProvider';
import { useNavigate, useSearchParams } from '../../../router';
import { validateEmail } from '../../../utils/validation';
import { emitApiNotification } from '../../../utils/apiNotifications';
import { getPaginationState, normalizePage, toPaginationSearchParams } from '../../../utils/pagination';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import {
  useApplyGuestTourismFromLastCheckIn,
  useCreateGuest,
  useDeleteGuest,
  useGuests,
  useGuestsPage,
  useUpdateGuest,
} from '../../guests/hooks/useGuestQueries';
import { useRooms } from '../../rooms/hooks/useRoomQueries';
import UnifiedBookingModal from '../../rooms/components/UnifiedBooking';
import EkycCreateDialog from '../../ekyc/components/EkycCreateDialog';
import { GUEST_DESIGN } from '../../guests/constants';
import type { GuestFormData } from '../../guests/types';
import GuestFormDialog from '../components/GuestFormDialog';
import GuestSegmentChips from '../components/GuestSegmentChips';
import GuestListTable from '../components/GuestListTable';
import GuestBookingHistoryDialog from '../components/GuestBookingHistoryDialog';
import GuestCreditsDialog from '../components/GuestCreditsDialog';
import GuestPortalAccountDialog from '../components/GuestPortalAccountDialog';
import { useGuestStatTotals } from '../hooks/useGuestStatTotals';
import {
  getGuestRelationsSegmentQueryParams,
  guestMatchesSegment,
  type GuestRelationsSegment,
} from '../segments';
import { buildGuestsCsv, duplicateGuestReference } from '../utils';
import { formatLocalDate } from '../../../utils/date';

const PAGE_SIZE = 50;

const emptyGuestForm = (): GuestFormData => ({
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

const GuestRelationsPage: React.FC = () => {
  const [pageSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { hasPermission } = useAuth();
  const hasAccess = hasPermission('guests:read') || hasPermission('guests:manage');
  const canCreateEkyc = hasPermission('ekyc:approve');
  const canTransferPortalAccount = hasPermission('guests:update') || hasPermission('guests:manage');

  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [segment, setSegment] = useState<GuestRelationsSegment>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const debouncedSearchTerm = useDebouncedValue(searchTerm, searchTerm ? 400 : 0);

  const segmentQueryParams = React.useMemo(
    () => getGuestRelationsSegmentQueryParams(segment),
    [segment],
  );
  const guestsQueryParams = React.useMemo(() => ({
    ...toPaginationSearchParams({ page: normalizePage(currentPage), pageSize: PAGE_SIZE }),
    ...(debouncedSearchTerm.trim() ? { search: debouncedSearchTerm.trim() } : {}),
    ...segmentQueryParams,
  }), [currentPage, debouncedSearchTerm, segmentQueryParams]);

  const guestsQuery = useGuestsPage(guestsQueryParams, hasAccess);
  const stats = useGuestStatTotals(hasAccess);
  const roomsQuery = useRooms(hasAccess);
  const createGuestMutation = useCreateGuest();
  const updateGuestMutation = useUpdateGuest();
  const applyGuestTourismMutation = useApplyGuestTourismFromLastCheckIn();
  const deleteGuestMutation = useDeleteGuest();

  const guests = React.useMemo(() => guestsQuery.data?.data ?? [], [guestsQuery.data]);
  const rooms = roomsQuery.data ?? [];
  const totalGuests = guestsQuery.data?.total ?? 0;
  const loading = guestsQuery.isPending;
  const queryError =
    guestsQuery.error || stats.error || roomsQuery.error;
  const pageError = error || getQueryErrorMessage(queryError, '') || null;

  // Deep links (`?search=` / `?guest_id=`) — same contract as the legacy page
  // so global-search results keep landing here until Task 16 wires the
  // `/guest-relations` routes.
  const routedGuestSearch = pageSearchParams.get('search') || '';
  const routedGuestId = pageSearchParams.get('guest_id') || '';

  useEffect(() => {
    if (!routedGuestSearch && !routedGuestId) return;
    setSearchTerm(routedGuestSearch || routedGuestId);
    setSegment('all');
    setCurrentPage(1);
  }, [routedGuestSearch, routedGuestId]);

  // Dialog state
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [bookingDialogOpen, setBookingDialogOpen] = useState(false);
  const [historyGuest, setHistoryGuest] = useState<Guest | null>(null);
  const [creditsGuest, setCreditsGuest] = useState<Guest | null>(null);
  const [portalAccountGuest, setPortalAccountGuest] = useState<Guest | null>(null);
  const [bookingGuest, setBookingGuest] = useState<Guest | null>(null);
  const [ekycGuest, setEkycGuest] = useState<Guest | null>(null);

  // The booking modal searches its guest list client-side, so it needs the
  // full roster — not the 50-row page shown in the table. Load it lazily, only
  // while the modal is open.
  const allGuestsQuery = useGuests(undefined, hasAccess && bookingDialogOpen);
  const allGuests = allGuestsQuery.data ?? [];

  // Form state
  const [formData, setFormData] = useState<GuestFormData>(emptyGuestForm);
  const [editingGuest, setEditingGuest] = useState<Guest | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [tourismConversionGuestId, setTourismConversionGuestId] = useState<number | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const loadGuests = useCallback(async () => {
    await Promise.all([guestsQuery.refetch(), stats.refetchAll()]);
  }, [guestsQuery, stats]);

  const loadRooms = useCallback(async () => {
    await roomsQuery.refetch();
  }, [roomsQuery]);

  // The API applies the active segment to the paginated query. Keep this as a
  // defensive client-side guard so stale placeholder rows never leak between
  // segment transitions.
  const visibleGuests = React.useMemo(
    () => guests.filter((guest) => guestMatchesSegment(guest, segment)),
    [guests, segment],
  );

  const handleExportGuests = () => {
    if (visibleGuests.length === 0) {
      emitApiNotification({ message: 'No guests in the current view to export', severity: 'info' });
      return;
    }

    const csv = buildGuestsCsv(visibleGuests);
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

  const handleSearchChange = (value: string) => {
    setSearchTerm(value);
    setCurrentPage(1);
  };

  const handleSegmentChange = (next: GuestRelationsSegment) => {
    setSegment(next);
    setCurrentPage(1);
  };

  const clearFilters = () => {
    setSearchTerm('');
    setSegment('all');
    setCurrentPage(1);
  };

  const resetForm = () => setFormData(emptyGuestForm());

  const handleCreateClick = () => {
    resetForm();
    setDialogError(null);
    setCreateDialogOpen(true);
  };

  const handleEditClick = (guest: Guest) => {
    setEditingGuest(guest);
    setDialogError(null);
    // Prefer the legal name the API now returns. Splitting the nickname is a
    // fallback for rows predating that, where `nick_name` was the only name
    // held; it must never win over a real first/last.
    const hasLegalName = Boolean(guest.first_name?.trim() && guest.last_name?.trim());
    const [splitFirstName, ...splitLastNameParts] = guest.nick_name.split(' ');
    setFormData({
      first_name: hasLegalName ? (guest.first_name ?? '') : (splitFirstName || ''),
      last_name: hasLegalName ? (guest.last_name ?? '') : (splitLastNameParts.join(' ') || ''),
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

  // Row click / View: the guest-360 route is wired in Task 16 — until then the
  // string path is a no-op navigation target (compat navigate is untyped).
  const handleOpenGuest = (guest: Guest) => {
    navigate(`/guest-relations/guests/${guest.id}`);
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
    } catch (err) {
      const message = errorMessage(err, 'Failed to create guest');
      setDialogError(message);
      focusDuplicateGuestSearch(message);
    } finally {
      setFormLoading(false);
    }
  };

  const handleUpdateGuest = async () => {
    if (!editingGuest) return;

    if (!formData.first_name || !formData.last_name) {
      setDialogError('First name and last name are required');
      return;
    }

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
    } catch (err) {
      const message = errorMessage(err, 'Failed to update guest');
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
        message: `${guest.nick_name} marked ${tourismLabel} from booking ${bookingLabel}`,
        severity: 'success',
      });
      await loadGuests();
    } catch (err) {
      setError(errorMessage(err, 'Failed to update guest tourism type'));
    } finally {
      setTourismConversionGuestId(null);
    }
  };

  const handleDeleteGuest = async (guest: Guest) => {
    const ok = await confirm({
      title: 'Delete guest',
      message: `Delete ${guest.nick_name}? This action cannot be undone — all bookings associated with this guest will also be deleted. The guest cannot be deleted while checked in.`,
      confirmText: 'Delete guest',
      severity: 'error',
    });
    if (!ok) return;

    try {
      await deleteGuestMutation.mutateAsync(guest.id);
      emitApiNotification({ message: 'Guest deleted successfully', severity: 'success' });
      await loadGuests();
    } catch (err) {
      setError(errorMessage(err, 'Failed to delete guest'));
    }
  };

  const guestPagination = React.useMemo(
    () => getPaginationState({ page: currentPage, pageSize: PAGE_SIZE, totalItems: totalGuests }),
    [currentPage, totalGuests],
  );

  if (!hasAccess) {
    return (
      <Alert severity="warning" sx={{ m: 2 }}>
        You do not have permission to access this page. Contact your administrator for access.
      </Alert>
    );
  }

  const { counts } = stats;
  const today = new Date();
  const dateLabel = today.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const statItems: StatStripItem[] = [
    { key: 'all', label: 'Total guests', value: counts.all, icon: <TotalIcon />, color: GUEST_DESIGN.green700, onClick: () => handleSegmentChange('all'), active: segment === 'all' },
    { key: 'member', label: 'Members', value: counts.member, icon: <MemberIcon />, color: GUEST_DESIGN.gold, onClick: () => handleSegmentChange('member'), active: segment === 'member' },
    { key: 'non', label: 'Non-members', value: counts.non, icon: <NonMemberIcon />, onClick: () => handleSegmentChange('non'), active: segment === 'non' },
    { key: 'tourist', label: 'Tourists', value: counts.tourist, icon: <TouristIcon />, color: GUEST_DESIGN.blue, onClick: () => handleSegmentChange('tourist'), active: segment === 'tourist' },
    { key: 'incomplete', label: 'Missing info', value: counts.incomplete, icon: <MissingInfoIcon />, color: GUEST_DESIGN.amber, onClick: () => handleSegmentChange('incomplete'), active: segment === 'incomplete' },
    { key: 'missingTourism', label: 'Missing tourism', value: counts.missingTourism, icon: <MissingTourismIcon />, color: GUEST_DESIGN.rose, onClick: () => handleSegmentChange('missingTourism'), active: segment === 'missingTourism' },
    { key: 'vip', label: 'VIP', value: counts.vip, icon: <VipIcon />, color: '#5b3aa8', onClick: () => handleSegmentChange('vip'), active: segment === 'vip' },
    { key: 'blacklisted', label: 'Blacklisted', value: counts.blacklisted, icon: <BlacklistedIcon />, color: GUEST_DESIGN.rose, onClick: () => handleSegmentChange('blacklisted'), active: segment === 'blacklisted' },
    { key: 'openRequests', label: 'Open requests', value: counts.openRequests, icon: <OpenRequestsIcon />, color: GUEST_DESIGN.blue, onClick: () => handleSegmentChange('openRequests'), active: segment === 'openRequests' },
  ];

  const isFiltered = Boolean(debouncedSearchTerm.trim()) || segment !== 'all';
  const emptyMessage = isFiltered ? (
    <EmptyState
      icon={<SearchOffIcon />}
      title="No guests match"
      description="Try clearing the search or selecting a different filter."
      action={<Button size="small" onClick={clearFilters}>Clear filters</Button>}
    />
  ) : (
    <EmptyState
      icon={<PersonIcon />}
      title="No guests yet"
      description="Add your first guest to start building guest relations."
      action={
        <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={handleCreateClick}>
          Add guest
        </Button>
      }
    />
  );

  const tableActions = {
    onOpen: handleOpenGuest,
    onEdit: handleEditClick,
    onNewBooking: handleCreateBookingForGuest,
    onStayHistory: setHistoryGuest,
    onViewCredits: setCreditsGuest,
    onConvertTourism: handleApplyTourismFromLastCheckIn,
    onTransferPortalAccount: setPortalAccountGuest,
    onCreateEkyc: setEkycGuest,
    onDelete: handleDeleteGuest,
  };

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, color: GUEST_DESIGN.ink }}>
      {pageError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {pageError}
        </Alert>
      )}

      <PageHeader
        kicker={`Guest relations · ${dateLabel}`}
        title="Guests"
        subtitle={
          <>
            <Box component="strong" sx={{ color: GUEST_DESIGN.ink, fontVariantNumeric: 'tabular-nums' }}>{counts.all}</Box> total
            {' · '}
            <Box component="strong" sx={{ color: GUEST_DESIGN.gold, fontVariantNumeric: 'tabular-nums' }}>{counts.member}</Box> members
            {' · '}
            <Box component="strong" sx={{ color: GUEST_DESIGN.ink3, fontVariantNumeric: 'tabular-nums' }}>{counts.non}</Box> non-members
            {' · '}
            <Box component="strong" sx={{ color: GUEST_DESIGN.rose, fontVariantNumeric: 'tabular-nums' }}>{counts.missingTourism}</Box> missing tourism
          </>
        }
        actions={
          <>
            <Button
              startIcon={<ExportIcon />}
              onClick={handleExportGuests}
              variant="outlined"
              disabled={loading}
              title="Export visible guests"
              sx={{ textTransform: 'none' }}
            >
              Export CSV
            </Button>
            <Button
              startIcon={<AddIcon />}
              onClick={handleCreateClick}
              variant="contained"
              sx={{ textTransform: 'none' }}
            >
              Add guest
            </Button>
          </>
        }
      />

      <StatStrip items={statItems} sx={{ mb: 2 }} />

      <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
        {/* Search */}
        <Box sx={{ p: '14px 16px 0' }}>
          <TextField
            fullWidth
            size="small"
            value={searchTerm}
            onChange={(event) => handleSearchChange(event.target.value)}
            placeholder="Search by ID, name, phone, email, IC number, or company…"
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ color: GUEST_DESIGN.ink4, fontSize: 18 }} />
                  </InputAdornment>
                ),
                endAdornment: searchTerm ? (
                  <InputAdornment position="end">
                    <IconButton size="small" onClick={() => handleSearchChange('')} aria-label="Clear search">
                      <CloseIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </InputAdornment>
                ) : undefined,
              },
            }}
          />
        </Box>

        <GuestSegmentChips segment={segment} counts={counts} onChange={handleSegmentChange} />

        {/* Count + sort row */}
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            px: 2,
            py: 1.25,
            bgcolor: GUEST_DESIGN.paper2,
            borderBottom: `1px solid ${GUEST_DESIGN.rule}`,
            fontSize: 11.5,
            color: GUEST_DESIGN.ink3,
          }}
        >
          <Box>
            {visibleGuests.length} of {totalGuests} guests
            {isFiltered && ' (filtered)'}
          </Box>
          <Box sx={{ fontSize: 11.5, color: GUEST_DESIGN.ink2, fontWeight: 600 }}>
            Sort: A–Z
          </Box>
        </Box>

        {guestsQuery.isError && !guestsQuery.data ? (
          <Alert
            severity="error"
            sx={{ m: 2 }}
            action={
              <Button color="inherit" size="small" onClick={() => void loadGuests()}>
                Retry
              </Button>
            }
          >
            {getQueryErrorMessage(guestsQuery.error, 'Failed to load guests')}
          </Alert>
        ) : (
          <GuestListTable
            guests={visibleGuests}
            loading={loading}
            emptyMessage={emptyMessage}
            tourismConversionGuestId={tourismConversionGuestId}
            canCreateEkyc={canCreateEkyc}
            canTransferPortalAccount={canTransferPortalAccount}
            {...tableActions}
          />
        )}

        {/* Pagination footer */}
        {guestPagination.hasMultiplePages && (
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              px: 2,
              py: 1.5,
              bgcolor: GUEST_DESIGN.paper2,
              borderTop: `1px solid ${GUEST_DESIGN.rule}`,
              fontSize: 12,
              color: GUEST_DESIGN.ink3,
            }}
          >
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
      </Paper>

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
        guestName={editingGuest?.nick_name}
        formData={formData}
        setFormData={setFormData}
        error={dialogError}
        loading={formLoading}
        onErrorClose={() => setDialogError(null)}
        onClose={() => { setEditDialogOpen(false); setDialogError(null); }}
        onSubmit={handleUpdateGuest}
      />
      <GuestBookingHistoryDialog
        guest={historyGuest}
        open={Boolean(historyGuest)}
        onClose={() => setHistoryGuest(null)}
      />
      <GuestCreditsDialog
        guest={creditsGuest}
        open={Boolean(creditsGuest)}
        onClose={() => setCreditsGuest(null)}
      />
      <GuestPortalAccountDialog
        guest={portalAccountGuest}
        open={Boolean(portalAccountGuest)}
        onClose={() => setPortalAccountGuest(null)}
        onTransferred={loadGuests}
      />
    </Box>
  );
};

export default GuestRelationsPage;

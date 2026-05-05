import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  Snackbar,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Chip,
  Grid,
  InputAdornment,
  Pagination,
  MenuItem,
  alpha,
} from '@mui/material';
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  Save as SaveIcon,
  Cancel as CancelIcon,
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
  FileUploadOutlined as ImportIcon,
  AutoAwesome as ConvertIcon,
  LocationOnOutlined as LocationIcon,
  PublicOutlined as PublicIcon,
  CheckCircleOutline as CheckCircleIcon,
} from '@mui/icons-material';
import { HotelAPIService } from '../../../api';
import { Guest, GuestCreateRequest, GuestType, GUEST_TYPE_CONFIG, TourismType, TOURISM_TYPE_CONFIG } from '../../../types';
import { useAuth } from '../../../auth/AuthContext';
import { validateEmail } from '../../../utils/validation';
import { useCurrency } from '../../../hooks/useCurrency';
import {
  Star as MemberIcon,
  PersonOutline as NonMemberIcon,
} from '@mui/icons-material';

// Design tokens from the Guest Configuration Redesign mock.
const GUEST_DESIGN = {
  green700: '#1a6b50',
  green600: '#1f8163',
  green500: '#2aa078',
  green50: '#ebf7f1',
  ink: '#0c1f17',
  ink2: '#36473e',
  ink3: '#6a7a72',
  ink4: '#9aa7a0',
  paper2: '#f6f8f6',
  paper3: '#eef2ef',
  rule: '#e3e8e4',
  amber: '#b9700e',
  amberBg: '#fdf3e3',
  rose: '#b1342c',
  blue: '#1e5fa8',
  blueBg: '#e3eef9',
  gold: '#a17c1a',
  goldBg: '#faf2dc',
};
const AVATAR_PALETTE: Array<[string, string]> = [
  ['#d3eee0', '#0f3a2e'],
  ['#e3eef9', '#1e5fa8'],
  ['#ece4f9', '#5b3aa8'],
  ['#fdf3e3', '#a17c1a'],
  ['#fbe7e3', '#b1342c'],
  ['#d8eef2', '#1c6478'],
];
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

interface GuestFormData extends GuestCreateRequest {
  id?: number;
}

const PAGE_SIZE = 50;

const GuestConfigurationPage: React.FC = () => {
  const { hasRole, hasPermission } = useAuth();
  const { format: formatCurrency } = useCurrency();
  const hasAccess = hasRole('admin') || hasRole('receptionist') || hasRole('manager') || hasPermission('guests:read') || hasPermission('guests:manage');

  const [guests, setGuests] = useState<Guest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'all' | GuestType>('all');
  // Extra client-side segment narrowing on top of `filterType` (which drives the API call).
  const [segment, setSegment] = useState<'all' | 'member' | 'non' | 'incomplete' | 'tourist'>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalGuests, setTotalGuests] = useState(0);
  // Stats counts fetched once on mount, independent of filters
  const [statsTotal, setStatsTotal] = useState(0);
  const [statsMembers, setStatsMembers] = useState(0);
  // Currently selected guest in the right detail pane.
  const [selectedGuestId, setSelectedGuestId] = useState<number | null>(null);

  // Dialog states
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [bookingsDialogOpen, setBookingsDialogOpen] = useState(false);
  const [creditsDialogOpen, setCreditsDialogOpen] = useState(false);

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
  const [guestCredits, setGuestCredits] = useState<GuestCredits | null>(null);
  const [creditsLoading, setCreditsLoading] = useState(false);

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
    tourism_type: undefined,
    discount_percentage: 0,
  });

  const [editingGuest, setEditingGuest] = useState<Guest | null>(null);
  const [deletingGuest, setDeletingGuest] = useState<Guest | null>(null);
  const [viewingGuest, setViewingGuest] = useState<Guest | null>(null);
  const [guestBookings, setGuestBookings] = useState<any[]>([]);
  const [formLoading, setFormLoading] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  // Snackbar
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');

  const loadGuests = useCallback(async (opts?: { page?: number; search?: string; type?: 'all' | GuestType }) => {
    try {
      setLoading(true);
      const page = opts?.page ?? currentPage;
      const search = opts?.search ?? searchTerm;
      const type = opts?.type ?? filterType;
      const resp = await HotelAPIService.getGuestsPage({
        page,
        page_size: PAGE_SIZE,
        ...(search.trim() ? { search: search.trim() } : {}),
        ...(type !== 'all' ? { guest_type: type } : {}),
      });
      setGuests(resp.data);
      setTotalGuests(resp.total);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [currentPage, searchTerm, filterType]);

  // Fetch global stats once on mount (total + member count, independent of active filters)
  useEffect(() => {
    if (!hasAccess) return;
    Promise.all([
      HotelAPIService.getGuestsPage({ page: 1, page_size: 1 }),
      HotelAPIService.getGuestsPage({ page: 1, page_size: 1, guest_type: 'member' }),
    ]).then(([all, members]) => {
      setStatsTotal(all.total);
      setStatsMembers(members.total);
    }).catch(() => {});
  }, [hasAccess]);

  // Reload on page/filter/search changes; debounce text input
  useEffect(() => {
    if (!hasAccess) return;
    const delay = searchTerm ? 400 : 0;
    const timer = setTimeout(() => loadGuests(), delay);
    return () => clearTimeout(timer);
  }, [currentPage, searchTerm, filterType, hasAccess]);

  // Apply segment narrowing on the loaded page (extra client-side filter
  // for "incomplete"/"tourist" — the API itself only knows guest_type).
  const visibleGuests = React.useMemo(() => {
    return guests.filter((g) => {
      if (segment === 'member' && g.guest_type !== 'member') return false;
      if (segment === 'non' && g.guest_type !== 'non_member') return false;
      if (segment === 'incomplete' && g.email && g.phone) return false;
      if (segment === 'tourist' && g.tourism_type !== 'foreign') return false;
      return true;
    });
  }, [guests, segment]);

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

  // Default-select the first guest on the page when nothing is selected.
  useEffect(() => {
    if (selectedGuestId == null && visibleGuests.length > 0) {
      setSelectedGuestId(visibleGuests[0].id);
    }
  }, [selectedGuestId, visibleGuests]);

  const selectedGuest = guests.find((g) => g.id === selectedGuestId) || null;

  const handleFilterTypeChange = (_: React.MouseEvent<HTMLElement>, value: 'all' | GuestType | null) => {
    if (!value) return;
    setFilterType(value);
    setCurrentPage(1);
  };

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
      tourism_type: undefined,
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

  const handleViewBookings = async (guest: Guest) => {
    setViewingGuest(guest);
    try {
      const bookings = await HotelAPIService.getGuestBookings(guest.id);
      setGuestBookings(bookings);
      setBookingsDialogOpen(true);
    } catch (err: any) {
      setError(err.message || 'Failed to load bookings');
    }
  };

  const handleViewCredits = async (guest: Guest) => {
    setViewingGuest(guest);
    try {
      setCreditsLoading(true);
      const credits = await HotelAPIService.getGuestCredits(guest.id);
      setGuestCredits(credits);
      setCreditsDialogOpen(true);
    } catch (err: any) {
      setError(err.message || 'Failed to load credits');
    } finally {
      setCreditsLoading(false);
    }
  };

  const handleCreateGuest = async () => {
    if (!formData.first_name || !formData.last_name) {
      setDialogError('First name and last name are required');
      return;
    }

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
      await HotelAPIService.createGuest(sanitizedData);
      setSnackbarMessage('Guest created successfully');
      setSnackbarOpen(true);
      setCreateDialogOpen(false);
      setDialogError(null);
      resetForm();
      await loadGuests();
    } catch (err: any) {
      setDialogError(err.message || 'Failed to create guest');
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

    try {
      setFormLoading(true);
      setDialogError(null);
      await HotelAPIService.updateGuest(editingGuest.id, formData);
      setSnackbarMessage('Guest updated successfully');
      setSnackbarOpen(true);
      setEditDialogOpen(false);
      setEditingGuest(null);
      setDialogError(null);
      resetForm();
      await loadGuests();
    } catch (err: any) {
      setDialogError(err.message || 'Failed to update guest');
    } finally {
      setFormLoading(false);
    }
  };

  const handleDeleteGuest = async () => {
    if (!deletingGuest) return;

    try {
      setFormLoading(true);
      await HotelAPIService.deleteGuest(deletingGuest.id);
      setSnackbarMessage('Guest deleted successfully');
      setSnackbarOpen(true);
      setDeleteDialogOpen(false);
      setDeletingGuest(null);
      await loadGuests();
    } catch (err: any) {
      setError(err.message || 'Failed to delete guest');
    } finally {
      setFormLoading(false);
    }
  };

  if (!hasAccess) {
    return (
      <Alert severity="warning">
        You do not have permission to access this page. Contact your administrator for access.
      </Alert>
    );
  }

  const nonMemberStats = statsTotal - statsMembers;
  const incompleteCount = visibleGuests.filter((g) => !g.email || !g.phone).length;
  const touristCount = visibleGuests.filter((g) => g.tourism_type === 'foreign').length;
  const memberCountOnPage = visibleGuests.filter((g) => g.guest_type === 'member').length;
  const nonMemberCountOnPage = visibleGuests.filter((g) => g.guest_type === 'non_member').length;

  // Map a segment key to a config used to render the chip. Counts come from the
  // currently-loaded page; for "All" we show the API total so the user gets a
  // sense of full data set size.
  const segmentChips: Array<{
    k: typeof segment;
    label: string;
    count: number;
    icon?: React.ReactNode;
    tone?: string;
  }> = [
    { k: 'all', label: 'All guests', count: statsTotal || guests.length },
    { k: 'member', label: 'Members', count: memberCountOnPage, icon: <MemberIcon sx={{ fontSize: 14 }} />, tone: GUEST_DESIGN.gold },
    { k: 'non', label: 'Non-members', count: nonMemberCountOnPage },
    { k: 'incomplete', label: 'Missing info', count: incompleteCount, tone: GUEST_DESIGN.amber },
    { k: 'tourist', label: 'Tourists', count: touristCount, tone: GUEST_DESIGN.blue },
  ];

  // The API exposes `guest_type` filtering; map our local segment onto it so the
  // server-side counts stay accurate.
  const onSegmentChange = (next: typeof segment) => {
    setSegment(next);
    setCurrentPage(1);
    if (next === 'member') setFilterType('member');
    else if (next === 'non') setFilterType('non_member');
    else setFilterType('all');
  };

  const totalPages = Math.max(1, Math.ceil(totalGuests / PAGE_SIZE));
  const today = new Date();
  const dateLabel = today.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, color: GUEST_DESIGN.ink }}>
      <Snackbar
        open={snackbarOpen}
        autoHideDuration={6000}
        onClose={() => setSnackbarOpen(false)}
        message={snackbarMessage}
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
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
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            startIcon={<ImportIcon />}
            sx={{
              px: 1.75,
              py: 1.1,
              borderRadius: 1.5,
              border: `1px solid ${GUEST_DESIGN.rule}`,
              bgcolor: '#fff',
              color: GUEST_DESIGN.ink2,
              fontSize: 13,
              fontWeight: 600,
              textTransform: 'none',
              '&:hover': { bgcolor: GUEST_DESIGN.paper2 },
            }}
            disabled
            title="Import guests (coming soon)"
          >
            Import
          </Button>
          <Button
            startIcon={<ExportIcon />}
            sx={{
              px: 1.75,
              py: 1.1,
              borderRadius: 1.5,
              border: `1px solid ${GUEST_DESIGN.rule}`,
              bgcolor: '#fff',
              color: GUEST_DESIGN.ink2,
              fontSize: 13,
              fontWeight: 600,
              textTransform: 'none',
              '&:hover': { bgcolor: GUEST_DESIGN.paper2 },
            }}
            disabled
            title="Export guests (coming soon)"
          >
            Export
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
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 400px' }, gap: 1.75, alignItems: 'flex-start' }}>
        {/* LEFT: list */}
        <Box sx={{ bgcolor: '#fff', border: `1px solid ${GUEST_DESIGN.rule}`, borderRadius: 1.5, overflow: 'hidden' }}>
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
                placeholder="Search by name, phone, email, IC number, or company…"
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
                    bgcolor: active ? GUEST_DESIGN.ink : '#fff',
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
              {visibleGuests.length} of {totalGuests || statsTotal} guests
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
                      onClick={() => setSelectedGuestId(g.id)}
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
                            border: '2px solid #fff',
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
          {totalGuests > PAGE_SIZE && (
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', px: 2, py: 1.5, bgcolor: GUEST_DESIGN.paper2, borderTop: `1px solid ${GUEST_DESIGN.rule}`, fontSize: 12, color: GUEST_DESIGN.ink3 }}>
              <Box>
                Showing {((currentPage - 1) * PAGE_SIZE) + 1}–{Math.min(currentPage * PAGE_SIZE, totalGuests)} of {totalGuests}
              </Box>
              <Pagination
                count={totalPages}
                page={currentPage}
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
        <Box sx={{ position: { lg: 'sticky' }, top: { lg: 24 } }}>
          {!selectedGuest ? (
            <Box sx={{
              bgcolor: '#fff',
              border: `1px solid ${GUEST_DESIGN.rule}`,
              borderRadius: 1.5,
              p: 4,
              minHeight: 520,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 1.25,
              textAlign: 'center',
              color: GUEST_DESIGN.ink3,
            }}>
              <Box sx={{ width: 54, height: 54, borderRadius: '50%', bgcolor: GUEST_DESIGN.paper2, display: 'grid', placeItems: 'center', color: GUEST_DESIGN.ink4 }}>
                <PersonIcon sx={{ fontSize: 26 }} />
              </Box>
              <Typography sx={{ fontSize: 14, fontWeight: 600, color: GUEST_DESIGN.ink2 }}>Select a guest</Typography>
              <Typography sx={{ fontSize: 12.5, maxWidth: 240 }}>
                Tap any name in the list to view contact details, stay history, and quick actions.
              </Typography>
            </Box>
          ) : (
            (() => {
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
                  bgcolor: '#fff',
                  border: `1px solid ${GUEST_DESIGN.rule}`,
                  borderRadius: 1.5,
                  overflow: 'auto',
                  maxHeight: { lg: 'calc(100vh - 88px)' },
                }}>
                  {/* Header */}
                  <Box sx={{ p: '20px 20px 18px', borderBottom: `1px solid ${GUEST_DESIGN.rule}`, position: 'relative' }}>
                    <IconButton
                      onClick={() => setSelectedGuestId(null)}
                      size="small"
                      sx={{ position: 'absolute', top: 14, right: 14, color: GUEST_DESIGN.ink3 }}
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
                            border: '2px solid #fff',
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
                        </Box>
                      </Box>
                    </Box>

                    {/* Profile completeness */}
                    <Box sx={{ bgcolor: GUEST_DESIGN.paper2, borderRadius: 1, px: 1.5, py: 1.25 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.75, fontSize: 11.5 }}>
                        <Box sx={{ fontWeight: 600, color: GUEST_DESIGN.ink2 }}>Profile completeness</Box>
                        <Box sx={{ fontWeight: 700, color: completionColor, fontVariantNumeric: 'tabular-nums' }}>{completionPct}%</Box>
                      </Box>
                      <Box sx={{ height: 6, bgcolor: '#fff', borderRadius: 3, overflow: 'hidden' }}>
                        <Box sx={{ width: `${completionPct}%`, height: '100%', bgcolor: completionColor, borderRadius: 3 }} />
                      </Box>
                    </Box>
                  </Box>

                  {/* Contact */}
                  <Box sx={{ p: '16px 20px', borderBottom: `1px solid ${GUEST_DESIGN.rule}` }}>
                    <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: GUEST_DESIGN.ink3, mb: 1.5 }}>
                      Contact
                    </Typography>
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
                      onClick={handleCreateClick}
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
            })()
          )}
        </Box>
      </Box>

      <GuestProfileDialog
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

      <GuestProfileDialog
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
          {guestBookings.length === 0 ? (
            <Alert severity="info" sx={{ mt: 2 }}>
              No bookings found for this guest.
            </Alert>
          ) : (
            <TableContainer sx={{ mt: 2 }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Booking #</TableCell>
                    <TableCell>Room</TableCell>
                    <TableCell>Check In</TableCell>
                    <TableCell>Check Out</TableCell>
                    <TableCell>Nights</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell align="right">Amount</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {guestBookings.map((booking) => (
                    <TableRow key={booking.id}>
                      <TableCell>{booking.booking_number}</TableCell>
                      <TableCell>{booking.room_number} ({booking.room_type})</TableCell>
                      <TableCell>{new Date(booking.check_in_date).toLocaleDateString()}</TableCell>
                      <TableCell>{new Date(booking.check_out_date).toLocaleDateString()}</TableCell>
                      <TableCell>{booking.nights}</TableCell>
                      <TableCell>
                        <Chip label={booking.status} size="small" />
                      </TableCell>
                      <TableCell align="right">{formatCurrency(parseFloat(booking.total_amount))}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
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

interface ContactRowProps {
  icon: React.ReactNode;
  label: string;
  value?: string | null;
  placeholder: string;
  onAdd: () => void;
}

const ContactRow: React.FC<ContactRowProps> = ({ icon, label, value, placeholder, onAdd }) => {
  const empty = !value;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 1, borderBottom: `1px dashed ${GUEST_DESIGN.rule}` }}>
      <Box sx={{
        width: 30,
        height: 30,
        borderRadius: 1,
        bgcolor: empty ? GUEST_DESIGN.paper3 : GUEST_DESIGN.green50,
        color: empty ? GUEST_DESIGN.ink4 : GUEST_DESIGN.green700,
        display: 'grid',
        placeItems: 'center',
        flexShrink: 0,
      }}>
        <Box sx={{ display: 'inline-flex', '& svg': { fontSize: 16 } }}>{icon}</Box>
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: 11, color: GUEST_DESIGN.ink3, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
          {label}
        </Typography>
        {empty ? (
          <Box
            component="button"
            onClick={onAdd}
            sx={{
              fontSize: 13,
              color: GUEST_DESIGN.green700,
              fontWeight: 600,
              border: 0,
              background: 'none',
              padding: 0,
              cursor: 'pointer',
              fontFamily: 'inherit',
              '&:hover': { textDecoration: 'underline' },
            }}
          >
            + {placeholder}
          </Box>
        ) : (
          <Typography sx={{ fontSize: 13.5, color: GUEST_DESIGN.ink, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontVariantNumeric: 'tabular-nums' }}>
            {value}
          </Typography>
        )}
      </Box>
    </Box>
  );
};

interface StatTileProps {
  label: string;
  value: React.ReactNode;
  small?: boolean;
  accent?: 'green' | 'gold';
  onClick?: () => void;
}

const StatTile: React.FC<StatTileProps> = ({ label, value, small, accent, onClick }) => {
  const tones = {
    green: { bg: GUEST_DESIGN.green50, fg: GUEST_DESIGN.green700 },
    gold: { bg: GUEST_DESIGN.goldBg, fg: GUEST_DESIGN.gold },
  } as const;
  const c = accent ? tones[accent] : { bg: GUEST_DESIGN.paper2, fg: GUEST_DESIGN.ink };
  return (
    <Box
      component={onClick ? 'button' : 'div'}
      onClick={onClick}
      sx={{
        bgcolor: c.bg,
        borderRadius: 1,
        px: 1.5,
        py: 1.25,
        textAlign: 'left',
        border: 0,
        fontFamily: 'inherit',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'transform 120ms',
        '&:hover': onClick ? { transform: 'translateY(-1px)' } : undefined,
      }}
    >
      <Typography sx={{ fontSize: 11, color: GUEST_DESIGN.ink3, fontWeight: 600, mb: 0.25 }}>{label}</Typography>
      <Typography sx={{ fontSize: small ? 13 : 18, fontWeight: 700, color: c.fg, letterSpacing: '-0.01em', fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Typography>
    </Box>
  );
};

interface GuestProfileDialogProps {
  open: boolean;
  mode: 'create' | 'edit';
  guestName?: string;
  formData: GuestFormData;
  setFormData: React.Dispatch<React.SetStateAction<GuestFormData>>;
  error: string | null;
  loading: boolean;
  onErrorClose: () => void;
  onClose: () => void;
  onSubmit: () => void;
}

const guestInputSx = {
  '& .MuiOutlinedInput-root': {
    minHeight: 52,
    borderRadius: 1.1,
    bgcolor: '#fff',
    fontSize: 16,
    color: '#111827',
    '& fieldset': { borderColor: '#d6dde2' },
    '&:hover fieldset': { borderColor: '#aeb9bf' },
    '&.Mui-focused fieldset': {
      borderColor: GUEST_DESIGN.green600,
      borderWidth: 1,
    },
    '&.Mui-disabled': {
      bgcolor: '#f8faf9',
    },
  },
  '& .MuiInputBase-input': {
    py: 1.45,
  },
  '& .MuiInputBase-input::placeholder': {
    color: '#7b8490',
    opacity: 1,
  },
  '& .MuiInputAdornment-root .MuiSvgIcon-root': {
    color: '#7b8490',
    fontSize: 22,
  },
  '& .MuiFormHelperText-root': {
    ml: 0,
    mt: 0.75,
    fontSize: 12.5,
    color: '#7b8490',
  },
};

const GuestProfileDialog: React.FC<GuestProfileDialogProps> = ({
  open,
  mode,
  guestName,
  formData,
  setFormData,
  error,
  loading,
  onErrorClose,
  onClose,
  onSubmit,
}) => {
  const isEdit = mode === 'edit';
  const title = isEdit ? `Edit Guest · ${guestName || 'Guest'}` : 'Create Guest';
  const subtitle = isEdit
    ? 'Update guest profile, membership and tourism details.'
    : 'Add guest profile, membership and tourism details.';
  const primaryLabel = isEdit ? 'Save Changes' : 'Create Guest';

  const updateField = <K extends keyof GuestFormData,>(key: K, value: GuestFormData[K]) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      fullWidth
      PaperProps={{
        sx: {
          width: 'min(1112px, calc(100vw - 48px))',
          maxHeight: 'calc(100vh - 48px)',
          borderRadius: 3,
          overflow: 'hidden',
          bgcolor: '#fff',
          boxShadow: '0 26px 70px rgba(15, 23, 42, 0.28)',
        },
      }}
      BackdropProps={{
        sx: { bgcolor: 'rgba(17, 24, 39, 0.62)', backdropFilter: 'blur(4px)' },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2.25, px: { xs: 3, md: 3.25 }, pt: { xs: 2.75, md: 3 }, pb: 1.75 }}>
        <Box sx={{
          width: 72,
          height: 72,
          borderRadius: '50%',
          bgcolor: '#eff5f4',
          color: '#108279',
          display: { xs: 'none', sm: 'grid' },
          placeItems: 'center',
          flexShrink: 0,
        }}>
          <PersonIcon sx={{ fontSize: 38, strokeWidth: 1.2 }} />
        </Box>
        <Box sx={{ minWidth: 0, flex: 1, pt: 0.35 }}>
          <Typography sx={{ color: '#111827', fontSize: { xs: 24, sm: 30 }, fontWeight: 800, lineHeight: 1.12, letterSpacing: 0 }}>
            {title}
          </Typography>
          <Typography sx={{ mt: 0.8, color: '#697583', fontSize: { xs: 15, sm: 18 }, lineHeight: 1.35 }}>
            {subtitle}
          </Typography>
        </Box>
        <IconButton
          onClick={onClose}
          aria-label="Close guest dialog"
          sx={{
            width: 48,
            height: 48,
            borderRadius: 1.25,
            border: '1px solid #d8dee4',
            color: '#4b5563',
            flexShrink: 0,
            '&:hover': { bgcolor: '#f6f8f9' },
          }}
        >
          <CloseIcon sx={{ fontSize: 28 }} />
        </IconButton>
      </Box>

      <DialogContent sx={{ px: { xs: 3, md: 3.25 }, pt: 0.5, pb: 2.25, overflowY: 'auto' }}>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={onErrorClose}>
            {error}
          </Alert>
        )}

        <Grid container spacing={{ xs: 1.8, md: 2.2 }}>
          <GuestDialogField
            label="First Name"
            placeholder="First Name"
            value={formData.first_name}
            onChange={(value) => updateField('first_name', value)}
            required
          />
          <GuestDialogField
            label="Last Name"
            placeholder="Last Name"
            value={formData.last_name}
            onChange={(value) => updateField('last_name', value)}
            required
          />
          <GuestDialogField
            label="Email"
            placeholder="Email"
            value={formData.email || ''}
            onChange={(value) => updateField('email', value)}
            type="email"
          />
          <GuestDialogField
            label="Phone"
            placeholder="Phone"
            value={formData.phone || ''}
            onChange={(value) => updateField('phone', value)}
            icon={<PhoneIcon />}
          />
          <GuestDialogField
            label="IC Number / Passport"
            placeholder="IC Number / Passport"
            value={formData.ic_number || ''}
            onChange={(value) => updateField('ic_number', value)}
            icon={<IdIcon />}
          />
          <GuestDialogField
            label="Nationality"
            placeholder="Nationality"
            value={formData.nationality || ''}
            onChange={(value) => updateField('nationality', value)}
            icon={<PublicIcon />}
          />
          <GuestDialogField
            label="Company Name"
            placeholder="Company Name"
            value={formData.company_name || ''}
            onChange={(value) => updateField('company_name', value)}
          />
          <GuestDialogField
            label="Address"
            placeholder="Address"
            value={formData.address_line1 || ''}
            onChange={(value) => updateField('address_line1', value)}
            icon={<LocationIcon />}
            size={{ xs: 12 }}
          />
          <GuestDialogField
            label="City"
            placeholder="City"
            value={formData.city || ''}
            onChange={(value) => updateField('city', value)}
            icon={<CompanyIcon />}
          />
          <GuestDialogField
            label="State/Province"
            placeholder="State/Province"
            value={formData.state_province || ''}
            onChange={(value) => updateField('state_province', value)}
            icon={<CompanyIcon />}
          />
          <GuestDialogField
            label="Postal Code"
            placeholder="Postal Code"
            value={formData.postal_code || ''}
            onChange={(value) => updateField('postal_code', value)}
            icon={<MailIcon />}
          />
          <GuestDialogField
            label="Country"
            placeholder="Country"
            value={formData.country || ''}
            onChange={(value) => updateField('country', value)}
            icon={<PublicIcon />}
          />

          <Grid size={12}>
            <GuestDialogSection
              icon={<CheckCircleIcon />}
              title="Membership & Pricing"
              tint={formData.guest_type === 'member' ? GUEST_DESIGN.gold : GUEST_DESIGN.green700}
            >
              <Grid container spacing={2.2}>
                <Grid size={{ xs: 12, md: 6 }}>
                  <GuestDialogLabel>Guest Type</GuestDialogLabel>
                  <TextField
                    select
                    fullWidth
                    value={formData.guest_type || 'non_member'}
                    onChange={(e) => setFormData({
                      ...formData,
                      guest_type: e.target.value as GuestType,
                      discount_percentage: e.target.value === 'member' ? (formData.discount_percentage || 10) : 0,
                    })}
                    sx={guestInputSx}
                  >
                    <MenuItem value="non_member">
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2 }}>
                        <NonMemberIcon sx={{ fontSize: 22, color: GUEST_TYPE_CONFIG.non_member.color }} />
                        Non-Member (Standard Rate)
                      </Box>
                    </MenuItem>
                    <MenuItem value="member">
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2 }}>
                        <MemberIcon sx={{ fontSize: 22, color: GUEST_DESIGN.gold }} />
                        Member (Discounted Rate)
                      </Box>
                    </MenuItem>
                  </TextField>
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                  <GuestDialogLabel>Discount Percentage</GuestDialogLabel>
                  <TextField
                    fullWidth
                    type="number"
                    value={formData.discount_percentage || 0}
                    onChange={(e) => updateField('discount_percentage', parseInt(e.target.value, 10) || 0)}
                    disabled={formData.guest_type !== 'member'}
                    sx={guestInputSx}
                    InputProps={{
                      endAdornment: <InputAdornment position="end">%</InputAdornment>,
                    }}
                    inputProps={{ min: 0, max: 100 }}
                    helperText={formData.guest_type === 'member' ? 'Discount applied to room rates' : 'Only available for members'}
                  />
                </Grid>
              </Grid>
            </GuestDialogSection>
          </Grid>

          <Grid size={12}>
            <GuestDialogSection
              icon={<PublicIcon />}
              title="Tourism Classification"
              tint={formData.tourism_type === 'foreign' ? TOURISM_TYPE_CONFIG.foreign.color : GUEST_DESIGN.green700}
            >
              <Grid container spacing={2.2}>
                <Grid size={{ xs: 12, md: 6 }}>
                  <GuestDialogLabel>Tourism Type</GuestDialogLabel>
                  <TextField
                    select
                    fullWidth
                    value={formData.tourism_type || ''}
                    onChange={(e) => updateField('tourism_type', e.target.value as TourismType || undefined)}
                    sx={guestInputSx}
                  >
                    <MenuItem value="">
                      <Box sx={{ color: '#7b8490' }}>Not specified</Box>
                    </MenuItem>
                    <MenuItem value="local">
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2 }}>
                        <Chip label="Local" size="small" sx={{ bgcolor: TOURISM_TYPE_CONFIG.local.color, color: '#fff', fontWeight: 700, height: 24 }} />
                        {TOURISM_TYPE_CONFIG.local.taxLabel}
                      </Box>
                    </MenuItem>
                    <MenuItem value="foreign">
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2 }}>
                        <Chip label="Foreign" size="small" sx={{ bgcolor: TOURISM_TYPE_CONFIG.foreign.color, color: '#fff', fontWeight: 700, height: 24 }} />
                        {TOURISM_TYPE_CONFIG.foreign.taxLabel}
                      </Box>
                    </MenuItem>
                  </TextField>
                </Grid>
              </Grid>
            </GuestDialogSection>
          </Grid>
        </Grid>
      </DialogContent>

      <Box sx={{
        display: 'flex',
        flexDirection: { xs: 'column-reverse', sm: 'row' },
        justifyContent: 'flex-end',
        gap: { xs: 1, sm: 2.5 },
        px: { xs: 3, md: 3.25 },
        py: 2,
        borderTop: '1px solid #e4e8ec',
        bgcolor: 'rgba(255,255,255,0.96)',
      }}>
        <Button
          onClick={onClose}
          startIcon={<CancelIcon />}
          sx={{
            minWidth: 140,
            width: { xs: '100%', sm: 'auto' },
            height: 52,
            borderRadius: 1.25,
            border: '1px solid #62b8b7',
            color: '#108279',
            fontWeight: 700,
            textTransform: 'none',
            '&:hover': { bgcolor: alpha(GUEST_DESIGN.green600, 0.06), borderColor: '#108279' },
          }}
        >
          Cancel
        </Button>
        <Button
          onClick={onSubmit}
          startIcon={loading ? undefined : <SaveIcon />}
          disabled={loading}
          sx={{
            minWidth: 194,
            width: { xs: '100%', sm: 'auto' },
            height: 52,
            borderRadius: 1.25,
            bgcolor: '#119b91',
            color: '#fff',
            fontWeight: 800,
            textTransform: 'none',
            boxShadow: '0 10px 24px rgba(17, 155, 145, 0.24)',
            '&:hover': { bgcolor: '#0e817a' },
            '&.Mui-disabled': { bgcolor: alpha('#119b91', 0.55), color: '#fff' },
          }}
        >
          {loading ? <CircularProgress size={22} sx={{ color: '#fff' }} /> : primaryLabel}
        </Button>
      </Box>
    </Dialog>
  );
};

interface GuestDialogFieldProps {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  type?: string;
  icon?: React.ReactNode;
  required?: boolean;
  size?: any;
}

const GuestDialogField: React.FC<GuestDialogFieldProps> = ({
  label,
  value,
  placeholder,
  onChange,
  type = 'text',
  icon,
  required,
  size = { xs: 12, md: 6 },
}) => (
  <Grid size={size}>
    <GuestDialogLabel>{label}</GuestDialogLabel>
    <TextField
      fullWidth
      required={required}
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      sx={guestInputSx}
      InputProps={icon ? {
        endAdornment: <InputAdornment position="end">{icon}</InputAdornment>,
      } : undefined}
    />
  </Grid>
);

const GuestDialogLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Typography sx={{ mb: 0.7, color: '#111827', fontSize: 14.5, fontWeight: 500, lineHeight: 1.2 }}>
    {children}
  </Typography>
);

interface GuestDialogSectionProps {
  icon: React.ReactNode;
  title: string;
  tint: string;
  children: React.ReactNode;
}

const GuestDialogSection: React.FC<GuestDialogSectionProps> = ({ icon, title, tint, children }) => (
  <Box sx={{
    mt: 0.35,
    p: { xs: 1.75, md: 2 },
    borderRadius: 1.25,
    border: '1px solid #d7e0e0',
    bgcolor: alpha(tint, 0.035),
  }}>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2, mb: 1.35 }}>
      <Box sx={{ color: tint, display: 'inline-flex', '& svg': { fontSize: 26 } }}>
        {icon}
      </Box>
      <Typography sx={{ color: '#087b75', fontWeight: 800, fontSize: 18, lineHeight: 1.2 }}>
        {title}
      </Typography>
    </Box>
    {children}
  </Box>
);

export default GuestConfigurationPage;

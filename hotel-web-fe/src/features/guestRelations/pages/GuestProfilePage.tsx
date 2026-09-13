import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Link as MuiLink,
  Paper,
  Tab,
  Tabs,
} from '@mui/material';
import { ArrowBackOutlined as BackIcon } from '@mui/icons-material';
import type { Guest } from '../../../types';
import { errorMessage } from '../../../utils';
import { getQueryErrorMessage } from '../../../api/queryConfig';
import { TabPanel, getTabA11yProps } from '../../../components';
import { useAuth } from '../../../auth/AuthContext';
import { Link } from '../../../router';
import { validateEmail } from '../../../utils/validation';
import { emitApiNotification } from '../../../utils/apiNotifications';
import { useGuests, useGuestProfile, useUpdateGuest } from '../../guests/hooks/useGuestQueries';
import { useRooms } from '../../rooms/hooks/useRoomQueries';
import UnifiedBookingModal from '../../rooms/components/UnifiedBooking';
import type { GuestFormData } from '../../guests/types';
import GuestFormDialog from '../components/GuestFormDialog';
import GuestProfileHeader from '../components/GuestProfileHeader';
import OpenSupportDialog from '../components/OpenSupportDialog';
import OverviewTab from '../components/tabs/OverviewTab';
import StaysTab from '../components/tabs/StaysTab';
import PreferencesTab from '../components/tabs/PreferencesTab';
import InteractionsTab from '../components/tabs/InteractionsTab';
import LoyaltyVouchersTab from '../components/tabs/LoyaltyVouchersTab';
import SupportFeedbackTab from '../components/tabs/SupportFeedbackTab';
import CommunicationTab from '../components/tabs/CommunicationTab';
import { guestDisplayName } from '../utils';

interface GuestProfilePageProps {
  /** Route param — Task 16 registers `/guest-relations/guests/$guestId` and
   *  passes `Route.useParams().guestId` in here (same precedent as
   *  `HelpArticlePage` receiving `slug` from `help.$slug.tsx`). */
  guestId: string;
}

type ProfileTabKey =
  | 'overview'
  | 'stays'
  | 'preferences'
  | 'interactions'
  | 'loyalty'
  | 'support'
  | 'communication';

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

/**
 * Guest 360 — the guest-relations workspace profile page. Composes the
 * identity header + tabbed detail surface over `useGuestProfile` (guest,
 * summary, reservations, duplicates, sensitive identity).
 */
const GuestProfilePage: React.FC<GuestProfilePageProps> = ({ guestId }) => {
  const { hasPermission } = useAuth();

  // `hasPermission` already resolves `<resource>:manage` to every action, so
  // each gate names the least privilege the surface needs.
  const hasAccess = hasPermission('guests:read');
  const canUpdateGuest = hasPermission('guests:update');
  const canReadSupport = hasPermission('support:read');
  const canWriteSupport = hasPermission('support:write');
  const canAssignSupport = hasPermission('support:assign');
  const canReadCommunications = hasPermission('communications:read');
  const canManageCommunications = hasPermission('communications:manage');
  const canReadReviews = hasPermission('reviews:read');
  const canUpdateReviews = hasPermission('reviews:update');

  const numericGuestId = Number(guestId);
  const isValidGuestId = guestId.trim() !== '' && Number.isFinite(numericGuestId);

  const profileQuery = useGuestProfile(guestId, hasAccess && isValidGuestId);
  const profile = profileQuery.data;
  const guest = profile?.guest;
  const summary = profile?.summary;

  const tabDefs = React.useMemo(() => {
    const defs: Array<{ key: ProfileTabKey; label: string }> = [
      { key: 'overview', label: 'Overview' },
      { key: 'stays', label: 'Stays' },
      { key: 'preferences', label: 'Preferences' },
      { key: 'interactions', label: 'Interactions' },
      { key: 'loyalty', label: 'Loyalty & Vouchers' },
    ];
    // Permission-missing tabs are hidden entirely, not disabled.
    if (canReadSupport) defs.push({ key: 'support', label: 'Support & Feedback' });
    if (canReadCommunications) defs.push({ key: 'communication', label: 'Communication' });
    return defs;
  }, [canReadSupport, canReadCommunications]);

  const [activeTab, setActiveTab] = useState(0);
  const clampedTab = Math.min(activeTab, tabDefs.length - 1);

  // "Add Note" quick action — switches to the Interactions tab and asks it to
  // focus the add form. The tab consumes the request so later manual visits
  // don't steal focus back.
  const [addNoteRequested, setAddNoteRequested] = useState(false);

  const goToTab = (key: ProfileTabKey) => {
    const index = tabDefs.findIndex((tab) => tab.key === key);
    if (index >= 0) setActiveTab(index);
  };

  // --- Quick actions -------------------------------------------------------

  // Edit (GuestFormDialog) — same wiring as the list page's edit flow.
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [formData, setFormData] = useState<GuestFormData>(emptyGuestForm);
  const [formLoading, setFormLoading] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const updateGuestMutation = useUpdateGuest();

  // New Booking — UnifiedBookingModal preselects via `initialGuest`; its
  // guest picker still searches client-side, so the roster loads lazily only
  // while the modal is open.
  const [bookingDialogOpen, setBookingDialogOpen] = useState(false);
  const allGuestsQuery = useGuests(undefined, hasAccess && bookingDialogOpen);
  const roomsQuery = useRooms(hasAccess && bookingDialogOpen);

  const [supportDialogOpen, setSupportDialogOpen] = useState(false);

  const handleEditClick = (target: Guest) => {
    setDialogError(null);
    // Prefer the legal name the API returns; splitting the nickname is a
    // fallback for rows predating that (mirrors the list page).
    const hasLegalName = Boolean(target.first_name?.trim() && target.last_name?.trim());
    const [splitFirstName, ...splitLastNameParts] = target.nick_name.split(' ');
    setFormData({
      first_name: hasLegalName ? (target.first_name ?? '') : (splitFirstName || ''),
      last_name: hasLegalName ? (target.last_name ?? '') : (splitLastNameParts.join(' ') || ''),
      email: target.email || '',
      phone: target.phone || '',
      ic_number: target.ic_number || '',
      nationality: target.nationality || '',
      address_line1: target.address_line1 || '',
      city: target.city || '',
      state_province: target.state_province || '',
      postal_code: target.postal_code || '',
      country: target.country || '',
      company_name: target.company_name || '',
      guest_type: target.guest_type || 'non_member',
      tourism_type: target.tourism_type,
      discount_percentage: target.discount_percentage || 0,
    });
    setEditDialogOpen(true);
  };

  const handleUpdateGuest = async () => {
    if (!guest) return;
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
      await updateGuestMutation.mutateAsync({ guestId: guest.id, data: formData });
      emitApiNotification({ message: 'Guest updated successfully', severity: 'success' });
      setEditDialogOpen(false);
    } catch (err) {
      setDialogError(errorMessage(err, 'Failed to update guest'));
    } finally {
      setFormLoading(false);
    }
  };

  const handleRefreshProfile = async () => {
    await profileQuery.refetch();
  };

  if (!hasAccess) {
    return (
      <Alert severity="warning" sx={{ m: 2 }}>
        You do not have permission to access this page. Contact your administrator for access.
      </Alert>
    );
  }

  if (!isValidGuestId) {
    return (
      <Alert severity="warning" sx={{ m: 2 }}>
        Invalid guest ID.
      </Alert>
    );
  }

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <MuiLink
        component={Link}
        to="/guest-relations"
        underline="hover"
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.5,
          fontSize: 13,
          fontWeight: 600,
          mb: 1.5,
          color: 'text.secondary',
        }}
      >
        <BackIcon sx={{ fontSize: 15 }} />
        Back to guests
      </MuiLink>

      {pageError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setPageError(null)}>
          {pageError}
        </Alert>
      )}

      {profileQuery.isPending ? (
        <Box sx={{ py: 10, display: 'flex', justifyContent: 'center' }}>
          <CircularProgress size={36} />
        </Box>
      ) : profileQuery.error || !guest || !summary ? (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => void profileQuery.refetch()}>
              Retry
            </Button>
          }
        >
          {getQueryErrorMessage(profileQuery.error, 'Failed to load guest profile') ?? 'Failed to load guest profile'}
        </Alert>
      ) : (
        <>
          <GuestProfileHeader
            guest={guest}
            summary={summary}
            duplicateCount={profile.duplicate_candidates.length}
            canEdit={canUpdateGuest}
            canAddNote={canUpdateGuest}
            canOpenSupport={canWriteSupport}
            onEdit={() => handleEditClick(guest)}
            onNewBooking={() => setBookingDialogOpen(true)}
            onAddNote={() => {
              goToTab('interactions');
              setAddNoteRequested(true);
            }}
            onOpenSupport={() => setSupportDialogOpen(true)}
          />

          <Paper variant="outlined" sx={{ mt: 2 }}>
            <Tabs
              value={clampedTab}
              onChange={(_, value) => setActiveTab(value)}
              variant="scrollable"
              scrollButtons="auto"
              sx={{ px: 1, borderBottom: 1, borderColor: 'divider', minHeight: 44 }}
            >
              {tabDefs.map((tab, index) => (
                <Tab
                  key={tab.key}
                  label={tab.label}
                  sx={{ minHeight: 44, textTransform: 'none' }}
                  {...getTabA11yProps(index, 'guest-profile')}
                />
              ))}
            </Tabs>
            <Box sx={{ p: { xs: 1.5, md: 2 } }}>
              <TabPanel value={clampedTab} index={0} idPrefix="guest-profile">
                <OverviewTab
                  guestId={numericGuestId}
                  profile={profile}
                  canViewSupport={canReadSupport}
                  canViewReviews={canReadReviews}
                />
              </TabPanel>
              <TabPanel value={clampedTab} index={1} idPrefix="guest-profile">
                <StaysTab reservations={profile.reservations} summary={summary} />
              </TabPanel>
              {/* TabPanels below are positioned by the tab's index in the
                  visible list — hidden tabs never render a panel. */}
              {tabDefs.slice(2).map((tab, offset) => (
                <TabPanel
                  key={tab.key}
                  value={clampedTab}
                  index={offset + 2}
                  idPrefix="guest-profile"
                >
                  {tab.key === 'preferences' ? (
                    <PreferencesTab
                      guestId={numericGuestId}
                      profile={profile}
                      canEdit={canUpdateGuest}
                    />
                  ) : tab.key === 'interactions' ? (
                    <InteractionsTab
                      guestId={numericGuestId}
                      reservations={profile.reservations}
                      addNoteRequested={addNoteRequested}
                      onAddNoteHandled={() => setAddNoteRequested(false)}
                    />
                  ) : tab.key === 'loyalty' ? (
                    <LoyaltyVouchersTab guestId={numericGuestId} />
                  ) : tab.key === 'support' ? (
                    <SupportFeedbackTab
                      guestId={numericGuestId}
                      reservations={profile.reservations}
                      canWriteSupport={canWriteSupport}
                      canViewReviews={canReadReviews}
                      canRespondToReviews={canUpdateReviews}
                      onNewConversation={() => setSupportDialogOpen(true)}
                    />
                  ) : tab.key === 'communication' ? (
                    <CommunicationTab
                      guestId={numericGuestId}
                      guestName={guestDisplayName(guest)}
                      canManageConsent={canManageCommunications}
                    />
                  ) : null}
                </TabPanel>
              ))}
            </Box>
          </Paper>
        </>
      )}

      <UnifiedBookingModal
        open={bookingDialogOpen}
        onClose={() => setBookingDialogOpen(false)}
        room={null}
        rooms={roomsQuery.data ?? []}
        guests={allGuestsQuery.data ?? []}
        initialGuest={guest ?? null}
        onSuccess={(message) => {
          emitApiNotification({ message, severity: 'success' });
          void handleRefreshProfile();
        }}
        onError={(message) => setPageError(message)}
        onRefreshData={async () => {
          await Promise.all([handleRefreshProfile(), roomsQuery.refetch()]);
        }}
      />
      <GuestFormDialog
        open={editDialogOpen}
        mode="edit"
        guestName={guest ? guestDisplayName(guest) : undefined}
        formData={formData}
        setFormData={setFormData}
        error={dialogError}
        loading={formLoading}
        onErrorClose={() => setDialogError(null)}
        onClose={() => { setEditDialogOpen(false); setDialogError(null); }}
        onSubmit={handleUpdateGuest}
      />
      {guest && (
        <OpenSupportDialog
          open={supportDialogOpen}
          guestId={guest.id}
          guestName={guestDisplayName(guest)}
          canAssign={canAssignSupport}
          onClose={() => setSupportDialogOpen(false)}
          onCreated={(message) => emitApiNotification({ message, severity: 'success' })}
        />
      )}
    </Box>
  );
};

export default GuestProfilePage;

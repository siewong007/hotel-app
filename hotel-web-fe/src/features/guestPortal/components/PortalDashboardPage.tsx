import React from 'react';
import { Navigate, useLocation, useNavigate } from '../../../router';
import { Alert, Box, Button, Container, CircularProgress, Fade, Paper, Stack, Typography } from '@mui/material';
import { usePortalSessionBootstrap } from '../hooks/usePortalSessionBootstrap';
import { BookingsSection, CreditsSection, EmbeddedSection, OverviewSection, PointsHistorySection } from './dashboard/PortalDashboardSections';
import { IdentitySection } from './dashboard/IdentitySection';
import { parsePortalSection, type PortalSection } from './dashboard/dashboardUtils';

// Navigation lives in GuestPortalShell (top bar on web, bottom bar on phones).
// The heading is what tells the guest which section they landed on.
const SECTION_TITLES: Record<PortalSection, string> = {
  overview: 'My stay',
  stays: 'My stays',
  'points-history': 'Points history',
  offers: 'Offers',
  vouchers: 'Vouchers',
  credits: 'Complimentary nights',
  identity: 'Identity verification',
  preferences: 'Preferences',
  support: 'My stay',
};

export const PortalDashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const {
    token,
    status: sessionStatus,
    error: sessionError,
    canRetry,
    needsLogin,
    isStaffAccount,
    retry,
    restartSignIn,
    signOut,
  } = usePortalSessionBootstrap();
  // Staff accounts belong in the admin portal, not the guest portal.
  if (isStaffAccount) {
    return <Navigate to="/admin-portal" replace />;
  }

  if (needsLogin) {
    return <Navigate to="/login?account=guest" replace />;
  }

  if (!token) {
    return (
      <Container maxWidth="sm" sx={{ mt: 8 }}>
        {sessionError ? (
          <Alert
            severity="error"
            action={(
              <Button
                color="inherit"
                size="small"
                onClick={canRetry ? retry : restartSignIn}
              >
                {canRetry ? 'Retry' : 'Sign in again'}
              </Button>
            )}
          >
            {sessionError}
          </Alert>
        ) : (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 2 }}>
            <CircularProgress size={24} />
            <Typography>
              {sessionStatus === 'checking-account'
                ? 'Checking your account session…'
                : 'Opening your guest portal…'}
            </Typography>
          </Box>
        )}
      </Container>
    );
  }

  return <AuthenticatedDashboard token={token} navigate={navigate} signOut={signOut} />;
};

const AuthenticatedDashboard: React.FC<{
  token: string;
  navigate: ReturnType<typeof useNavigate>;
  signOut: () => void;
}> = ({ token, navigate, signOut }) => {
  const location = useLocation();
  const activeSection = parsePortalSection(location.search);
  // Support is a floating panel owned by GuestPortalShell (one launcher on every
  // portal page), so ?section=support renders the overview behind it rather than
  // a section of its own.
  const displaySection: PortalSection = activeSection === 'support' ? 'overview' : activeSection;
  const changeSection = (section: PortalSection) => {
    const params = new URLSearchParams(location.search);
    params.set('section', section);
    navigate(`/guest-portal?${params.toString()}`);
  };

  return (
    <Container maxWidth="lg" sx={{ mt: { xs: 2, sm: 4 }, mb: 7, px: { xs: 2, sm: 3 } }}>
      <Paper elevation={0} sx={{ overflow: 'hidden', border: '1px solid rgba(6,17,14,.12)', borderRadius: 3 }}>
        <Box sx={{ p: { xs: 2.5, sm: 4 }, bgcolor: '#fffdf9', borderBottom: '1px solid rgba(6,17,14,.1)' }}>
          <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'stretch', sm: 'center' }, gap: 2 }}>
          {/* No hotel name here: GuestPortalShell's sticky header already shows
              it as the logo wordmark directly above this card. */}
          <Box><Typography variant="h4" component="h1" sx={{ color: '#06110e', fontWeight: 700 }}>{SECTION_TITLES[displaySection]}</Typography></Box>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <Button variant="outlined" onClick={signOut} sx={{ width: { xs: '100%', sm: 'auto' } }}>
              Sign Out
            </Button>
          </Stack>
          </Box>
        </Box>
        <Fade in key={displaySection} timeout={220}><Box component="section" aria-live="polite" sx={{ p: { xs: 2.5, sm: 4 } }}>
          {displaySection === 'overview' ? (
            <OverviewSection
              token={token}
              onSectionChange={changeSection}
            />
          ) : null}
          {displaySection === 'stays' ? <BookingsSection token={token} /> : null}
          {displaySection === 'points-history' ? <PointsHistorySection token={token} /> : null}
          {displaySection === 'credits' ? <CreditsSection token={token} /> : null}
          {displaySection === 'identity' ? <IdentitySection token={token} /> : null}
          {['offers', 'vouchers', 'preferences'].includes(displaySection) ? <EmbeddedSection section={displaySection} token={token} /> : null}
        </Box></Fade>
      </Paper>
    </Container>
  );
};

export default PortalDashboardPage;

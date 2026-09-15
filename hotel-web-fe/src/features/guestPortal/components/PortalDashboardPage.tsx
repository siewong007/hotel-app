import React from 'react';
import { Navigate, useLocation, useNavigate } from '../../../router';
import { Alert, Box, Button, Container, Fade, Stack, Typography } from '@mui/material';
import { LogoLoader } from '../../../components';
import { usePortalSessionBootstrap } from '../hooks/usePortalSessionBootstrap';
import { BookingsSection, CreditsSection, EmbeddedSection, OverviewSection, PointsHistorySection } from './dashboard/PortalDashboardSections';
import { IdentitySection } from './dashboard/IdentitySection';
import { ProfileSection } from './dashboard/ProfileSection';
import { SecuritySection } from './dashboard/SecuritySection';
import { DevicesSection } from './dashboard/DevicesSection';
import { parsePortalSection, type PortalSection } from './dashboard/dashboardUtils';
import { useTranslation } from '../../../i18n';

// Navigation and account chrome (profile, sign out) live in GuestPortalShell.
// Each section renders its own SectionHeading — the page adds no second title.
export const PortalDashboardPage: React.FC = () => {
  const { t } = useTranslation('guestPortal');
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
  } = usePortalSessionBootstrap();
  // Staff accounts belong in the admin portal, not the guest portal.
  if (isStaffAccount) {
    return <Navigate to="/admin-portal" replace />;
  }

  if (needsLogin) {
    return <Navigate to="/login" replace />;
  }

  if (!token) {
    return (
      <Container maxWidth="sm" sx={{ mt: 8 }}>
        {sessionError ? (
          <Alert
            severity="error"
            role="alert"
            action={(
              <Button
                color="inherit"
                size="small"
                onClick={canRetry ? retry : restartSignIn}
              >
                {canRetry ? t('book.retry') : t('book.signInAgain')}
              </Button>
            )}
          >
            {sessionError}
          </Alert>
        ) : (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 2 }}>
            <LogoLoader
              variant="inline"
              label={sessionStatus === 'checking-account' ? t('book.checkingAccount') : t('book.openingPortal')}
            />
          </Box>
        )}
      </Container>
    );
  }

  return <AuthenticatedDashboard token={token} navigate={navigate} />;
};

const AuthenticatedDashboard: React.FC<{
  token: string;
  navigate: ReturnType<typeof useNavigate>;
}> = ({ token, navigate }) => {
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
      <Fade in key={displaySection} timeout={220}><Box component="section" aria-live="polite">
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
        {displaySection === 'profile' ? <ProfileSection token={token} /> : null}
        {/* No token: this section acts on the guest's ACCOUNT credentials,
            which authenticate with the ordinary account session rather than
            the portal bearer token. See SecuritySection. */}
        {displaySection === 'security' ? (
          <Stack spacing={3}>
            <SecuritySection />
            <DevicesSection />
          </Stack>
        ) : null}
        {['offers', 'vouchers', 'preferences'].includes(displaySection) ? <EmbeddedSection section={displaySection} token={token} /> : null}
      </Box></Fade>
    </Container>
  );
};

export default PortalDashboardPage;

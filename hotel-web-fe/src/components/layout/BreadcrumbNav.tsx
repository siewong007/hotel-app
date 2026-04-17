import React from 'react';
import { Box, Typography, Breadcrumbs, Container } from '@mui/material';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import HomeIcon from '@mui/icons-material/Home';
import PersonIcon from '@mui/icons-material/Person';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import EventNoteIcon from '@mui/icons-material/EventNote';
import PeopleIcon from '@mui/icons-material/People';
import MeetingRoomIcon from '@mui/icons-material/MeetingRoom';
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser';
import SecurityIcon from '@mui/icons-material/Security';
import SettingsIcon from '@mui/icons-material/Settings';
import AssessmentIcon from '@mui/icons-material/Assessment';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import CardGiftcardIcon from '@mui/icons-material/CardGiftcard';
import CategoryIcon from '@mui/icons-material/Category';
import HomeWorkIcon from '@mui/icons-material/HomeWork';
import HistoryIcon from '@mui/icons-material/History';
import NightsStayIcon from '@mui/icons-material/NightsStay';
import SyncAltIcon from '@mui/icons-material/SyncAlt';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';

const breadcrumbConfig: Record<string, { label: string; icon?: React.ReactElement }> = {
  '/timeline': { label: 'Reservation Timeline', icon: <CalendarMonthIcon sx={{ fontSize: 16 }} /> },
  '/my-bookings': { label: 'My Bookings', icon: <EventNoteIcon sx={{ fontSize: 16 }} /> },
  '/guest-config': { label: 'Guest Management', icon: <PeopleIcon sx={{ fontSize: 16 }} /> },
  '/bookings': { label: 'Bookings', icon: <EventNoteIcon sx={{ fontSize: 16 }} /> },
  '/room-management': { label: 'Room Management', icon: <HomeWorkIcon sx={{ fontSize: 16 }} /> },
  '/ekyc-admin': { label: 'eKYC Admin', icon: <VerifiedUserIcon sx={{ fontSize: 16 }} /> },
  '/rbac': { label: 'Access Control', icon: <SecurityIcon sx={{ fontSize: 16 }} /> },
  '/room-config': { label: 'Room Configuration', icon: <MeetingRoomIcon sx={{ fontSize: 16 }} /> },
  '/room-type-config': { label: 'Room Types', icon: <CategoryIcon sx={{ fontSize: 16 }} /> },
  '/company-ledger': { label: 'Company Ledger', icon: <AccountBalanceIcon sx={{ fontSize: 16 }} /> },
  '/complimentary': { label: 'Complimentary Nights', icon: <CardGiftcardIcon sx={{ fontSize: 16 }} /> },
  '/audit-log': { label: 'Audit Log', icon: <HistoryIcon sx={{ fontSize: 16 }} /> },
  '/night-audit': { label: 'Night Audit', icon: <NightsStayIcon sx={{ fontSize: 16 }} /> },
  '/data-transfer': { label: 'Data Transfer', icon: <SyncAltIcon sx={{ fontSize: 16 }} /> },
  '/reports': { label: 'Reports', icon: <AssessmentIcon sx={{ fontSize: 16 }} /> },
  '/settings': { label: 'Settings', icon: <SettingsIcon sx={{ fontSize: 16 }} /> },
  '/profile': { label: 'My Profile', icon: <PersonIcon sx={{ fontSize: 16 }} /> },
  '/help': { label: 'Help & Support', icon: <HelpOutlineIcon sx={{ fontSize: 16 }} /> },
};

export const BreadcrumbNav = React.memo(function BreadcrumbNav() {
  const location = useLocation();
  const { hasRole } = useAuth();
  const pathnames = location.pathname.split('/').filter((x) => x);

  const isEmployeeOnly = (hasRole('receptionist') || hasRole('employee')) && !hasRole('admin') && !hasRole('superadmin') && !hasRole('manager');
  const rootLabel = isEmployeeOnly ? 'My Profile' : 'Dashboard';
  const rootIcon = isEmployeeOnly ? <PersonIcon sx={{ fontSize: 16 }} /> : <HomeIcon sx={{ fontSize: 16 }} />;

  if (location.pathname === '/') return null;

  const breadcrumbItems: { path: string; label: string; icon?: React.ReactElement; isLast: boolean }[] = [
    { path: '/', label: rootLabel, icon: rootIcon, isLast: false },
  ];

  let currentPath = '';
  pathnames.forEach((segment, index) => {
    currentPath += `/${segment}`;
    const config = breadcrumbConfig[currentPath];
    const isLast = index === pathnames.length - 1;
    if (config) {
      breadcrumbItems.push({ path: currentPath, label: config.label, icon: config.icon, isLast });
    } else {
      const formattedSegment = segment.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      breadcrumbItems.push({ path: currentPath, label: formattedSegment, isLast });
    }
  });

  const currentPage = breadcrumbItems[breadcrumbItems.length - 1];

  return (
    <Box sx={{ bgcolor: 'background.paper', borderBottom: '1px solid', borderColor: 'divider', px: { xs: 2, sm: 3 }, py: 1.5 }}>
      <Container maxWidth="xl" sx={{ px: { xs: 0, sm: 0 } }}>
        <Box sx={{ display: 'flex', alignItems: { xs: 'flex-start', sm: 'center' }, justifyContent: 'space-between', flexDirection: { xs: 'column', sm: 'row' }, gap: { xs: 0.5, sm: 2 } }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            {currentPage.icon && (
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: 1.5, bgcolor: 'primary.50', color: 'primary.main', '& svg': { fontSize: 20 } }}>
                {currentPage.icon}
              </Box>
            )}
            <Typography variant="h6" sx={{ fontWeight: 700, fontSize: { xs: '1.1rem', sm: '1.25rem' }, color: 'text.primary', lineHeight: 1.2 }}>
              {currentPage.label}
            </Typography>
          </Box>
          <Breadcrumbs separator={<NavigateNextIcon sx={{ fontSize: 14, color: 'text.disabled' }} />} aria-label="breadcrumb" sx={{ '& .MuiBreadcrumbs-ol': { flexWrap: 'nowrap' }, '& .MuiBreadcrumbs-separator': { mx: 0.5 } }}>
            {breadcrumbItems.slice(0, -1).map((item) => (
              <Box key={item.path} component={Link} to={item.path} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'text.secondary', textDecoration: 'none', fontSize: '0.75rem', '&:hover': { color: 'primary.main', textDecoration: 'underline' } }}>
                {item.icon && <Box sx={{ display: 'flex', '& svg': { fontSize: 14 } }}>{item.icon}</Box>}
                <Typography variant="caption" sx={{ fontSize: '0.75rem' }}>{item.label}</Typography>
              </Box>
            ))}
            <Typography variant="caption" sx={{ color: 'text.primary', fontWeight: 600, fontSize: '0.75rem' }}>
              {currentPage.label}
            </Typography>
          </Breadcrumbs>
        </Box>
      </Container>
    </Box>
  );
});

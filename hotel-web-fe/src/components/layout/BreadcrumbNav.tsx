import React from 'react';
import { Box, Typography, Breadcrumbs, Container } from '@mui/material';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import HomeIcon from '@mui/icons-material/Home';
import PersonIcon from '@mui/icons-material/Person';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { findRouteDefinition } from '../../navigation/routeRegistry';

export const BreadcrumbNav = React.memo(function BreadcrumbNav() {
  const location = useLocation();
  const { hasRole } = useAuth();
  const pathnames = location.pathname.split('/').filter((x) => x);

  const isEmployeeOnly = (hasRole('receptionist') || hasRole('employee')) && !hasRole('admin') && !hasRole('superadmin') && !hasRole('manager');
  const rootLabel = isEmployeeOnly ? 'My Profile' : 'Dashboard';
  const rootIcon = isEmployeeOnly ? PersonIcon : HomeIcon;

  if (location.pathname === '/') return null;

  const breadcrumbItems: { path: string; label: string; icon?: React.ElementType; isLast: boolean }[] = [
    { path: '/', label: rootLabel, icon: rootIcon, isLast: false },
  ];

  let currentPath = '';
  pathnames.forEach((segment, index) => {
    currentPath += `/${segment}`;
    const config = findRouteDefinition(currentPath);
    const isLast = index === pathnames.length - 1;
    if (config?.breadcrumbLabel) {
      breadcrumbItems.push({ path: currentPath, label: config.breadcrumbLabel, icon: config.icon, isLast });
    } else {
      const formattedSegment = segment.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      breadcrumbItems.push({ path: currentPath, label: formattedSegment, isLast });
    }
  });

  const currentPage = breadcrumbItems[breadcrumbItems.length - 1];
  const CurrentPageIcon = currentPage.icon;

  return (
    <Box sx={{ bgcolor: 'background.paper', borderBottom: '1px solid', borderColor: 'divider', px: { xs: 2, sm: 3 }, py: 1.5 }}>
      <Container maxWidth="xl" sx={{ px: { xs: 0, sm: 0 } }}>
        <Box sx={{ display: 'flex', alignItems: { xs: 'flex-start', sm: 'center' }, justifyContent: 'space-between', flexDirection: { xs: 'column', sm: 'row' }, gap: { xs: 0.5, sm: 2 } }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            {CurrentPageIcon && (
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: 1.5, bgcolor: 'primary.50', color: 'primary.main', '& svg': { fontSize: 20 } }}>
                <CurrentPageIcon sx={{ fontSize: 20 }} />
              </Box>
            )}
            <Typography variant="h6" sx={{ fontWeight: 700, fontSize: { xs: '1.1rem', sm: '1.25rem' }, color: 'text.primary', lineHeight: 1.2 }}>
              {currentPage.label}
            </Typography>
          </Box>
          <Breadcrumbs separator={<NavigateNextIcon sx={{ fontSize: 14, color: 'text.disabled' }} />} aria-label="breadcrumb" sx={{ '& .MuiBreadcrumbs-ol': { flexWrap: 'nowrap' }, '& .MuiBreadcrumbs-separator': { mx: 0.5 } }}>
            {breadcrumbItems.slice(0, -1).map((item) => {
              const ItemIcon = item.icon;

              return (
                <Box key={item.path} component={Link} to={item.path} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'text.secondary', textDecoration: 'none', fontSize: '0.75rem', '&:hover': { color: 'primary.main', textDecoration: 'underline' } }}>
                  {ItemIcon && <Box sx={{ display: 'flex', '& svg': { fontSize: 14 } }}><ItemIcon sx={{ fontSize: 14 }} /></Box>}
                  <Typography variant="caption" sx={{ fontSize: '0.75rem' }}>{item.label}</Typography>
                </Box>
              );
            })}
            <Typography variant="caption" sx={{ color: 'text.primary', fontWeight: 600, fontSize: '0.75rem' }}>
              {currentPage.label}
            </Typography>
          </Breadcrumbs>
        </Box>
      </Container>
    </Box>
  );
});

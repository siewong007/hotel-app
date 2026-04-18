import React from 'react';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import KeyIcon from '@mui/icons-material/Key';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import SupportAgentIcon from '@mui/icons-material/SupportAgent';
import TipsAndUpdatesOutlinedIcon from '@mui/icons-material/TipsAndUpdatesOutlined';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Grid,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material';
import { Link } from 'react-router-dom';
import { useAuth } from '../../../auth/AuthContext';
import { canAccessNavigationRoute, navigationRouteDefinitions, preloadRoute } from '../../../navigation/routeRegistry';

const supportChecklist = [
  'Check the breadcrumb trail to confirm you are working in the intended module.',
  'Refresh your session if data looks stale after a long idle period.',
  'Use passkeys where available to reduce login friction and improve security.',
];

const securityTips = [
  'Only staff with matching roles and permissions will see protected pages.',
  '401 responses automatically clear your session to prevent stale access tokens.',
  'Shared workstations should always be signed out when a shift ends.',
];

const workflowTips = [
  'Use Timeline for reservation visibility and room movement planning.',
  'Open Rooms to manage occupancy, checkout timing, and operational status.',
  'Use Reports when you need summaries instead of raw operational lists.',
];

export default function HelpSupportPage() {
  const { hasPermission, hasRole, user } = useAuth();

  const quickLinks = navigationRouteDefinitions
    .filter((route) => canAccessNavigationRoute(route, { hasPermission, hasRole }))
    .slice(0, 6);

  return (
    <Stack spacing={3}>
      <Card elevation={0} sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider', background: 'linear-gradient(135deg, rgba(25, 118, 210, 0.08), rgba(46, 125, 50, 0.06))' }}>
        <CardContent sx={{ p: { xs: 2.5, md: 3 } }}>
          <Stack spacing={2}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }}>
              <Box>
                <Typography variant="overline" sx={{ letterSpacing: '0.08em', color: 'primary.main', fontWeight: 700 }}>
                  Help Center
                </Typography>
                <Typography variant="h5" sx={{ fontWeight: 700 }}>
                  Support for your daily hotel workflow
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 720, mt: 1 }}>
                  Find quick navigation shortcuts, access guidance, and recovery tips for {user?.full_name || user?.username || 'your'} current session.
                </Typography>
              </Box>
              <Chip icon={<HelpOutlineIcon />} label="In-app support" color="primary" variant="outlined" />
            </Stack>

            <Alert severity="info" sx={{ borderRadius: 2 }}>
              If a page is unavailable, it is usually tied to role or permission settings rather than a broken link. Contact an administrator when access needs to change.
            </Alert>
          </Stack>
        </CardContent>
      </Card>

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, lg: 7 }}>
          <Card elevation={0} sx={{ height: '100%', borderRadius: 3, border: '1px solid', borderColor: 'divider' }}>
            <CardContent sx={{ p: 3 }}>
              <Stack spacing={2.5}>
                <Box>
                  <Typography variant="h6" sx={{ fontWeight: 700 }}>
                    Quick links
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Jump back into the modules currently available to your account.
                  </Typography>
                </Box>

                <Grid container spacing={2}>
                  {quickLinks.map((route) => {
                    const Icon = route.icon;

                    return (
                      <Grid key={route.id} size={{ xs: 12, sm: 6 }}>
                        <Card
                          variant="outlined"
                          sx={{
                            height: '100%',
                            borderRadius: 2.5,
                            transition: 'transform 0.2s ease, border-color 0.2s ease',
                            '&:hover': {
                              transform: 'translateY(-2px)',
                              borderColor: 'primary.main',
                            },
                          }}
                        >
                          <CardContent sx={{ p: 2.25 }}>
                            <Stack spacing={1.5}>
                              <Stack direction="row" spacing={1.25} alignItems="center">
                                <Box sx={{ width: 40, height: 40, borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'primary.50', color: 'primary.main' }}>
                                  {Icon ? <Icon sx={{ fontSize: 20 }} /> : <ArrowForwardIcon sx={{ fontSize: 20 }} />}
                                </Box>
                                <Box>
                                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                                    {route.navLabel || route.breadcrumbLabel}
                                  </Typography>
                                  <Typography variant="caption" color="text.secondary">
                                    {route.path}
                                  </Typography>
                                </Box>
                              </Stack>

                              <Button
                                component={Link}
                                to={route.path}
                                variant="text"
                                endIcon={<ArrowForwardIcon />}
                                sx={{ alignSelf: 'flex-start', px: 0 }}
                                onMouseEnter={() => preloadRoute(route.path)}
                                onFocus={() => preloadRoute(route.path)}
                              >
                                Open page
                              </Button>
                            </Stack>
                          </CardContent>
                        </Card>
                      </Grid>
                    );
                  })}
                </Grid>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, lg: 5 }}>
          <Stack spacing={3}>
            <Card elevation={0} sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider' }}>
              <CardContent sx={{ p: 3 }}>
                <Stack spacing={1.5}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <SupportAgentIcon color="primary" />
                    <Typography variant="h6" sx={{ fontWeight: 700 }}>
                      First steps when something feels off
                    </Typography>
                  </Stack>
                  <List disablePadding>
                    {supportChecklist.map((item) => (
                      <ListItem key={item} disableGutters sx={{ alignItems: 'flex-start', py: 0.75 }}>
                        <ListItemIcon sx={{ minWidth: 32, mt: 0.25 }}>
                          <TipsAndUpdatesOutlinedIcon color="primary" fontSize="small" />
                        </ListItemIcon>
                        <ListItemText primary={item} />
                      </ListItem>
                    ))}
                  </List>
                </Stack>
              </CardContent>
            </Card>

            <Card elevation={0} sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider' }}>
              <CardContent sx={{ p: 3 }}>
                <Stack spacing={1.5}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <LockOutlinedIcon color="primary" />
                    <Typography variant="h6" sx={{ fontWeight: 700 }}>
                      Security reminders
                    </Typography>
                  </Stack>
                  <List disablePadding>
                    {securityTips.map((item) => (
                      <ListItem key={item} disableGutters sx={{ alignItems: 'flex-start', py: 0.75 }}>
                        <ListItemIcon sx={{ minWidth: 32, mt: 0.25 }}>
                          <KeyIcon color="primary" fontSize="small" />
                        </ListItemIcon>
                        <ListItemText primary={item} />
                      </ListItem>
                    ))}
                  </List>
                </Stack>
              </CardContent>
            </Card>
          </Stack>
        </Grid>
      </Grid>

      <Card elevation={0} sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider' }}>
        <CardContent sx={{ p: 3 }}>
          <Stack spacing={2}>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              Common workflow tips
            </Typography>
            <Divider />
            <List disablePadding>
              {workflowTips.map((item) => (
                <ListItem key={item} disableGutters sx={{ py: 0.75 }}>
                  <ListItemIcon sx={{ minWidth: 32 }}>
                    <ArrowForwardIcon color="primary" fontSize="small" />
                  </ListItemIcon>
                  <ListItemText primary={item} />
                </ListItem>
              ))}
            </List>
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}

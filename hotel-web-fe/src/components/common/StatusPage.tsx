import { ArrowBack, Home, Lock, LockPerson, SearchOff } from '@mui/icons-material';
import { Box, Button, Paper, Stack, Typography } from '@mui/material';
import { Link } from '@tanstack/react-router';

type StatusPageProps = {
  statusCode: 403 | 404 | 423;
};

const STATUS_CONTENT = {
  403: {
    title: 'Access denied',
    message: 'You do not have permission to view this page.',
    icon: LockPerson,
  },
  404: {
    title: 'Page not found',
    message: 'The page you requested does not exist or may have moved.',
    icon: SearchOff,
  },
  423: {
    title: 'Resource locked',
    message: 'This resource is currently locked. Please try again later or contact an administrator.',
    icon: Lock,
  },
} as const;

export function StatusPage({ statusCode }: StatusPageProps) {
  const { title, message, icon: Icon } = STATUS_CONTENT[statusCode];

  return (
    <Box
      sx={{ minHeight: '60vh', display: 'grid', placeItems: 'center', py: 4 }}
      role="main"
      aria-labelledby="status-page-title"
    >
      <Paper elevation={0} sx={{ maxWidth: 520, width: '100%', p: { xs: 3, sm: 5 }, textAlign: 'center' }}>
        <Stack spacing={2.5} sx={{
          alignItems: "center"
        }}>
          <Icon color="primary" sx={{ fontSize: 56 }} aria-hidden="true" />
          <Typography variant="overline" sx={{
            color: "text.secondary"
          }}>Error {statusCode}</Typography>
          <Typography id="status-page-title" variant="h4" component="h1">{title}</Typography>
          <Typography sx={{
            color: "text.secondary"
          }}>{message}</Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{
            justifyContent: "center"
          }}>
            <Button component={Link} to="/" variant="contained" startIcon={<Home />}>
              Go home
            </Button>
            <Button variant="outlined" startIcon={<ArrowBack />} onClick={() => window.history.back()}>
              Go back
            </Button>
          </Stack>
        </Stack>
      </Paper>
    </Box>
  );
}

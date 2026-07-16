import type { ReactNode } from 'react';
import { AppBar, Box, Button, Stack, Toolbar } from '@mui/material';
import { Link, useLocation } from '../../../router';

interface GuestPortalShellProps {
  children: ReactNode;
}

const FOREST = '#06110e';
const GOLD = '#d9b572';

export function GuestPortalShell({ children }: GuestPortalShellProps) {
  const location = useLocation();
  const isBooking = new URLSearchParams(location.search).get('view') === 'booking';

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#f5efe4' }}>
      <AppBar
        position="sticky"
        elevation={0}
        sx={{
          bgcolor: FOREST,
          borderBottom: '1px solid rgba(217,181,114,0.28)',
        }}
      >
        <Toolbar
          sx={{
            minHeight: { xs: 70, sm: 82 },
            px: { xs: 2, sm: 4 },
            gap: 2,
            flexWrap: { xs: 'wrap', sm: 'nowrap' },
            py: { xs: 1, sm: 0 },
          }}
        >
          <Box
            component={Link}
            to="/"
            aria-label="Explore Salim Inn"
            sx={{
              display: 'flex',
              alignItems: 'center',
              flexShrink: 0,
              textDecoration: 'none',
            }}
          >
            <Box
              component="img"
              src="/salim-inn/salim-inn-logo.svg"
              alt="Salim Inn"
              sx={{ display: 'block', width: { xs: 126, sm: 220 }, height: 'auto' }}
            />
          </Box>

          <Stack
            direction="row"
            spacing={1}
            sx={{
              ml: { xs: 0, sm: 'auto' },
              width: { xs: '100%', sm: 'auto' },
              justifyContent: { xs: 'flex-end', sm: 'initial' },
              alignItems: 'center',
              '& .MuiButton-root': {
                whiteSpace: 'nowrap',
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                fontSize: { xs: '0.62rem', sm: '0.7rem' },
              },
            }}
          >
            <Button component={Link} to="/" sx={{ color: 'rgba(255,255,255,0.78)', display: { xs: 'none', sm: 'inline-flex' } }}>
              Explore
            </Button>
            <Button
              component={Link}
              to="/guest-portal"
              variant={isBooking ? 'text' : 'outlined'}
              sx={{
                color: 'white',
                borderColor: 'rgba(255,255,255,0.28)',
                display: { xs: isBooking ? 'none' : 'inline-flex', sm: 'inline-flex' },
              }}
            >
              My stay
            </Button>
            <Button
              component={Link}
              to="/guest-portal?view=booking"
              variant="contained"
              sx={{
                bgcolor: GOLD,
                color: '#172119',
                '&:hover': { bgcolor: '#e4c487' },
                display: { xs: isBooking ? 'none' : 'inline-flex', sm: 'inline-flex' },
              }}
            >
              Book a room
            </Button>
          </Stack>
        </Toolbar>
      </AppBar>

      <Box component="main">{children}</Box>
    </Box>
  );
}

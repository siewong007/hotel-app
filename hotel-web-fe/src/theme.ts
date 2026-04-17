import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#26a69a',
      light: '#64d8cb',
      dark: '#00796b',
      contrastText: '#fff',
    },
    secondary: {
      main: '#00bcd4',
      light: '#62efff',
      dark: '#008ba3',
      contrastText: '#fff',
    },
    background: {
      default: '#f1f8f6',
      paper: '#ffffff',
    },
    text: {
      primary: '#1a4d42',
      secondary: '#5f7976',
    },
    success: {
      main: '#26a69a',
      light: '#64d8cb',
      dark: '#00796b',
    },
    info: {
      main: '#00bcd4',
      light: '#62efff',
      dark: '#008ba3',
    },
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    h1: { fontWeight: 700, fontSize: '2.5rem' },
    h2: { fontWeight: 700, fontSize: '2rem' },
    h3: { fontWeight: 600, fontSize: '1.75rem' },
    h4: { fontWeight: 600, fontSize: '1.5rem' },
    h5: { fontWeight: 600, fontSize: '1.25rem' },
    h6: { fontWeight: 600, fontSize: '1rem' },
  },
  shape: { borderRadius: 12 },
  shadows: [
    'none',
    '0px 2px 4px rgba(0,0,0,0.05)',
    '0px 4px 8px rgba(0,0,0,0.08)',
    '0px 8px 16px rgba(0,0,0,0.1)',
    '0px 12px 24px rgba(0,0,0,0.12)',
    '0px 14px 28px rgba(0,0,0,0.13)',
    '0px 16px 32px rgba(0,0,0,0.14)',
    '0px 18px 36px rgba(0,0,0,0.15)',
    '0px 20px 40px rgba(0,0,0,0.16)',
    '0px 22px 44px rgba(0,0,0,0.17)',
    '0px 24px 48px rgba(0,0,0,0.18)',
    '0px 26px 52px rgba(0,0,0,0.19)',
    '0px 28px 56px rgba(0,0,0,0.20)',
    '0px 30px 60px rgba(0,0,0,0.21)',
    '0px 32px 64px rgba(0,0,0,0.22)',
    '0px 34px 68px rgba(0,0,0,0.23)',
    '0px 36px 72px rgba(0,0,0,0.24)',
    '0px 38px 76px rgba(0,0,0,0.25)',
    '0px 40px 80px rgba(0,0,0,0.26)',
    '0px 42px 84px rgba(0,0,0,0.27)',
    '0px 44px 88px rgba(0,0,0,0.28)',
    '0px 46px 92px rgba(0,0,0,0.29)',
    '0px 48px 96px rgba(0,0,0,0.30)',
    '0px 50px 100px rgba(0,0,0,0.31)',
    '0px 52px 104px rgba(0,0,0,0.32)',
  ] as any,
  components: {
    MuiCssBaseline: {
      styleOverrides: { body: { visibility: 'visible' } },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          boxShadow: '0px 4px 12px rgba(0,0,0,0.08)',
          transition: 'box-shadow 0.25s cubic-bezier(0.4, 0, 0.2, 1), transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          willChange: 'transform, box-shadow',
          backfaceVisibility: 'hidden',
          '&:hover': {
            boxShadow: '0px 8px 24px rgba(0,0,0,0.12)',
            transform: 'translateY(-2px) translateZ(0)',
          },
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
          borderRadius: 8,
          padding: '10px 24px',
          transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          boxShadow: '0px 2px 8px rgba(0,0,0,0.1)',
          background: 'linear-gradient(135deg, #26a69a 0%, #00796b 100%)',
          willChange: 'transform',
          backfaceVisibility: 'hidden',
        },
      },
    },
    MuiModal: {
      styleOverrides: {
        root: {
          '& .MuiBackdrop-root': {
            transition: 'opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
          },
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          transform: 'translateZ(0)',
          backfaceVisibility: 'hidden',
        },
      },
    },
  },
});

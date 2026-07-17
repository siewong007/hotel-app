import { createTheme } from '@mui/material/styles';

/**
 * A deliberately local visual language for the guest experience. Keeping this
 * theme nested prevents operational screens from inheriting its warmer tone.
 */
export const guestPortalTheme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#123C30', dark: '#08261E', light: '#315E50', contrastText: '#FFFFFF' },
    secondary: { main: '#A6422B', dark: '#7D2D1B', light: '#C36148', contrastText: '#FFFFFF' },
    background: { default: '#F5F0E6', paper: '#FFFCF6' },
    text: { primary: '#17211D', secondary: '#56625B' },
    divider: '#D9D0C0',
  },
  spacing: 8,
  shape: { borderRadius: 12 },
  typography: {
    fontFamily: 'Inter, "Helvetica Neue", Arial, sans-serif',
    h1: { fontFamily: 'Georgia, "Times New Roman", serif', fontWeight: 700, letterSpacing: '-0.03em' },
    h2: { fontFamily: 'Georgia, "Times New Roman", serif', fontWeight: 700, letterSpacing: '-0.025em' },
    h3: { fontFamily: 'Georgia, "Times New Roman", serif', fontWeight: 700, letterSpacing: '-0.02em' },
    h4: { fontFamily: 'Georgia, "Times New Roman", serif', fontWeight: 700, letterSpacing: '-0.015em' },
    h5: { fontFamily: 'Georgia, "Times New Roman", serif', fontWeight: 700 },
    h6: { fontFamily: 'Georgia, "Times New Roman", serif', fontWeight: 700 },
    button: { fontWeight: 700, letterSpacing: '0.04em' },
  },
  components: {
    MuiButtonBase: {
      styleOverrides: {
        root: {
          '&:focus-visible, &.Mui-focusVisible': {
            outline: '3px solid #C7A45B',
            outlineOffset: 3,
          },
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          textTransform: 'none',
          transition: 'background-color 200ms ease, border-color 200ms ease, color 200ms ease, transform 200ms ease',
          '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: 'none' },
      },
    },
    MuiTabs: {
      styleOverrides: {
        indicator: { height: 3, borderRadius: 3, backgroundColor: '#A6422B' },
      },
    },
  },
});

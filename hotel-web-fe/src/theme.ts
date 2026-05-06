import { createTheme } from '@mui/material/styles';

export type ThemeMode = 'light' | 'dark' | 'night';

const paletteByMode = {
  light: {
    mode: 'light' as const,
    primary: { main: '#26a69a', light: '#64d8cb', dark: '#00796b', contrastText: '#fff' },
    secondary: { main: '#00bcd4', light: '#62efff', dark: '#008ba3', contrastText: '#fff' },
    background: { default: '#f4f7f4', paper: '#ffffff' },
    text: { primary: '#202124', secondary: '#69716d' },
    divider: '#d9ded9',
  },
  dark: {
    mode: 'dark' as const,
    primary: { main: '#4db6ac', light: '#80cbc4', dark: '#00897b', contrastText: '#061615' },
    secondary: { main: '#4fc3f7', light: '#81d4fa', dark: '#0288d1', contrastText: '#061018' },
    background: { default: '#151817', paper: '#202523' },
    text: { primary: '#edf3f0', secondary: '#aebbb6' },
    divider: '#34413c',
  },
  night: {
    mode: 'dark' as const,
    primary: { main: '#7dd3fc', light: '#bae6fd', dark: '#38bdf8', contrastText: '#06121f' },
    secondary: { main: '#a78bfa', light: '#c4b5fd', dark: '#7c3aed', contrastText: '#0d0920' },
    background: { default: '#060914', paper: '#0e1422' },
    text: { primary: '#f2f7ff', secondary: '#95a3b8' },
    divider: '#223047',
  },
};

export const createAppTheme = (themeMode: ThemeMode = 'light') => {
  const selected = paletteByMode[themeMode];
  const darkSurface = themeMode === 'night' ? '#10192a' : '#26312d';
  const isLight = themeMode === 'light';
  const appBarBackground = isLight
    ? 'linear-gradient(135deg, #2f8d66 0%, #1f6f52 100%)'
    : themeMode === 'night'
      ? 'linear-gradient(135deg, #0b1220 0%, #17243a 100%)'
      : 'linear-gradient(135deg, #202523 0%, #111614 100%)';
  const appBackground = isLight
    ? 'linear-gradient(135deg, #eef8f5 0%, #dff2ed 48%, #ccebe5 100%)'
    : themeMode === 'night'
      ? 'linear-gradient(135deg, #060914 0%, #0e1422 48%, #17243a 100%)'
      : 'linear-gradient(135deg, #151817 0%, #1c2421 50%, #26312d 100%)';
  const panelBackground = isLight ? 'rgba(255, 255, 255, 0.94)' : themeMode === 'night' ? 'rgba(14, 20, 34, 0.94)' : 'rgba(32, 37, 35, 0.94)';
  const mutedBackground = isLight ? '#eef7f3' : themeMode === 'night' ? '#17243a' : '#26312d';
  const subtleBackground = isLight ? '#f7fbf8' : themeMode === 'night' ? '#101a2d' : '#252d29';
  const popupBackground = selected.background.paper;
  const popupMutedBackground = isLight ? '#f7fbf8' : themeMode === 'night' ? '#111c30' : '#252e2a';
  const popupBorder = isLight ? selected.divider : themeMode === 'night' ? '#2d3d59' : '#46544f';
  const popupShadow = isLight ? '0 20px 50px rgba(15,23,42,0.16)' : '0 22px 56px rgba(0,0,0,0.54)';
  const popupBackdrop = isLight ? 'rgba(15,23,42,0.34)' : 'rgba(0,0,0,0.64)';
  const neutralGrey = isLight
    ? {
        50: '#f7fbf8',
        100: '#eef7f3',
        200: '#d9ded9',
        300: '#c5ccc6',
        400: '#9aa6a0',
        500: '#69716d',
        600: '#555e59',
        700: '#3f4742',
        800: '#2d3530',
        900: '#202124',
      }
    : themeMode === 'night'
      ? {
          50: '#101a2d',
          100: '#17243a',
          200: '#223047',
          300: '#34435b',
          400: '#5f7088',
          500: '#95a3b8',
          600: '#b7c2d2',
          700: '#d1dae8',
          800: '#e3ebf7',
          900: '#f2f7ff',
        }
      : {
          50: '#252d29',
          100: '#2d3833',
          200: '#34413c',
          300: '#46544f',
          400: '#70817a',
          500: '#aebbb6',
          600: '#c7d1cd',
          700: '#dbe7e1',
          800: '#e7f0ec',
          900: '#edf3f0',
        };
  const softGlow = isLight
    ? 'radial-gradient(circle at 50% 50%, rgba(38, 166, 154, 0.14) 0%, transparent 52%)'
    : themeMode === 'night'
      ? 'radial-gradient(circle at 50% 50%, rgba(125, 211, 252, 0.12) 0%, transparent 52%)'
      : 'radial-gradient(circle at 50% 50%, rgba(77, 182, 172, 0.12) 0%, transparent 52%)';
  const actionGradient = `linear-gradient(135deg, ${selected.primary.main} 0%, ${selected.secondary.main} 100%)`;
  const actionGradientHover = `linear-gradient(135deg, ${selected.primary.dark} 0%, ${selected.primary.main} 100%)`;
  const accentText = isLight ? selected.primary.dark : selected.primary.light;
  const onAccent = isLight ? '#ffffff' : selected.primary.contrastText;
  const shadowColor = isLight ? 'rgba(38, 166, 154, 0.24)' : 'rgba(0, 0, 0, 0.44)';
  const boardBorder = themeMode === 'light' ? '#202124' : '#dbe7e1';
  const boardShadow = themeMode === 'light' ? '4px 4px 0 rgba(32,33,36,0.22)' : '4px 4px 0 rgba(0,0,0,0.55)';
  const boardLargeShadow = themeMode === 'light' ? '8px 8px 0 rgba(32,33,36,0.18)' : '8px 8px 0 rgba(0,0,0,0.58)';
  const boardAltSurface = themeMode === 'light' ? '#fbfaf6' : themeMode === 'night' ? '#101a2d' : '#252d29';
  const boardSelected = themeMode === 'light' ? '#f1efe7' : themeMode === 'night' ? '#17243a' : '#2d3833';
  const boardDash = themeMode === 'light' ? '#9aa09b' : '#65746f';

  return createTheme({
    palette: {
      ...selected,
      grey: neutralGrey,
      action: {
        active: selected.text.secondary,
        hover: mutedBackground,
        selected: subtleBackground,
        disabled: isLight ? 'rgba(32, 33, 36, 0.38)' : 'rgba(237, 243, 240, 0.35)',
        disabledBackground: isLight ? 'rgba(32, 33, 36, 0.12)' : 'rgba(237, 243, 240, 0.12)',
        focus: subtleBackground,
      },
      success: {
        main: themeMode === 'light' ? '#2e8b57' : '#5cc98b',
        light: '#80d8a4',
        dark: '#1f6c43',
      },
      warning: {
        main: '#d99b2b',
        light: '#f0c35f',
        dark: '#9d6b12',
      },
      info: {
        main: themeMode === 'night' ? '#60a5fa' : '#3f7fbd',
        light: '#93c5fd',
        dark: '#1d4ed8',
      },
      error: {
        main: '#ef5350',
        light: '#ef9a9a',
        dark: '#c62828',
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
    shape: { borderRadius: 8 },
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
        styleOverrides: {
          ':root': {
            '--hotel-bg': selected.background.default,
            '--hotel-paper': selected.background.paper,
            '--hotel-text-primary': selected.text.primary,
            '--hotel-text-secondary': selected.text.secondary,
            '--hotel-divider': selected.divider,
            '--hotel-primary': selected.primary.main,
            '--hotel-primary-light': selected.primary.light,
            '--hotel-primary-dark': selected.primary.dark,
            '--hotel-secondary': selected.secondary.main,
            '--hotel-secondary-light': selected.secondary.light,
            '--hotel-secondary-dark': selected.secondary.dark,
            '--hotel-on-accent': onAccent,
            '--hotel-appbar-bg': appBarBackground,
            '--hotel-page-bg': appBackground,
            '--hotel-panel-bg': panelBackground,
            '--hotel-muted-bg': mutedBackground,
            '--hotel-subtle-bg': subtleBackground,
            '--hotel-popup-bg': popupBackground,
            '--hotel-popup-muted-bg': popupMutedBackground,
            '--hotel-popup-border': popupBorder,
            '--hotel-popup-shadow': popupShadow,
            '--hotel-popup-backdrop': popupBackdrop,
            '--hotel-soft-glow': softGlow,
            '--hotel-action-gradient': actionGradient,
            '--hotel-action-gradient-hover': actionGradientHover,
            '--hotel-accent-text': accentText,
            '--hotel-shadow-color': shadowColor,
            '--hotel-scrollbar-track': mutedBackground,
            '--hotel-scrollbar-thumb': selected.primary.light,
            '--hotel-scrollbar-thumb-hover': selected.primary.main,
          },
          'html, body, #root': {
            minHeight: '100%',
            backgroundColor: selected.background.default,
            color: selected.text.primary,
          },
          body: {
            visibility: 'visible',
            backgroundColor: selected.background.default,
            color: selected.text.primary,
          },
          '#root': {
            backgroundColor: selected.background.default,
          },
          '.hotel-board-shell': {
            backgroundColor: selected.background.default,
            backgroundImage: themeMode === 'light'
              ? 'linear-gradient(0deg, rgba(32,33,36,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(32,33,36,0.025) 1px, transparent 1px)'
              : 'linear-gradient(0deg, rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)',
            backgroundSize: '72px 72px',
          },
          '.hotel-board-skin .MuiPaper-root:not(.MuiAppBar-root):not(.MuiDrawer-paper), body.hotel-board-skin-active .MuiDialog-paper, body.hotel-board-skin-active .MuiPopover-paper, body.hotel-board-skin-active .MuiMenu-paper, body.hotel-board-skin-active .MuiPopper-root .MuiPaper-root, body.hotel-board-skin-active .MuiAutocomplete-paper, body.hotel-board-skin-active .MuiPickersPopper-paper, body.hotel-board-skin-active .MuiSnackbarContent-root': {
            backgroundImage: 'none',
            border: `2px solid ${boardBorder}`,
            borderRadius: 8,
            boxShadow: boardShadow,
          },
          'body .MuiDialog-paper, body .MuiPopover-paper, body .MuiMenu-paper, body .MuiPopper-root .MuiPaper-root, body .MuiAutocomplete-paper, body .MuiPickersPopper-paper': {
            backgroundColor: `${popupBackground} !important`,
            color: selected.text.primary,
            backgroundImage: 'none',
            borderColor: popupBorder,
          },
          'body .MuiDialog-paper': {
            boxShadow: popupShadow,
          },
          'body .MuiDialogTitle-root, body .MuiDialogContent-root, body .MuiDialogActions-root': {
            color: selected.text.primary,
          },
          ...(isLight ? {} : {
            'body .MuiDialogContent-root, body .MuiDialogActions-root': {
              backgroundColor: `${popupBackground} !important`,
            },
            'body .MuiDialogActions-root': {
              borderTopColor: `${selected.divider} !important`,
            },
            'body .MuiPaper-root .MuiPaper-root, body .MuiDialog-paper .MuiPaper-root:not(.MuiAppBar-root)': {
              backgroundColor: `${popupMutedBackground} !important`,
              color: selected.text.primary,
              borderColor: popupBorder,
            },
            'body .MuiMenuItem-root, body .MuiAutocomplete-option': {
              color: selected.text.primary,
            },
            'body .MuiMenuItem-root.Mui-selected, body .MuiMenuItem-root:hover, body .MuiAutocomplete-option[aria-selected="true"], body .MuiAutocomplete-option.Mui-focused': {
              backgroundColor: `${subtleBackground} !important`,
            },
            'body .MuiSnackbarContent-root': {
              backgroundColor: `${popupMutedBackground} !important`,
              color: selected.text.primary,
              border: `1px solid ${popupBorder}`,
            },
          }),
          '.hotel-board-skin .MuiCard-root': {
            backgroundColor: selected.background.paper,
            border: `2px solid ${boardBorder}`,
            borderRadius: 8,
            boxShadow: boardShadow,
            transform: 'none',
          },
          '.hotel-board-skin .MuiCard-root:hover': {
            boxShadow: boardLargeShadow,
            transform: 'translate(-1px, -1px)',
          },
          '.hotel-board-skin .MuiCardHeader-root, .hotel-board-skin .MuiDialogTitle-root, body.hotel-board-skin-active .MuiDialogTitle-root': {
            borderBottom: `1px dashed ${boardDash}`,
            paddingBottom: 12,
          },
          'body.hotel-board-skin-active .MuiDialogTitle-root': {
            backgroundColor: `${selected.background.paper} !important`,
            color: `${selected.text.primary} !important`,
          },
          'body.hotel-board-skin-active .MuiDialogTitle-root .MuiSvgIcon-root, body.hotel-board-skin-active .MuiDialogTitle-root .MuiIconButton-root': {
            color: `${selected.text.primary} !important`,
          },
          'body.hotel-board-skin-active .MuiDialogContent-root': {
            backgroundColor: selected.background.paper,
          },
          '.hotel-board-skin .MuiCardContent-root': {
            paddingTop: 16,
          },
          '.hotel-board-skin .MuiDialogActions-root, body.hotel-board-skin-active .MuiDialogActions-root': {
            borderTop: `1px dashed ${boardDash}`,
            padding: '12px 20px',
          },
          '.hotel-board-skin .MuiButton-root, body.hotel-board-skin-active .MuiButton-root': {
            borderRadius: 6,
            borderWidth: 2,
            fontWeight: 900,
            boxShadow: 'none',
          },
          '.hotel-board-skin .MuiButton-contained, body.hotel-board-skin-active .MuiButton-contained': {
            border: `2px solid ${boardBorder}`,
          },
          '.hotel-board-skin .MuiButton-outlined, body.hotel-board-skin-active .MuiButton-outlined': {
            borderColor: boardBorder,
            color: selected.text.primary,
            backgroundColor: selected.background.paper,
          },
          '.hotel-board-skin .MuiButton-text, body.hotel-board-skin-active .MuiButton-text': {
            border: '2px solid transparent',
          },
          '.hotel-board-skin .MuiChip-root, body.hotel-board-skin-active .MuiChip-root': {
            borderRadius: 6,
            border: `1px solid ${boardBorder}`,
            fontWeight: 800,
          },
          '.hotel-board-skin .MuiTableContainer-root': {
            border: `2px solid ${boardBorder}`,
            borderRadius: 8,
            boxShadow: boardShadow,
            backgroundColor: selected.background.paper,
          },
          '.hotel-board-skin .MuiTableHead-root .MuiTableCell-root': {
            backgroundColor: boardSelected,
            color: selected.text.primary,
            fontWeight: 900,
            borderBottom: `2px solid ${boardBorder}`,
          },
          '.hotel-board-skin .MuiTableBody-root .MuiTableCell-root': {
            borderBottom: `1px dashed ${boardDash}`,
          },
          '.hotel-board-skin .MuiTableRow-root:hover': {
            backgroundColor: boardAltSurface,
          },
          '.hotel-board-skin .MuiOutlinedInput-root, body.hotel-board-skin-active .MuiOutlinedInput-root': {
            borderRadius: 6,
            backgroundColor: selected.background.paper,
          },
          '.hotel-board-skin .MuiOutlinedInput-notchedOutline, body.hotel-board-skin-active .MuiOutlinedInput-notchedOutline': {
            borderColor: boardDash,
            borderWidth: 1,
          },
          '.hotel-board-skin .MuiOutlinedInput-root:hover .MuiOutlinedInput-notchedOutline, body.hotel-board-skin-active .MuiOutlinedInput-root:hover .MuiOutlinedInput-notchedOutline': {
            borderColor: boardBorder,
          },
          '.hotel-board-skin .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline, body.hotel-board-skin-active .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline': {
            borderColor: selected.primary.main,
            borderWidth: 2,
          },
          '.hotel-board-skin .MuiInputLabel-root.Mui-focused, body.hotel-board-skin-active .MuiInputLabel-root.Mui-focused': {
            color: selected.primary.main,
          },
          '.hotel-board-skin .MuiTabs-root': {
            borderBottom: `2px solid ${boardBorder}`,
            minHeight: 44,
          },
          '.hotel-board-skin .MuiTab-root': {
            fontWeight: 800,
            minHeight: 44,
          },
          '.hotel-board-skin .MuiTab-root.Mui-selected': {
            backgroundColor: boardSelected,
            color: selected.text.primary,
          },
          '.hotel-board-skin .MuiListItemButton-root': {
            borderRadius: 6,
          },
          '.hotel-board-skin .MuiListItemButton-root.Mui-selected, .hotel-board-skin .MuiListItemButton-root:hover, body.hotel-board-skin-active .MuiMenuItem-root.Mui-selected, body.hotel-board-skin-active .MuiMenuItem-root:hover': {
            backgroundColor: boardSelected,
          },
          '.hotel-board-skin .MuiAlert-root, body.hotel-board-skin-active .MuiAlert-root': {
            border: `2px solid ${boardBorder}`,
            borderRadius: 8,
            boxShadow: 'none',
          },
          '.hotel-board-skin .MuiAccordion-root': {
            border: `2px solid ${boardBorder}`,
            borderRadius: 8,
            boxShadow: boardShadow,
            overflow: 'hidden',
          },
          '.hotel-board-skin .MuiAccordion-root:before': {
            display: 'none',
          },
          '.hotel-board-skin .MuiLinearProgress-root': {
            borderRadius: 999,
            border: `1px solid ${boardBorder}`,
          },
          '.hotel-board-skin h1, .hotel-board-skin h2, .hotel-board-skin h3, .hotel-board-skin h4, .hotel-board-skin h5, .hotel-board-skin h6, body.hotel-board-skin-active .MuiDialogTitle-root': {
            letterSpacing: 0,
            fontWeight: 900,
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            boxShadow: themeMode === 'light' ? '0px 4px 12px rgba(0,0,0,0.08)' : '0px 8px 20px rgba(0,0,0,0.28)',
            transition: 'box-shadow 0.2s cubic-bezier(0.4, 0, 0.2, 1), transform 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
            willChange: 'transform, box-shadow',
            backfaceVisibility: 'hidden',
            '&:hover': {
              boxShadow: themeMode === 'light' ? '0px 8px 24px rgba(0,0,0,0.12)' : '0px 12px 28px rgba(0,0,0,0.4)',
              transform: 'translateY(-2px) translateZ(0)',
            },
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: {
            textTransform: 'none',
            fontWeight: 700,
            borderRadius: 6,
            padding: '8px 18px',
            transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
          },
        },
      },
      MuiAppBar: {
        styleOverrides: {
          root: {
            boxShadow: '0px 2px 8px rgba(0,0,0,0.18)',
            background: appBarBackground,
            willChange: 'transform',
            backfaceVisibility: 'hidden',
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            backgroundColor: popupBackground,
            color: selected.text.primary,
            border: `1px solid ${popupBorder}`,
            backgroundImage: 'none',
            boxShadow: popupShadow,
          },
        },
      },
      MuiDialogContent: {
        styleOverrides: {
          root: {
            backgroundColor: popupBackground,
          },
        },
      },
      MuiDialogActions: {
        styleOverrides: {
          root: {
            backgroundColor: popupBackground,
            borderTop: `1px solid ${selected.divider}`,
          },
        },
      },
      MuiPopover: {
        styleOverrides: {
          paper: {
            backgroundColor: popupBackground,
            color: selected.text.primary,
            border: `1px solid ${popupBorder}`,
            boxShadow: popupShadow,
          },
        },
      },
      MuiMenu: {
        styleOverrides: {
          paper: {
            backgroundColor: themeMode === 'light' ? '#fff' : darkSurface,
            color: selected.text.primary,
            border: `1px solid ${popupBorder}`,
          },
        },
      },
      MuiAutocomplete: {
        styleOverrides: {
          paper: {
            backgroundColor: popupBackground,
            color: selected.text.primary,
            border: `1px solid ${popupBorder}`,
          },
          option: {
            color: selected.text.primary,
          },
        },
      },
      MuiModal: {
        styleOverrides: {
          root: {
            '& .MuiBackdrop-root': {
              backgroundColor: popupBackdrop,
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
};

export const theme = createAppTheme('light');

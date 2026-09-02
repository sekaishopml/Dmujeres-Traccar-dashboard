export default {
  MuiUseMediaQuery: {
    defaultProps: {
      noSsr: true,
    },
  },
  MuiCssBaseline: {
    styleOverrides: (theme) => ({
      body: {
        backgroundColor: '#0A0B14',
        backgroundImage: 'radial-gradient(1200px 600px at 10% -10%, rgba(255,45,138,0.12), transparent 60%), radial-gradient(1000px 500px at 90% 0%, rgba(124,58,237,0.14), transparent 60%), radial-gradient(900px 600px at 50% 120%, rgba(59,178,208,0.08), transparent 60%)',
        backgroundAttachment: 'fixed',
      },
      // Map controls glass enterprise
      '.maplibregl-ctrl-group': {
        background: 'rgba(20,20,28,0.6) !important',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        border: '1px solid rgba(255,255,255,0.08) !important',
        borderRadius: '12px !important',
        overflow: 'hidden',
        boxShadow: '0 4px 20px rgba(0,0,0,0.4) !important',
      },
      '.maplibregl-ctrl-group button': {
        color: 'rgba(255,255,255,0.9) !important',
        backgroundColor: 'transparent !important',
      },
      '.maplibregl-ctrl-group button:hover': {
        backgroundColor: 'rgba(255,255,255,0.08) !important',
      },
      '.maplibregl-ctrl-attrib': {
        background: 'rgba(20,20,28,0.6) !important',
        backdropFilter: 'blur(12px)',
        borderRadius: '8px',
        color: 'rgba(255,255,255,0.7)',
        border: '1px solid rgba(255,255,255,0.08)',
      },
      '.maplibregl-ctrl-scale': {
        background: 'rgba(20,20,28,0.6) !important',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '8px',
        color: '#F5F5F7',
        padding: '4px 8px',
      },
      '@keyframes dm-pulse': {
        '0%': { transform: 'scale(1)', opacity: 1, boxShadow: '0 0 0 0 rgba(255,45,138,0.6)' },
        '70%': { transform: 'scale(1.05)', opacity: 0.85, boxShadow: '0 0 0 8px rgba(255,45,138,0)' },
        '100%': { transform: 'scale(1)', opacity: 1, boxShadow: '0 0 0 0 rgba(255,45,138,0)' },
      },
      '@keyframes dm-dot-pulse': {
        '0%': { transform: 'scale(1)', opacity: 1 },
        '50%': { transform: 'scale(1.4)', opacity: 0.6 },
        '100%': { transform: 'scale(1)', opacity: 1 },
      },
      '@keyframes dm-shift': {
        '0%': { backgroundPosition: '0% 50%' },
        '100%': { backgroundPosition: '200% 50%' },
      },
      '@keyframes dm-spin': {
        to: { transform: 'rotate(1turn)' },
      },
    }),
  },
  MuiPaper: {
    styleOverrides: {
      root: ({ theme }) => ({
        backgroundImage: 'none',
        backgroundColor: theme.palette.background.paper,
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: `1px solid ${theme.palette.divider}`,
        boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
      }),
      elevation0: {
        backgroundImage: 'none',
      },
      elevation1: ({ theme }) => ({
        backgroundImage: 'none',
        backgroundColor: 'rgba(22,22,31,0.72)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: `1px solid ${theme.palette.divider}`,
      }),
      elevation3: ({ theme }) => ({
        backgroundImage: 'none',
        backgroundColor: 'rgba(22,22,31,0.72)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: `1px solid ${theme.palette.divider}`,
      }),
    },
  },
  MuiCard: {
    styleOverrides: {
      root: ({ theme }) => ({
        backgroundImage: theme.palette.gradients.darkGlass,
        backgroundColor: 'rgba(22,22,31,0.62)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: `1px solid ${theme.palette.divider}`,
        borderRadius: 16,
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      }),
    },
  },
  MuiAppBar: {
    styleOverrides: {
      root: ({ theme }) => ({
        backgroundImage: 'none',
        backgroundColor: 'rgba(22,22,31,0.75)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderBottom: `1px solid ${theme.palette.divider}`,
        boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
      }),
      colorInherit: {
        backgroundColor: 'rgba(22,22,31,0.75)',
      },
    },
  },
  MuiDrawer: {
    styleOverrides: {
      paper: ({ theme }) => ({
        backgroundImage: 'none',
        backgroundColor: 'rgba(22,22,31,0.82)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderRight: `1px solid ${theme.palette.divider}`,
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      }),
      paperAnchorLeft: {
        backgroundImage: 'none',
      },
    },
  },
  MuiOutlinedInput: {
    styleOverrides: {
      root: ({ theme }) => ({
        backgroundColor: 'rgba(255,255,255,0.06)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderRadius: 12,
        '& .MuiOutlinedInput-notchedOutline': {
          borderColor: theme.palette.divider,
        },
        '&:hover .MuiOutlinedInput-notchedOutline': {
          borderColor: 'rgba(255,255,255,0.14)',
        },
        '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
          borderColor: theme.palette.primary.main,
          borderWidth: '1.5px',
        },
        '& input': {
          color: theme.palette.text.primary,
        },
      }),
    },
  },
  MuiButton: {
    styleOverrides: {
      root: {
        borderRadius: 12,
        textTransform: 'none',
        fontWeight: 600,
        letterSpacing: '0.02em',
      },
      sizeMedium: {
        height: '40px',
      },
      contained: ({ theme }) => ({
        background: theme.palette.gradients.primaryNeon || theme.palette.gradients.primary,
        color: '#FFFFFF',
        border: 'none',
        boxShadow: '0 4px 20px rgba(255,45,138,0.35)',
        '&:hover': {
          background: 'linear-gradient(135deg,#FF2D8A 0%,#8B5CF6 100%)',
          boxShadow: '0 6px 24px rgba(255,45,138,0.45)',
        },
      }),
      containedPrimary: ({ theme }) => ({
        background: theme.palette.gradients.primaryNeon || theme.palette.gradients.primary,
        color: '#FFFFFF',
      }),
      outlined: ({ theme }) => ({
        borderColor: theme.palette.divider,
        color: theme.palette.text.primary,
        background: 'rgba(255,255,255,0.04)',
        backdropFilter: 'blur(12px)',
        '&:hover': {
          borderColor: 'rgba(255,255,255,0.14)',
          background: 'rgba(255,255,255,0.08)',
        },
      }),
    },
  },
  MuiIconButton: {
    styleOverrides: {
      root: ({ theme }) => ({
        color: theme.palette.text.secondary,
        '&:hover': {
          backgroundColor: 'rgba(255,255,255,0.06)',
        },
      }),
    },
  },
  MuiChip: {
    styleOverrides: {
      root: ({ theme }) => ({
        background: 'rgba(255,255,255,0.06)',
        backdropFilter: 'blur(12px)',
        border: `1px solid ${theme.palette.divider}`,
        color: theme.palette.text.primary,
      }),
    },
  },
  MuiBottomNavigation: {
    styleOverrides: {
      root: {
        background: 'transparent',
      },
    },
  },
  MuiBottomNavigationAction: {
    styleOverrides: {
      root: ({ theme }) => ({
        color: theme.palette.text.secondary,
        '&.Mui-selected': {
          color: theme.palette.primary.main,
        },
      }),
    },
  },
  MuiSlider: {
    styleOverrides: {
      rail: {
        backgroundColor: 'rgba(255,255,255,0.15)',
        opacity: 1,
      },
      track: ({ theme }) => ({
        background: theme.palette.gradients.primaryNeon || theme.palette.gradients.primary,
        border: 'none',
        height: 4,
      }),
      thumb: ({ theme }) => ({
        background: theme.palette.gradients.primaryNeon || '#FF2D8A',
        width: 16,
        height: 16,
        boxShadow: '0 0 12px rgba(255,45,138,0.6)',
        '&:hover, &.Mui-active': {
          boxShadow: '0 0 16px rgba(255,45,138,0.8)',
        },
      }),
      valueLabel: ({ theme }) => ({
        backgroundColor: 'rgba(20,20,28,0.9)',
        color: '#F5F5F7',
        backdropFilter: 'blur(12px)',
        border: `1px solid ${theme.palette.divider}`,
        borderRadius: 8,
      }),
    },
  },
  MuiSelect: {
    styleOverrides: {
      select: {
        borderRadius: 999,
      },
    },
  },
  MuiFormControl: {
    defaultProps: {
      size: 'small',
    },
  },
  MuiSnackbar: {
    defaultProps: {
      anchorOrigin: {
        vertical: 'bottom',
        horizontal: 'center',
      },
    },
  },
  MuiTooltip: {
    defaultProps: {
      enterDelay: 500,
      enterNextDelay: 500,
    },
    styleOverrides: {
      tooltip: ({ theme }) => ({
        backgroundColor: 'rgba(20,20,28,0.85)',
        backdropFilter: 'blur(12px)',
        border: `1px solid ${theme.palette.divider}`,
        color: '#F5F5F7',
        fontSize: '0.75rem',
        borderRadius: 8,
      }),
      arrow: {
        color: 'rgba(20,20,28,0.85)',
      },
    },
  },
  MuiTableCell: {
    styleOverrides: {
      root: ({ theme }) => ({
        borderBottom: `1px solid ${theme.palette.divider}`,
        '@media print': {
          color: theme.palette.alwaysDark.main,
        },
      }),
    },
  },
  MuiListItemButton: {
    styleOverrides: {
      root: ({ theme }) => ({
        borderRadius: 12,
        margin: '2px 8px',
        border: '1px solid transparent',
        transition: 'all 0.2s ease',
        '&.Mui-selected': {
          backgroundColor: 'rgba(255,45,138,0.12)',
          border: `1px solid rgba(255,45,138,0.22)`,
          backdropFilter: 'blur(12px)',
          '&:hover': {
            backgroundColor: 'rgba(255,45,138,0.16)',
          },
        },
        '&:hover': {
          backgroundColor: 'rgba(255,255,255,0.06)',
        },
      }),
    },
  },
};

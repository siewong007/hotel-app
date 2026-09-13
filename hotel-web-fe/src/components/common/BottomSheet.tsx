import React from 'react';
import { Box, IconButton, SwipeableDrawer, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { useTranslation } from '../../i18n';

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  /** Extra actions rendered at the right of the title row (e.g. a Reset button). */
  headerAction?: React.ReactNode;
  children: React.ReactNode;
}

const noop = () => {};

/**
 * The app's mobile sheet: a bottom-anchored swipeable drawer with a drag
 * handle, capped height, and safe-area bottom padding. Use it for filters,
 * quick actions, and "More" menus — anywhere a phone UI would otherwise get a
 * cramped floating dialog. (MUI `Dialog` already goes full-screen below `sm`;
 * reach for this when the content is a *choice*, not a *form*.)
 */
export const BottomSheet: React.FC<BottomSheetProps> = ({
  open,
  onClose,
  title,
  headerAction,
  children,
}) => {
  const { t } = useTranslation('common');

  return (
    <SwipeableDrawer
      anchor="bottom"
      open={open}
      onClose={onClose}
      onOpen={noop}
      disableSwipeToOpen
      slotProps={{
        paper: {
          sx: {
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            maxHeight: '88dvh',
            bgcolor: 'background.paper',
            backgroundImage: 'none',
            display: 'flex',
            flexDirection: 'column',
          },
        },
      }}
    >
      <Box sx={{ pt: 1, pb: 0.5, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
        <Box sx={{ width: 36, height: 4, borderRadius: 2, bgcolor: 'divider' }} />
      </Box>
      {title ? (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 2,
            pb: 1,
            borderBottom: '1px solid',
            borderColor: 'divider',
            flexShrink: 0,
          }}
        >
          <Typography variant="subtitle1" sx={{ fontWeight: 650, flex: 1, minWidth: 0 }}>
            {title}
          </Typography>
          {headerAction}
          <IconButton aria-label={t('actions.close')} onClick={onClose} edge="end" size="small">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
      ) : null}
      <Box
        sx={{
          px: 2,
          pt: 1.5,
          pb: 'calc(16px + var(--sab))',
          overflowY: 'auto',
          minHeight: 0,
        }}
      >
        {children}
      </Box>
    </SwipeableDrawer>
  );
};

export default BottomSheet;

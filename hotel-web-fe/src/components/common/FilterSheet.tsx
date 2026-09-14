import React from 'react';
import { Box, Button, Stack } from '@mui/material';
import { BottomSheet } from './BottomSheet';
import { useTranslation } from '../../i18n';

export interface FilterSheetProps {
  open: boolean;
  onClose: () => void;
  /** Resets all filters. Rendered as a text button in the footer. */
  onReset?: () => void;
  /** Applied when the sheet's primary action is tapped; defaults to onClose. */
  onApply?: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Mobile filter container: the page's existing filter controls rendered inside
 * a bottom sheet with a sticky Reset / Apply footer. Controls are the same
 * controlled inputs the desktop filter bar uses — the sheet only changes the
 * presentation, so Apply can simply close when filters are already live-bound.
 */
export const FilterSheet: React.FC<FilterSheetProps> = ({
  open,
  onClose,
  onReset,
  onApply,
  title,
  children,
}) => {
  const { t } = useTranslation('common');
  return (
  <BottomSheet
    open={open}
    onClose={onClose}
    title={title ?? t('filters.title')}
  >
    <Stack spacing={2}>{children}</Stack>
    <Stack
      direction="row"
      spacing={1.5}
      sx={{
        mt: 2.5,
        '& > *': { flex: 1 },
      }}
    >
      {onReset ? (
        <Button variant="outlined" onClick={onReset} fullWidth>
          {t('actions.reset')}
        </Button>
      ) : null}
      <Button
        variant="contained"
        onClick={onApply ?? onClose}
        fullWidth
      >
        {t('filters.apply')}
      </Button>
    </Stack>
    <Box sx={{ height: 4 }} />
  </BottomSheet>
  );
};

export default FilterSheet;

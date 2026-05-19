import React from 'react';
import { Box } from '@mui/material';
import type { SxProps, Theme } from '@mui/material';

export interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
  idPrefix?: string;
  className?: string;
  sx?: SxProps<Theme>;
  contentSx?: SxProps<Theme>;
}

export const getTabA11yProps = (index: number, idPrefix: string) => ({
  id: `${idPrefix}-tab-${index}`,
  'aria-controls': `${idPrefix}-tabpanel-${index}`,
});

export const TabPanel: React.FC<TabPanelProps> = ({
  children,
  value,
  index,
  idPrefix,
  className,
  sx,
  contentSx,
}) => {
  const isActive = value === index;

  return (
    <Box
      role="tabpanel"
      hidden={!isActive}
      id={idPrefix ? `${idPrefix}-tabpanel-${index}` : undefined}
      aria-labelledby={idPrefix ? `${idPrefix}-tab-${index}` : undefined}
      className={className}
      sx={sx}
    >
      {isActive && <Box sx={contentSx}>{children}</Box>}
    </Box>
  );
};

export default TabPanel;

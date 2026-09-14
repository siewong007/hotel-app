import React from 'react';
import {
  Badge,
  Box,
  FormControl,
  MenuItem,
  Select,
  Tab,
  Tabs,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material';
import { useTranslation } from '../../i18n';
import { useIsPhone } from '../../hooks/useIsPhone';

export interface ResponsiveTabItem {
  value: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  badge?: number | React.ReactNode;
  disabled?: boolean;
}

export interface ResponsiveTabsProps {
  tabs: ResponsiveTabItem[];
  value: string;
  onChange: (value: string) => void;
  /** 'auto' (default): Select on phone when >4 tabs else scrollable Tabs.
      'select' | 'scroll' force. */
  phoneMode?: 'auto' | 'select' | 'scroll';
  ariaLabel?: string;
}

/** 'auto' switches a phone to the Select once the count passes this. */
const PHONE_SELECT_THRESHOLD = 4;

/** Shared icon + label (+ Badge) visual for both Tab labels and MenuItems. */
const renderTabVisual = (tab: ResponsiveTabItem): React.ReactNode => {
  const content = (
    <Box
      component="span"
      sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}
    >
      {tab.icon}
      {tab.label}
    </Box>
  );
  if (tab.badge === undefined || tab.badge === null) return content;
  return (
    <Badge badgeContent={tab.badge} color="primary">
      {content}
    </Badge>
  );
};

/**
 * A tab strip that degrades gracefully on phones: scrollable MUI `Tabs` on
 * ≥sm (and on phones while the list is short), a full-width `Select` on
 * phones once the count gets unwieldy. `phoneMode` forces either surface;
 * 'auto' picks by tab count. Panels are unaffected — consumers keep wiring
 * `value`/`onChange` to `TabPanel` themselves, and `onChange` always emits
 * the tab's string `value` regardless of which control produced it.
 */
export const ResponsiveTabs: React.FC<ResponsiveTabsProps> = ({
  tabs,
  value,
  onChange,
  phoneMode = 'auto',
  ariaLabel,
}) => {
  const isPhone = useIsPhone();
  const { t } = useTranslation('common');
  const resolvedAriaLabel = ariaLabel ?? t('actions.sections');

  const useSelect =
    isPhone &&
    (phoneMode === 'select' ||
      (phoneMode === 'auto' && tabs.length > PHONE_SELECT_THRESHOLD));

  const handleTabsChange = (_event: React.SyntheticEvent, next: string) => {
    onChange(next);
  };
  const handleSelectChange = (event: SelectChangeEvent<string>) => {
    onChange(event.target.value);
  };

  if (useSelect) {
    return (
      <FormControl size="small" fullWidth>
        <Select
          value={value}
          onChange={handleSelectChange}
          inputProps={{ 'aria-label': resolvedAriaLabel }}
        >
          {tabs.map((tab) => (
            <MenuItem key={tab.value} value={tab.value} disabled={tab.disabled}>
              {renderTabVisual(tab)}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    );
  }

  return (
    <Tabs
      value={value}
      onChange={handleTabsChange}
      variant="scrollable"
      scrollButtons="auto"
      allowScrollButtonsMobile
      aria-label={resolvedAriaLabel}
    >
      {tabs.map((tab) => (
        <Tab
          key={tab.value}
          value={tab.value}
          label={renderTabVisual(tab)}
          disabled={tab.disabled}
        />
      ))}
    </Tabs>
  );
};

export default ResponsiveTabs;

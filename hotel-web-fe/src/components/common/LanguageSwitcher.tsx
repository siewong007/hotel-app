/**
 * The language control, in two shapes.
 *
 * `variant="icon"` is a globe button that opens a menu — for dense chrome like
 * the staff app bar and the guest portal header. `variant="list"` renders the
 * same options inline, for settings pages and the mobile navigation drawer
 * where a hidden menu would be a second tap for no reason.
 *
 * Options are read from the locale registry, so a new language appears here
 * with no edit to this file. Each option is labelled in its own language —
 * a guest looking for Bahasa Melayu is looking for "Bahasa Melayu", not for
 * whatever the current interface language calls Malay.
 */

import { useState, type MouseEvent } from 'react';
import CheckIcon from '@mui/icons-material/Check';
import LanguageIcon from '@mui/icons-material/Language';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Tooltip from '@mui/material/Tooltip';
import { LOCALE_CODES, LOCALES, useTranslation, type LocaleCode } from '../../i18n';

export interface LanguageSwitcherProps {
  variant?: 'icon' | 'list';
  /** Colour passed through to the icon button, for dark app bars. */
  color?: 'inherit' | 'default' | 'primary';
  size?: 'small' | 'medium';
}

export function LanguageSwitcher({
  variant = 'icon',
  color = 'inherit',
  size = 'medium',
}: LanguageSwitcherProps) {
  const { t, locale, setLocale } = useTranslation('common');
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

  const handleSelect = (next: LocaleCode) => {
    setLocale(next);
    setAnchorEl(null);
  };

  if (variant === 'list') {
    return (
      <List dense disablePadding aria-label={t('language.change')}>
        {LOCALE_CODES.map((code) => (
          <ListItemButton
            key={code}
            selected={code === locale}
            onClick={() => handleSelect(code)}
            lang={code}
          >
            <ListItemIcon sx={{ minWidth: 36 }}>
              {code === locale ? <CheckIcon fontSize="small" /> : null}
            </ListItemIcon>
            <ListItemText
              primary={LOCALES[code].nativeName}
              secondary={LOCALES[code].englishName !== LOCALES[code].nativeName
                ? LOCALES[code].englishName
                : undefined}
            />
          </ListItemButton>
        ))}
      </List>
    );
  }

  return (
    <>
      <Tooltip title={t('language.change')}>
        <IconButton
          color={color}
          size={size}
          onClick={(event: MouseEvent<HTMLElement>) => setAnchorEl(event.currentTarget)}
          aria-label={t('language.current', { language: LOCALES[locale].nativeName })}
          aria-haspopup="menu"
        >
          <LanguageIcon fontSize={size === 'small' ? 'small' : 'medium'} />
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {LOCALE_CODES.map((code) => (
          <MenuItem
            key={code}
            selected={code === locale}
            onClick={() => handleSelect(code)}
            lang={code}
          >
            <ListItemIcon sx={{ minWidth: 32 }}>
              {code === locale ? <CheckIcon fontSize="small" /> : null}
            </ListItemIcon>
            <ListItemText primary={LOCALES[code].nativeName} />
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

export default LanguageSwitcher;

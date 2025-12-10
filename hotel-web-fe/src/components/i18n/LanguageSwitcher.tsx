/**
 * Language Switcher Component
 * Allows users to switch between supported languages with visual feedback
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  IconButton,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Tooltip,
  Badge,
  Box,
  Typography,
  Divider,
  Chip,
  alpha,
} from '@mui/material';
import {
  Language as LanguageIcon,
  Check as CheckIcon,
  Translate as TranslateIcon,
  Star as StarIcon,
} from '@mui/icons-material';
import { SUPPORTED_LANGUAGES, getLanguageByCode } from '../../i18n/config';
import type { Language } from '../../i18n/config';
import { languageStorage, type LanguagePreference } from '../../utils/languageStorage';

interface LanguageSwitcherProps {
  variant?: 'icon' | 'button' | 'compact';
  showQualityBadge?: boolean;
}

export const LanguageSwitcher: React.FC<LanguageSwitcherProps> = ({
  variant = 'icon',
  showQualityBadge = true,
}) => {
  const { i18n, t } = useTranslation();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [isChanging, setIsChanging] = useState(false);
  const open = Boolean(anchorEl);

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleLanguageChange = async (languageCode: string) => {
    if (languageCode === i18n.language) {
      handleClose();
      return;
    }

    setIsChanging(true);

    try {
      await i18n.changeLanguage(languageCode);

      // Save language preference to localStorage
      const language = getLanguageByCode(languageCode);
      if (language) {
        const preference: LanguagePreference = {
          code: languageCode,
          name: language.name,
          nativeName: language.nativeName,
          selectedAt: new Date().toISOString(),
          isFirstVisit: false,
        };
        languageStorage.saveLanguagePreference(preference);
      }

      // Small delay for visual feedback
      setTimeout(() => {
        setIsChanging(false);
        handleClose();
      }, 300);
    } catch (error) {
      console.error('Failed to change language:', error);
      setIsChanging(false);
      handleClose();
    }
  };

  const currentLanguage = getLanguageByCode(i18n.language) || SUPPORTED_LANGUAGES[0];

  const getQualityColor = (quality: Language['quality']) => {
    switch (quality) {
      case 'tier1':
        return 'success';
      case 'tier2':
        return 'primary';
      case 'tier3':
        return 'warning';
      default:
        return 'default';
    }
  };

  const getQualityLabel = (quality: Language['quality']) => {
    switch (quality) {
      case 'tier1':
        return t('languages.quality.professional', 'Professional');
      case 'tier2':
        return t('languages.quality.high', 'High');
      case 'tier3':
        return t('languages.quality.good', 'Good');
      default:
        return '';
    }
  };

  // Render different variants
  const renderTrigger = () => {
    if (variant === 'compact') {
      return (
        <Chip
          icon={<LanguageIcon />}
          label={currentLanguage.code.toUpperCase()}
          onClick={handleClick}
          size="small"
          sx={{
            fontWeight: 600,
            cursor: 'pointer',
            '&:hover': {
              backgroundColor: (theme) => alpha(theme.palette.primary.main, 0.1),
            },
          }}
        />
      );
    }

    if (variant === 'button') {
      return (
        <Chip
          icon={<span style={{ fontSize: '1.2em' }}>{currentLanguage.flag}</span>}
          label={currentLanguage.nativeName}
          onClick={handleClick}
          clickable
          sx={{
            fontWeight: 500,
            px: 1,
            '&:hover': {
              backgroundColor: (theme) => alpha(theme.palette.primary.main, 0.1),
            },
          }}
        />
      );
    }

    // Default icon variant
    return (
      <Tooltip title={t('common.changeLanguage', 'Change Language')} arrow>
        <IconButton
          onClick={handleClick}
          disabled={isChanging}
          sx={{
            color: 'inherit',
            '&:hover': {
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
            },
          }}
          aria-label="change language"
        >
          <Badge
            badgeContent={currentLanguage.code.toUpperCase()}
            color="primary"
            sx={{
              '& .MuiBadge-badge': {
                fontSize: '0.6rem',
                minWidth: '20px',
                height: '16px',
                fontWeight: 700,
              },
            }}
          >
            <LanguageIcon />
          </Badge>
        </IconButton>
      </Tooltip>
    );
  };

  return (
    <>
      {renderTrigger()}

      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        PaperProps={{
          elevation: 8,
          sx: {
            minWidth: 280,
            maxHeight: 500,
            mt: 1.5,
            overflow: 'visible',
            filter: 'drop-shadow(0px 4px 12px rgba(0,0,0,0.1))',
            '&:before': {
              content: '""',
              display: 'block',
              position: 'absolute',
              top: 0,
              right: 14,
              width: 10,
              height: 10,
              bgcolor: 'background.paper',
              transform: 'translateY(-50%) rotate(45deg)',
              zIndex: 0,
            },
          },
        }}
        transformOrigin={{ horizontal: 'right', vertical: 'top' }}
        anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
      >
        {/* Header */}
        <Box sx={{ px: 2.5, py: 2 }}>
          <Box display="flex" alignItems="center" gap={1.5}>
            <TranslateIcon color="primary" sx={{ fontSize: 24 }} />
            <Box>
              <Typography variant="subtitle1" fontWeight={700}>
                {t('languages.title', 'Select Language')}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {SUPPORTED_LANGUAGES.length} {t('languages.available', 'languages available')}
              </Typography>
            </Box>
          </Box>
        </Box>
        <Divider />

        {/* Language List */}
        <Box sx={{ maxHeight: 350, overflowY: 'auto' }}>
          {SUPPORTED_LANGUAGES.map((language) => {
            const isSelected = language.code === i18n.language;

            return (
              <MenuItem
                key={language.code}
                onClick={() => handleLanguageChange(language.code)}
                selected={isSelected}
                sx={{
                  py: 1.5,
                  px: 2.5,
                  backgroundColor: isSelected
                    ? (theme) => alpha(theme.palette.primary.main, 0.08)
                    : 'transparent',
                  '&:hover': {
                    backgroundColor: (theme) =>
                      alpha(theme.palette.primary.main, isSelected ? 0.12 : 0.04),
                  },
                }}
              >
                <ListItemIcon sx={{ minWidth: 40 }}>
                  {isSelected ? (
                    <CheckIcon color="primary" fontSize="small" />
                  ) : (
                    <span style={{ fontSize: '1.4em', width: 24, textAlign: 'center' }}>
                      {language.flag}
                    </span>
                  )}
                </ListItemIcon>

                <ListItemText
                  primary={
                    <Box display="flex" alignItems="center" gap={1}>
                      <Typography
                        variant="body2"
                        fontWeight={isSelected ? 600 : 500}
                        color={isSelected ? 'primary' : 'text.primary'}
                      >
                        {language.nativeName}
                      </Typography>

                      {/* RTL Badge */}
                      {language.rtl && (
                        <Chip
                          label="RTL"
                          size="small"
                          sx={{
                            height: 18,
                            fontSize: '0.65rem',
                            fontWeight: 600,
                          }}
                          color="info"
                        />
                      )}

                      {/* Quality Badge */}
                      {showQualityBadge && language.quality === 'tier1' && (
                        <StarIcon
                          sx={{
                            fontSize: 16,
                            color: 'gold',
                          }}
                        />
                      )}
                    </Box>
                  }
                  secondary={
                    <Box display="flex" alignItems="center" gap={0.5} mt={0.25}>
                      <Typography variant="caption" color="text.secondary">
                        {language.name}
                      </Typography>
                      {showQualityBadge && (
                        <>
                          <Typography variant="caption" color="text.secondary">
                            •
                          </Typography>
                          <Typography
                            variant="caption"
                            color={`${getQualityColor(language.quality)}.main`}
                            sx={{ fontWeight: 500 }}
                          >
                            {getQualityLabel(language.quality)}
                          </Typography>
                        </>
                      )}
                    </Box>
                  }
                  secondaryTypographyProps={{
                    component: 'div',
                  }}
                />
              </MenuItem>
            );
          })}
        </Box>

        <Divider />

        {/* Footer */}
        <Box sx={{ px: 2.5, py: 1.5 }}>
          <Typography variant="caption" color="text.secondary" align="center" display="block">
            {t('languages.poweredBy', 'Powered by mBART + Adapter Fusion')}
          </Typography>
        </Box>
      </Menu>
    </>
  );
};

export default LanguageSwitcher;

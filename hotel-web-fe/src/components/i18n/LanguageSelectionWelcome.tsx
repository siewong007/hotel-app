/**
 * Language Selection Welcome Screen
 * Shown to users on their first visit to select their preferred language
 */

import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  Box,
  Typography,
  Grid,
  Card,
  CardActionArea,
  CardContent,
  alpha,
  Fade,
  Slide,
  CircularProgress,
  Chip,
  Stack,
  Container,
} from '@mui/material';
import {
  Language as LanguageIcon,
  Check as CheckIcon,
  Star as StarIcon,
  TrendingUp as TrendingUpIcon,
  Public as PublicIcon,
} from '@mui/icons-material';
import { SUPPORTED_LANGUAGES, getLanguageByCode, type Language } from '../../i18n/config';
import { languageStorage, type LanguagePreference } from '../../utils/languageStorage';

interface LanguageSelectionWelcomeProps {
  open: boolean;
  onLanguageSelected: (languageCode: string) => void;
  autoDetect?: boolean;
}

export const LanguageSelectionWelcome: React.FC<LanguageSelectionWelcomeProps> = ({
  open,
  onLanguageSelected,
  autoDetect = true,
}) => {
  const { i18n } = useTranslation();
  const [selectedLanguage, setSelectedLanguage] = useState<string | null>(null);
  const [isChanging, setIsChanging] = useState(false);
  const [detectedLanguage, setDetectedLanguage] = useState<string | null>(null);
  const [showContent, setShowContent] = useState(false);

  useEffect(() => {
    if (open) {
      // Delay content appearance for smooth animation
      const timer = setTimeout(() => setShowContent(true), 300);

      // Auto-detect browser language
      if (autoDetect) {
        const detected = languageStorage.detectBrowserLanguage();
        const supportedLang = SUPPORTED_LANGUAGES.find(l => l.code === detected);
        if (supportedLang) {
          setDetectedLanguage(detected);
          setSelectedLanguage(detected);
        }
      }

      return () => clearTimeout(timer);
    } else {
      setShowContent(false);
    }
  }, [open, autoDetect]);

  const handleLanguageSelect = async (languageCode: string) => {
    setSelectedLanguage(languageCode);
    setIsChanging(true);

    try {
      // Change i18n language
      await i18n.changeLanguage(languageCode);

      // Get language details
      const language = getLanguageByCode(languageCode);

      // Save to localStorage
      if (language) {
        const preference: LanguagePreference = {
          code: languageCode,
          name: language.name,
          nativeName: language.nativeName,
          selectedAt: new Date().toISOString(),
          isFirstVisit: true,
        };

        languageStorage.saveLanguagePreference(preference);
        languageStorage.markFirstVisitComplete();
      }

      // Notify parent with delay for animation
      setTimeout(() => {
        onLanguageSelected(languageCode);
        setIsChanging(false);
      }, 800);
    } catch (error) {
      console.error('Failed to change language:', error);
      setIsChanging(false);
    }
  };

  const getPopularLanguages = (): Language[] => {
    // Show popular languages first
    const popularCodes = ['en', 'es', 'fr', 'de', 'zh', 'ja'];
    return SUPPORTED_LANGUAGES.filter(lang => popularCodes.includes(lang.code));
  };

  const getOtherLanguages = (): Language[] => {
    const popularCodes = ['en', 'es', 'fr', 'de', 'zh', 'ja'];
    return SUPPORTED_LANGUAGES.filter(lang => !popularCodes.includes(lang.code));
  };

  const renderLanguageCard = (language: Language, isPopular: boolean = false) => {
    const isSelected = selectedLanguage === language.code;
    const isDetected = detectedLanguage === language.code;

    return (
      <Grid item xs={6} sm={4} md={3} key={language.code}>
        <Card
          elevation={isSelected ? 8 : 1}
          sx={{
            height: '100%',
            position: 'relative',
            transition: 'all 0.3s ease',
            border: isSelected ? '3px solid' : '1px solid',
            borderColor: isSelected ? 'primary.main' : 'divider',
            transform: isSelected ? 'scale(1.05)' : 'scale(1)',
            '&:hover': {
              transform: 'scale(1.03)',
              boxShadow: 4,
            },
          }}
        >
          <CardActionArea
            onClick={() => handleLanguageSelect(language.code)}
            disabled={isChanging}
            sx={{ height: '100%', p: 2 }}
          >
            <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
              {/* Badges */}
              <Box
                display="flex"
                justifyContent="space-between"
                alignItems="flex-start"
                mb={1.5}
              >
                <Box display="flex" gap={0.5} flexWrap="wrap">
                  {isDetected && (
                    <Chip
                      icon={<PublicIcon sx={{ fontSize: 14 }} />}
                      label="Detected"
                      size="small"
                      color="info"
                      sx={{ height: 20, fontSize: '0.65rem' }}
                    />
                  )}
                  {isPopular && (
                    <Chip
                      icon={<TrendingUpIcon sx={{ fontSize: 14 }} />}
                      label="Popular"
                      size="small"
                      color="secondary"
                      sx={{ height: 20, fontSize: '0.65rem' }}
                    />
                  )}
                  {language.quality === 'tier1' && (
                    <Chip
                      icon={<StarIcon sx={{ fontSize: 14 }} />}
                      label="Best"
                      size="small"
                      color="warning"
                      sx={{ height: 20, fontSize: '0.65rem' }}
                    />
                  )}
                </Box>

                {isSelected && (
                  <CheckIcon
                    color="primary"
                    sx={{
                      fontSize: 24,
                      animation: 'pulse 0.5s ease-in-out',
                      '@keyframes pulse': {
                        '0%, 100%': { transform: 'scale(1)' },
                        '50%': { transform: 'scale(1.2)' },
                      },
                    }}
                  />
                )}
              </Box>

              {/* Flag */}
              <Box
                sx={{
                  fontSize: '3rem',
                  textAlign: 'center',
                  mb: 1.5,
                  filter: isSelected ? 'none' : 'grayscale(0.3)',
                  transition: 'filter 0.3s',
                }}
              >
                {language.flag}
              </Box>

              {/* Language Name */}
              <Typography
                variant="h6"
                align="center"
                fontWeight={isSelected ? 700 : 600}
                color={isSelected ? 'primary' : 'text.primary'}
                sx={{ mb: 0.5, fontSize: '1rem' }}
              >
                {language.nativeName}
              </Typography>

              {/* English Name */}
              <Typography
                variant="caption"
                align="center"
                color="text.secondary"
                display="block"
              >
                {language.name}
              </Typography>

              {/* RTL Badge */}
              {language.rtl && (
                <Box display="flex" justifyContent="center" mt={1}>
                  <Chip
                    label="RTL"
                    size="small"
                    variant="outlined"
                    sx={{ height: 18, fontSize: '0.65rem' }}
                  />
                </Box>
              )}
            </CardContent>
          </CardActionArea>

          {/* Loading Overlay */}
          {isChanging && isSelected && (
            <Box
              sx={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: alpha('#fff', 0.9),
                zIndex: 1,
              }}
            >
              <CircularProgress size={32} />
            </Box>
          )}
        </Card>
      </Grid>
    );
  };

  return (
    <Dialog
      open={open}
      maxWidth="lg"
      fullWidth
      disableEscapeKeyDown
      PaperProps={{
        sx: {
          borderRadius: 3,
          maxHeight: '90vh',
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        },
      }}
    >
      <Slide direction="down" in={open} timeout={500}>
        <DialogContent sx={{ p: 0 }}>
          <Container maxWidth="lg" sx={{ py: 6 }}>
            {/* Header */}
            <Fade in={showContent} timeout={800}>
              <Box textAlign="center" mb={6}>
                <Box
                  sx={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 80,
                    height: 80,
                    borderRadius: '50%',
                    bgcolor: alpha('#fff', 0.2),
                    mb: 3,
                  }}
                >
                  <LanguageIcon sx={{ fontSize: 48, color: 'white' }} />
                </Box>

                <Typography
                  variant="h3"
                  fontWeight={700}
                  color="white"
                  gutterBottom
                  sx={{
                    textShadow: '0 2px 10px rgba(0,0,0,0.2)',
                  }}
                >
                  Welcome! 🌍
                </Typography>

                <Typography
                  variant="h6"
                  color="white"
                  sx={{
                    maxWidth: 600,
                    mx: 'auto',
                    opacity: 0.95,
                    fontWeight: 400,
                  }}
                >
                  Choose your preferred language to get started
                </Typography>

                {detectedLanguage && (
                  <Chip
                    icon={<PublicIcon />}
                    label={`We detected ${getLanguageByCode(detectedLanguage)?.name || 'your language'}`}
                    sx={{
                      mt: 2,
                      bgcolor: alpha('#fff', 0.2),
                      color: 'white',
                      fontWeight: 500,
                      backdropFilter: 'blur(10px)',
                    }}
                  />
                )}
              </Box>
            </Fade>

            {/* Language Selection */}
            <Fade in={showContent} timeout={1000}>
              <Box
                sx={{
                  bgcolor: 'white',
                  borderRadius: 3,
                  p: 4,
                  boxShadow: '0 10px 40px rgba(0,0,0,0.1)',
                }}
              >
                {/* Popular Languages */}
                <Box mb={4}>
                  <Stack direction="row" alignItems="center" spacing={1} mb={2}>
                    <TrendingUpIcon color="primary" />
                    <Typography variant="h6" fontWeight={600}>
                      Popular Languages
                    </Typography>
                  </Stack>

                  <Grid container spacing={2}>
                    {getPopularLanguages().map((lang) => renderLanguageCard(lang, true))}
                  </Grid>
                </Box>

                {/* Other Languages */}
                <Box>
                  <Stack direction="row" alignItems="center" spacing={1} mb={2}>
                    <PublicIcon color="action" />
                    <Typography variant="h6" fontWeight={600} color="text.secondary">
                      More Languages
                    </Typography>
                  </Stack>

                  <Grid container spacing={2}>
                    {getOtherLanguages().map((lang) => renderLanguageCard(lang, false))}
                  </Grid>
                </Box>

                {/* Footer */}
                <Box mt={4} pt={3} borderTop={1} borderColor="divider">
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    align="center"
                    display="block"
                  >
                    You can change your language preference anytime from the settings menu
                  </Typography>
                </Box>
              </Box>
            </Fade>
          </Container>
        </DialogContent>
      </Slide>
    </Dialog>
  );
};

export default LanguageSelectionWelcome;

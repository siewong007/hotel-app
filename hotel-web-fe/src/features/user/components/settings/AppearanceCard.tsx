import React from "react";
import {
  Box,
  Card,
  CardContent,
  Divider,
  Slider,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  Palette as PaletteIcon,
  LightMode as LightModeIcon,
  DarkMode as DarkModeIcon,
} from "@mui/icons-material";

import type { ThemeMode } from "../../../../theme";
import {
  DEFAULT_GLASS_BLUR_PX,
  MAX_GLASS_BLUR_PX,
  MIN_GLASS_BLUR_PX,
} from "../../../../theme/glassBlur";
import { useTranslation } from "../../../../i18n";

interface AppearanceCardProps {
  themeMode: ThemeMode;
  onThemeModeChange: (mode: ThemeMode) => void;
  glassBlur: number;
  onGlassBlurChange: (px: number) => void;
}

/**
 * "Appearance" card of SettingsPage (light/dark theme-mode toggle + backdrop
 * blur). Both are local device preferences, not system settings — the values
 * come from the page's theme/blur contexts rather than the hotel settings
 * form.
 */
export function AppearanceCard({
  themeMode,
  onThemeModeChange,
  glassBlur,
  onGlassBlurChange,
}: AppearanceCardProps) {
  const { t } = useTranslation('admin');

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
          <PaletteIcon sx={{ mr: 1, color: "primary.main" }} />
          <Typography variant="h6" component="h2">{t('settings.tabs.appearance')}</Typography>
        </Box>
        <Divider sx={{ mb: 3 }} />

        <Typography variant="subtitle1" component="h3" gutterBottom sx={{
          fontWeight: "medium"
        }}>
          {t('settings.themeMode')}
        </Typography>
        <Typography variant="body2" gutterBottom sx={{
          color: "text.secondary"
        }}>
          {t('settings.themeModeHint')}
        </Typography>

        <ToggleButtonGroup
          exclusive
          value={themeMode}
          onChange={(_, value: ThemeMode | null) => {
            if (value === "light" || value === "dark")
              onThemeModeChange(value);
          }}
          sx={{ mt: 2 }}
        >
          <ToggleButton value="light" aria-label={t('settings.theme.lightMode')}>
            <Tooltip title={t('settings.theme.lightMode')}>
              <LightModeIcon fontSize="small" />
            </Tooltip>
            <Box component="span" sx={{ ml: 1 }}>
              {t('settings.theme.light')}
            </Box>
          </ToggleButton>
          <ToggleButton value="dark" aria-label={t('settings.theme.darkMode')}>
            <Tooltip title={t('settings.theme.darkMode')}>
              <DarkModeIcon fontSize="small" />
            </Tooltip>
            <Box component="span" sx={{ ml: 1 }}>
              {t('settings.theme.dark')}
            </Box>
          </ToggleButton>
        </ToggleButtonGroup>

        <Typography variant="subtitle1" component="h3" gutterBottom sx={{
          fontWeight: "medium",
          mt: 4
        }}>
          {t('settings.glassBlur')}
        </Typography>
        <Typography variant="body2" gutterBottom sx={{
          color: "text.secondary"
        }}>
          {t('settings.glassBlurHint')}
        </Typography>

        <Box sx={{ px: 1, mt: 1 }}>
          <Slider
            value={glassBlur}
            onChange={(_, value) => onGlassBlurChange(value as number)}
            min={MIN_GLASS_BLUR_PX}
            max={MAX_GLASS_BLUR_PX}
            step={1}
            marks={[
              { value: MIN_GLASS_BLUR_PX, label: '0' },
              { value: DEFAULT_GLASS_BLUR_PX, label: `${DEFAULT_GLASS_BLUR_PX}px` },
              { value: MAX_GLASS_BLUR_PX, label: `${MAX_GLASS_BLUR_PX}px` },
            ]}
            valueLabelDisplay="auto"
            valueLabelFormat={(value) => `${value}px`}
            aria-label={t('settings.glassBlur')}
          />
        </Box>
      </CardContent>
    </Card>
  );
}

export default AppearanceCard;

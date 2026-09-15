import {
  Card,
  CardContent,
  FormControlLabel,
  Radio,
  RadioGroup,
  Typography,
} from '@mui/material';
import { useGuestThemePreference } from '../../theme/guestThemePreference';
import type { GuestThemePreference } from '../../theme/guestTokens';
import { useTranslation } from '../../../../i18n';

/**
 * Appearance preference (System / Light / Dark) for the guest portal.
 * Renders nothing without GuestThemePreferenceContext — staff-document compat
 * renders and bare tests simply skip it.
 */
export function AppearancePreferenceCard() {
  const themePreference = useGuestThemePreference();
  const { t } = useTranslation('guestPortal');
  if (!themePreference) return null;
  const { preference, onPreferenceChange } = themePreference;

  return (
    <Card variant="outlined" sx={{ borderColor: 'var(--hotel-border)', borderRadius: 3, mb: 3 }}>
      <CardContent sx={{ p: { xs: 2, sm: 3 }, '&:last-child': { pb: { xs: 2, sm: 3 } } }}>
        <Typography variant="h6" sx={{ color: 'var(--hotel-text)', fontWeight: 700 }}>
          {t('preferences.appearance')}
        </Typography>
        <Typography
          variant="body2"
          sx={{ color: 'text.secondary', mt: 0.5, mb: 2 }}
        >
          {t('preferences.appearanceHint')}
        </Typography>
        <RadioGroup
          row
          aria-label={t('preferences.appearance')}
          value={preference}
          onChange={(event) =>
            onPreferenceChange(event.target.value as GuestThemePreference)
          }
        >
          <FormControlLabel
            value="system"
            control={<Radio />}
            label={t('preferences.themeSystem')}
          />
          <FormControlLabel
            value="light"
            control={<Radio />}
            label={t('preferences.themeLight')}
          />
          <FormControlLabel
            value="dark"
            control={<Radio />}
            label={t('preferences.themeDark')}
          />
        </RadioGroup>
      </CardContent>
    </Card>
  );
}

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
  const { tOr } = useTranslation('guestPortal');
  if (!themePreference) return null;
  const { preference, onPreferenceChange } = themePreference;

  return (
    <Card variant="outlined" sx={{ borderColor: 'var(--hotel-border)', borderRadius: 3, mb: 3 }}>
      <CardContent sx={{ p: { xs: 2, sm: 3 }, '&:last-child': { pb: { xs: 2, sm: 3 } } }}>
        <Typography variant="h6" sx={{ color: 'var(--hotel-text)', fontWeight: 700 }}>
          {tOr('preferences.appearance', 'Appearance')}
        </Typography>
        <Typography
          variant="body2"
          sx={{ color: 'text.secondary', mt: 0.5, mb: 2 }}
        >
          {tOr('preferences.appearanceHint', 'Choose how the portal looks on this device.')}
        </Typography>
        <RadioGroup
          row
          aria-label={tOr('preferences.appearance', 'Appearance')}
          value={preference}
          onChange={(event) =>
            onPreferenceChange(event.target.value as GuestThemePreference)
          }
        >
          <FormControlLabel
            value="system"
            control={<Radio />}
            label={tOr('preferences.themeSystem', 'System — follow browser')}
          />
          <FormControlLabel
            value="light"
            control={<Radio />}
            label={tOr('preferences.themeLight', 'Light')}
          />
          <FormControlLabel
            value="dark"
            control={<Radio />}
            label={tOr('preferences.themeDark', 'Dark')}
          />
        </RadioGroup>
      </CardContent>
    </Card>
  );
}

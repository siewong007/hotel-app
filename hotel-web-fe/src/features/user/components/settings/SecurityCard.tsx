import React from "react";
import {
  Box,
  Card,
  CardContent,
  Divider,
  Grid,
  TextField,
  Typography,
} from "@mui/material";
import { Security as SecurityIcon } from "@mui/icons-material";

import { useTranslation } from "../../../../i18n";

interface SecurityCardProps {
  isAdmin: boolean;
  maxLoginAttempts: number;
  onMaxLoginAttemptsChange: React.Dispatch<React.SetStateAction<number>>;
  totpIssuerName: string;
  onTotpIssuerNameChange: React.Dispatch<React.SetStateAction<string>>;
  passkeyRelyingPartyName: string;
  onPasskeyRelyingPartyNameChange: React.Dispatch<
    React.SetStateAction<string>
  >;
  /** Shown as the placeholder of the issuer / passkey name fields. */
  hotelName: string;
}

/**
 * "Security & Identity" card of SettingsPage (max login attempts, TOTP issuer
 * name, passkey relying-party display name). Pure display + input: all values
 * and their setters come from the page.
 */
export function SecurityCard({
  isAdmin,
  maxLoginAttempts,
  onMaxLoginAttemptsChange,
  totpIssuerName,
  onTotpIssuerNameChange,
  passkeyRelyingPartyName,
  onPasskeyRelyingPartyNameChange,
  hotelName,
}: SecurityCardProps) {
  const { t } = useTranslation('admin');

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
          <SecurityIcon sx={{ mr: 1, color: "primary.main" }} />
          <Typography variant="h6" component="h2">{t('settings.securityTitle')}</Typography>
        </Box>
        <Divider sx={{ mb: 3 }} />

        <Grid container spacing={3}>
          <Grid size={{ xs: 12, md: 4 }}>
            <TextField
              fullWidth
              label={t('settings.maxLoginAttempts')}
              type="number"
              value={maxLoginAttempts}
              onChange={(e) =>
                onMaxLoginAttemptsChange(parseInt(e.target.value, 10) || 1)
              }
              helperText={t('settings.maxLoginAttemptsHint')}
              disabled={!isAdmin}
              slotProps={{
                htmlInput: {
                  min: 1,
                  max: 20,
                  step: 1,
                }
              }}
            />
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <TextField
              fullWidth
              label={t('settings.totpIssuer')}
              value={totpIssuerName}
              onChange={(e) => onTotpIssuerNameChange(e.target.value)}
              placeholder={hotelName}
              helperText={t('settings.totpIssuerHint')}
              disabled={!isAdmin}
            />
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <TextField
              fullWidth
              label={t('settings.passkeyDisplayName')}
              value={passkeyRelyingPartyName}
              onChange={(e) => onPasskeyRelyingPartyNameChange(e.target.value)}
              placeholder={hotelName}
              helperText={t('settings.passkeyDisplayNameHint')}
              disabled={!isAdmin}
            />
          </Grid>
        </Grid>
      </CardContent>
    </Card>
  );
}

export default SecurityCard;

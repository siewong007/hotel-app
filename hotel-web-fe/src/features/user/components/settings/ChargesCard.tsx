import React from "react";
import {
  Alert,
  Box,
  Card,
  CardContent,
  Divider,
  Grid,
  TextField,
  Typography,
} from "@mui/material";
import { AttachMoney as MoneyIcon } from "@mui/icons-material";

import { useTranslation } from "../../../../i18n";

interface ChargesCardProps {
  /** Currency symbol shown as the money fields' start adornment. */
  currencySymbol: string;
  serviceTaxRate: number;
  onServiceTaxRateChange: React.Dispatch<React.SetStateAction<number>>;
  tourismTaxRate: number;
  onTourismTaxRateChange: React.Dispatch<React.SetStateAction<number>>;
  depositAmount: number;
  onDepositAmountChange: React.Dispatch<React.SetStateAction<number>>;
  unpaidHoldReleaseHours: number;
  onUnpaidHoldReleaseHoursChange: React.Dispatch<React.SetStateAction<number>>;
  defaultPaymentTermsDays: number;
  onDefaultPaymentTermsDaysChange: React.Dispatch<React.SetStateAction<number>>;
}

/**
 * "Charges & Deposits" card of SettingsPage (tax rates, deposit, unpaid-hold
 * release window, payment terms). Pure display + input: all values and their
 * setters come from the page. Unlike the other sections these fields are not
 * client-side admin-gated — the server enforces permissions.
 */
export function ChargesCard({
  currencySymbol,
  serviceTaxRate,
  onServiceTaxRateChange,
  tourismTaxRate,
  onTourismTaxRateChange,
  depositAmount,
  onDepositAmountChange,
  unpaidHoldReleaseHours,
  onUnpaidHoldReleaseHoursChange,
  defaultPaymentTermsDays,
  onDefaultPaymentTermsDaysChange,
}: ChargesCardProps) {
  const { t } = useTranslation('admin');

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
          <MoneyIcon sx={{ mr: 1, color: "primary.main" }} />
          <Typography variant="h6" component="h2">{t('settings.chargesTitle')}</Typography>
        </Box>
        <Divider sx={{ mb: 3 }} />

        <Grid container spacing={3}>
          <Grid size={{ xs: 12, md: 3 }}>
            <TextField
              fullWidth
              label={t('settings.serviceTaxRate')}
              type="number"
              value={serviceTaxRate}
              onChange={(e) =>
                onServiceTaxRateChange(parseFloat(e.target.value) || 0)
              }
              helperText={t('settings.serviceTaxHint')}
              slotProps={{
                input: {
                  endAdornment: <Typography sx={{ ml: 0.5 }}>%</Typography>,
                },

                htmlInput: {
                  min: 0,
                  max: 100,
                  step: 0.1,
                }
              }} />
          </Grid>
          <Grid size={{ xs: 12, md: 3 }}>
            <TextField
              fullWidth
              label={t('settings.tourismTaxRate')}
              type="number"
              value={tourismTaxRate}
              onChange={(e) =>
                onTourismTaxRateChange(parseFloat(e.target.value) || 0)
              }
              helperText={t('settings.tourismTaxHint')}
              slotProps={{
                input: {
                  startAdornment: (
                    <Typography sx={{ mr: 0.5 }}>{currencySymbol}</Typography>
                  ),
                },

                htmlInput: {
                  min: 0,
                  step: 1,
                }
              }} />
          </Grid>
          <Grid size={{ xs: 12, md: 3 }}>
            <TextField
              fullWidth
              label={t('settings.depositAmount')}
              type="number"
              value={depositAmount}
              onChange={(e) =>
                onDepositAmountChange(parseFloat(e.target.value) || 0)
              }
              helperText={t('settings.depositHint')}
              slotProps={{
                input: {
                  startAdornment: (
                    <Typography sx={{ mr: 0.5 }}>{currencySymbol}</Typography>
                  ),
                },

                htmlInput: {
                  min: 0,
                  step: 1,
                }
              }} />
          </Grid>
          <Grid size={{ xs: 12, md: 3 }}>
            <TextField
              fullWidth
              label={t('settings.unpaidHoldRelease')}
              type="number"
              value={unpaidHoldReleaseHours}
              onChange={(e) => {
                // 0 is meaningful here (off), so this must not fall back to a
                // truthy default the way the fields around it do.
                const parsed = parseInt(e.target.value, 10);
                onUnpaidHoldReleaseHoursChange(Number.isFinite(parsed) && parsed > 0 ? parsed : 0);
              }}
              helperText={
                unpaidHoldReleaseHours > 0
                  ? t('settings.unpaidHoldOn')
                  : t('settings.unpaidHoldOff')
              }
              slotProps={{
                input: {
                  endAdornment: <Typography sx={{ ml: 0.5 }}>{t('common:units.hours')}</Typography>,
                },

                htmlInput: {
                  min: 0,
                  step: 1,
                }
              }} />
          </Grid>
          <Grid size={{ xs: 12, md: 3 }}>
            <TextField
              fullWidth
              label={t('settings.paymentTerms')}
              type="number"
              value={defaultPaymentTermsDays}
              onChange={(e) =>
                onDefaultPaymentTermsDaysChange(parseInt(e.target.value, 10) || 1)
              }
              helperText={t('settings.paymentTermsHint')}
              slotProps={{
                input: {
                  endAdornment: <Typography sx={{ ml: 0.5 }}>{t('common:units.days')}</Typography>,
                },

                htmlInput: {
                  min: 1,
                  step: 1,
                }
              }} />
          </Grid>
        </Grid>

        <Alert severity="info" sx={{ mt: 2 }}>
          {t('settings.chargesNote')}
        </Alert>
      </CardContent>
    </Card>
  );
}

export default ChargesCard;

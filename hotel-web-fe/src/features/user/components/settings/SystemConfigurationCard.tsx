import React, { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Grid,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import SettingsIcon from "@mui/icons-material/Settings";

import type { BookingChannel } from "../../../../utils/hotelSettings";
import { useTranslation } from "../../../../i18n";
import { useNavigate } from "@tanstack/react-router";

interface SystemConfigurationCardProps {
  isAdmin: boolean;
  rateCodes: string[];
  onRateCodesChange: React.Dispatch<React.SetStateAction<string[]>>;
  marketCodes: string[];
  onMarketCodesChange: React.Dispatch<React.SetStateAction<string[]>>;
  bookingChannels: BookingChannel[];
  paymentMethods: string[];
  onPaymentMethodsChange: React.Dispatch<React.SetStateAction<string[]>>;
}

const addCode = (
  rawCode: string,
  values: string[],
  setValues: React.Dispatch<React.SetStateAction<string[]>>,
  reset: () => void,
) => {
  const code = rawCode.trim().toUpperCase();
  if (!code || values.includes(code)) return;
  setValues([...values, code]);
  reset();
};

/**
 * "System Configuration" card of SettingsPage (rate codes, market codes,
 * online booking channels, payment methods). The code lists are owned by the
 * page — they feed the save payload. Booking channels are managed on the
 * Channels page (the `booking_channels` table is the source of truth); the
 * legacy JSON list is only shown here read-only.
 */
export function SystemConfigurationCard({
  isAdmin,
  rateCodes,
  onRateCodesChange,
  marketCodes,
  onMarketCodesChange,
  bookingChannels,
  paymentMethods,
  onPaymentMethodsChange,
}: SystemConfigurationCardProps) {
  const { t } = useTranslation('admin');
  const navigate = useNavigate();
  const [newRateCode, setNewRateCode] = useState("");
  const [newMarketCode, setNewMarketCode] = useState("");
  const [newPaymentMethod, setNewPaymentMethod] = useState("");

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
          <SettingsIcon sx={{ mr: 1, color: "primary.main" }} />
          <Typography variant="h6">{t('settings.systemConfigTitle')}</Typography>
        </Box>
        <Divider sx={{ mb: 3 }} />

        <Grid container spacing={3}>
          {/* Rate Codes */}
          <Grid size={{ xs: 12, md: 6 }}>
            <Typography variant="subtitle1" gutterBottom sx={{
              fontWeight: "medium"
            }}>
              {t('settings.rateCodes')}
            </Typography>

            <Stack
              direction="row"
              spacing={1}
              sx={{
                flexWrap: "wrap",
                mt: 2,
                mb: 2
              }}>
              {rateCodes.map((code, index) => (
                <Chip
                  key={`${code}-${index}`}
                  label={code}
                  onDelete={
                    isAdmin
                      ? () =>
                          onRateCodesChange(
                            rateCodes.filter((_, i) => i !== index),
                          )
                      : undefined
                  }
                  sx={{ mb: 1 }}
                />
              ))}
            </Stack>

            <Box sx={{ display: "flex", gap: 1 }}>
              <TextField
                size="small"
                placeholder={t('settings.addRateCode')}
                value={newRateCode}
                onChange={(e) => setNewRateCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCode(newRateCode, rateCodes, onRateCodesChange, () =>
                      setNewRateCode(""),
                    );
                  }
                }}
                disabled={!isAdmin}
                sx={{ flex: 1 }}
              />
              <Button
                variant="outlined"
                startIcon={<AddIcon />}
                onClick={() =>
                  addCode(newRateCode, rateCodes, onRateCodesChange, () =>
                    setNewRateCode(""),
                  )
                }
                disabled={!isAdmin || !newRateCode.trim()}
              >
                {t('common:actions.add')}
              </Button>
            </Box>
          </Grid>

          {/* Market Codes */}
          <Grid size={{ xs: 12, md: 6 }}>
            <Typography variant="subtitle1" gutterBottom sx={{
              fontWeight: "medium"
            }}>
              {t('settings.marketCodes')}
            </Typography>

            <Stack
              direction="row"
              spacing={1}
              sx={{
                flexWrap: "wrap",
                mt: 2,
                mb: 2
              }}>
              {marketCodes.map((code, index) => (
                <Chip
                  key={`${code}-${index}`}
                  label={code}
                  onDelete={
                    isAdmin
                      ? () =>
                          onMarketCodesChange(
                            marketCodes.filter((_, i) => i !== index),
                          )
                      : undefined
                  }
                  sx={{ mb: 1 }}
                />
              ))}
            </Stack>

            <Box sx={{ display: "flex", gap: 1 }}>
              <TextField
                size="small"
                placeholder={t('settings.addMarketCode')}
                value={newMarketCode}
                onChange={(e) => setNewMarketCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCode(newMarketCode, marketCodes, onMarketCodesChange, () =>
                      setNewMarketCode(""),
                    );
                  }
                }}
                disabled={!isAdmin}
                sx={{ flex: 1 }}
              />
              <Button
                variant="outlined"
                startIcon={<AddIcon />}
                onClick={() =>
                  addCode(newMarketCode, marketCodes, onMarketCodesChange, () =>
                    setNewMarketCode(""),
                  )
                }
                disabled={!isAdmin || !newMarketCode.trim()}
              >
                {t('common:actions.add')}
              </Button>
            </Box>
          </Grid>

          {/* Booking Channels — read-only mirror of the booking_channels
              table; managed on the Channels page. */}
          <Grid size={12}>
            <Typography variant="subtitle1" gutterBottom sx={{
              fontWeight: "medium"
            }}>
              {t('settings.bookingChannels')}
            </Typography>
            <Typography variant="body2" gutterBottom sx={{
              color: "text.secondary"
            }}>
              {t('settings.bookingChannelsManagedHint')}
            </Typography>

            <Stack
              direction="row"
              spacing={1}
              sx={{
                flexWrap: "wrap",
                mt: 2,
                mb: 2
              }}>
              {bookingChannels.map((channel, index) => (
                <Chip
                  key={index}
                  label={
                    channel.abbreviation
                      ? `${channel.name} (${channel.abbreviation})`
                      : channel.name
                  }
                  sx={{ mb: 1 }}
                />
              ))}
            </Stack>

            <Button
              variant="outlined"
              onClick={() => navigate({ to: "/channels" })}
            >
              {t('settings.manageBookingChannels')}
            </Button>
          </Grid>

          {/* Payment Methods */}
          <Grid size={12}>
            <Typography variant="subtitle1" gutterBottom sx={{
              fontWeight: "medium"
            }}>
              {t('settings.paymentMethods')}
            </Typography>
            <Typography variant="body2" gutterBottom sx={{
              color: "text.secondary"
            }}>
              {t('settings.paymentMethodsHint')}
            </Typography>

            <Stack
              direction="row"
              spacing={1}
              sx={{
                flexWrap: "wrap",
                mt: 2,
                mb: 2
              }}>
              {paymentMethods.map((method, index) => (
                <Chip
                  key={index}
                  label={method}
                  onDelete={() => {
                    onPaymentMethodsChange(
                      paymentMethods.filter((_, i) => i !== index),
                    );
                  }}
                  sx={{ mb: 1 }}
                />
              ))}
            </Stack>

            <Box sx={{ display: "flex", gap: 1 }}>
              <TextField
                size="small"
                placeholder={t('settings.addPaymentMethod')}
                value={newPaymentMethod}
                onChange={(e) => setNewPaymentMethod(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === "Enter" && newPaymentMethod.trim()) {
                    onPaymentMethodsChange([
                      ...paymentMethods,
                      newPaymentMethod.trim(),
                    ]);
                    setNewPaymentMethod("");
                  }
                }}
                sx={{ flex: 1 }}
              />
              <Button
                variant="outlined"
                startIcon={<AddIcon />}
                onClick={() => {
                  if (newPaymentMethod.trim()) {
                    onPaymentMethodsChange([
                      ...paymentMethods,
                      newPaymentMethod.trim(),
                    ]);
                    setNewPaymentMethod("");
                  }
                }}
                disabled={!newPaymentMethod.trim()}
              >
                {t('common:actions.add')}
              </Button>
            </Box>
          </Grid>
        </Grid>

        <Alert severity="info" sx={{ mt: 2 }}>
          {t('settings.systemConfigNote')}
        </Alert>
      </CardContent>
    </Card>
  );
}

export default SystemConfigurationCard;

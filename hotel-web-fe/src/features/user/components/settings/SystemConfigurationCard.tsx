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

interface SystemConfigurationCardProps {
  isAdmin: boolean;
  rateCodes: string[];
  onRateCodesChange: React.Dispatch<React.SetStateAction<string[]>>;
  marketCodes: string[];
  onMarketCodesChange: React.Dispatch<React.SetStateAction<string[]>>;
  bookingChannels: BookingChannel[];
  onBookingChannelsChange: React.Dispatch<React.SetStateAction<BookingChannel[]>>;
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
 * online booking channels, payment methods). The four code lists are owned by
 * the page — they feed the save payload — while the add-form input state is
 * local to this card.
 */
export function SystemConfigurationCard({
  isAdmin,
  rateCodes,
  onRateCodesChange,
  marketCodes,
  onMarketCodesChange,
  bookingChannels,
  onBookingChannelsChange,
  paymentMethods,
  onPaymentMethodsChange,
}: SystemConfigurationCardProps) {
  const [newRateCode, setNewRateCode] = useState("");
  const [newMarketCode, setNewMarketCode] = useState("");
  const [newChannelName, setNewChannelName] = useState("");
  const [newChannelAbbreviation, setNewChannelAbbreviation] = useState("");
  const [newPaymentMethod, setNewPaymentMethod] = useState("");

  const addBookingChannel = () => {
    const name = newChannelName.trim();
    const abbreviation = newChannelAbbreviation.trim();
    if (!name) return;
    onBookingChannelsChange([...bookingChannels, { name, abbreviation }]);
    setNewChannelName("");
    setNewChannelAbbreviation("");
  };

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
          <SettingsIcon sx={{ mr: 1, color: "primary.main" }} />
          <Typography variant="h6">System Configuration</Typography>
        </Box>
        <Divider sx={{ mb: 3 }} />

        <Grid container spacing={3}>
          {/* Rate Codes */}
          <Grid size={{ xs: 12, md: 6 }}>
            <Typography variant="subtitle1" gutterBottom sx={{
              fontWeight: "medium"
            }}>
              Rate Codes
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
                placeholder="Add rate code"
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
                Add
              </Button>
            </Box>
          </Grid>

          {/* Market Codes */}
          <Grid size={{ xs: 12, md: 6 }}>
            <Typography variant="subtitle1" gutterBottom sx={{
              fontWeight: "medium"
            }}>
              Market Codes
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
                placeholder="Add market code"
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
                Add
              </Button>
            </Box>
          </Grid>

          {/* Booking Channels */}
          <Grid size={12}>
            <Typography variant="subtitle1" gutterBottom sx={{
              fontWeight: "medium"
            }}>
              Online Booking Channels
            </Typography>
            <Typography variant="body2" gutterBottom sx={{
              color: "text.secondary"
            }}>
              Configure channel name + abbreviation pairs (e.g., Booking.com /
              B.C). Abbreviations appear next to guest names in the Room Sold
              Detail by Date report.
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
                  onDelete={() => {
                    onBookingChannelsChange(
                      bookingChannels.filter((_, i) => i !== index),
                    );
                  }}
                  sx={{ mb: 1 }}
                />
              ))}
            </Stack>

            <Box sx={{ display: "flex", gap: 1 }}>
              <TextField
                size="small"
                placeholder="Channel name (e.g., Booking.com)"
                value={newChannelName}
                onChange={(e) => setNewChannelName(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addBookingChannel();
                  }
                }}
                sx={{ flex: 2 }}
              />
              <TextField
                size="small"
                placeholder="Abbr. (e.g., B.C)"
                value={newChannelAbbreviation}
                onChange={(e) => setNewChannelAbbreviation(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addBookingChannel();
                  }
                }}
                sx={{ flex: 1 }}
              />
              <Button
                variant="outlined"
                startIcon={<AddIcon />}
                onClick={addBookingChannel}
                disabled={!newChannelName.trim()}
              >
                Add
              </Button>
            </Box>
          </Grid>

          {/* Payment Methods */}
          <Grid size={12}>
            <Typography variant="subtitle1" gutterBottom sx={{
              fontWeight: "medium"
            }}>
              Payment Methods
            </Typography>
            <Typography variant="body2" gutterBottom sx={{
              color: "text.secondary"
            }}>
              Configure available payment methods for walk-in guests
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
                placeholder="Add new payment method (e.g., E-Wallet)"
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
                Add
              </Button>
            </Box>
          </Grid>
        </Grid>

        <Alert severity="info" sx={{ mt: 2 }}>
          These options will appear in the booking channels dropdown (online
          check-in) and payment methods dropdown (walk-in guests).
        </Alert>
      </CardContent>
    </Card>
  );
}

export default SystemConfigurationCard;

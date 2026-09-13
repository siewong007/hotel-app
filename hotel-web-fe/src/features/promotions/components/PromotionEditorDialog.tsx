import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  Grid,
  InputLabel,
  ListItemText,
  MenuItem,
  Select,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";
import { useAllRoomTypes } from "../../rooms/hooks";
import { formatLocalDate } from "../../../utils/date";
import {
  CAMPAIGN_OBJECTIVE_OPTIONS,
  DISCOUNT_TYPE_OPTIONS,
  EMPTY_PROMOTION_INPUT,
  PROMOTION_KIND_OPTIONS,
} from "../constants";
import { useTargetingOptions } from "../hooks/usePromotionAdmin";
import type { Promotion, PromotionInput } from "../types";
import { discountValueLabel, slugifyPromotionName } from "../utils";

interface PromotionEditorDialogProps {
  open: boolean;
  promotion?: Promotion | null;
  isSaving: boolean;
  onClose: () => void;
  onSave: (input: PromotionInput) => void;
}

interface EditorState {
  slug: string;
  name: string;
  description: string;
  terms: string;
  promotionKind: PromotionInput["promotion_kind"];
  discountType: PromotionInput["discount_type"];
  discountValue: string;
  maxDiscountAmount: string;
  currency: string;
  claimStartsAt: string;
  claimEndsAt: string;
  stayStartsOn: string;
  stayEndsOn: string;
  minNights: string;
  maxNights: string;
  minSubtotal: string;
  claimLimit: string;
  perGuestLimit: string;
  isPublic: boolean;
  isCancellable: boolean;
  roomTypeId: string;
  internalCode: string;
  objective: string;
  bookingChannelIds: string[];
  loyaltyTierIds: string[];
}

function toLocalDateTime(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 16);
  const time = [date.getHours(), date.getMinutes()]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
  return `${formatLocalDate(date)}T${time}`;
}

function toIsoDateTime(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function nullableNumber(value: string): number | null {
  if (!value.trim()) return null;
  return Number(value);
}

function FormSection({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <Grid size={{ xs: 12 }}>
      <Box sx={{ pt: 1 }}>
        <Typography variant="subtitle1" sx={{
          fontWeight: 700
        }}>
          {title}
        </Typography>
        <Typography variant="body2" sx={{
          color: "text.secondary"
        }}>
          {description}
        </Typography>
        <Divider sx={{ mt: 1.25 }} />
      </Box>
    </Grid>
  );
}

function initialEditorState(promotion?: Promotion | null): EditorState {
  const input = promotion ?? EMPTY_PROMOTION_INPUT;
  return {
    slug: input.slug,
    name: input.name,
    description: input.description ?? "",
    terms: input.terms ?? "",
    promotionKind: input.promotion_kind,
    discountType: input.discount_type,
    discountValue: String(input.discount_value),
    maxDiscountAmount:
      input.max_discount_amount === null ||
      input.max_discount_amount === undefined
        ? ""
        : String(input.max_discount_amount),
    currency: input.currency,
    claimStartsAt: toLocalDateTime(input.claim_starts_at),
    claimEndsAt: toLocalDateTime(input.claim_ends_at),
    stayStartsOn: input.stay_starts_on?.slice(0, 10) ?? "",
    stayEndsOn: input.stay_ends_on?.slice(0, 10) ?? "",
    minNights: input.min_nights == null ? "" : String(input.min_nights),
    maxNights: input.max_nights == null ? "" : String(input.max_nights),
    minSubtotal: input.min_subtotal == null ? "" : String(input.min_subtotal),
    claimLimit: input.claim_limit == null ? "" : String(input.claim_limit),
    perGuestLimit: String(input.per_guest_limit),
    isPublic: input.is_public,
    isCancellable: input.is_cancellable ?? true,
    roomTypeId: input.room_type_ids[0]?.toString() ?? "",
    internalCode: input.internal_code ?? "",
    objective: input.objective ?? "",
    bookingChannelIds: (input.booking_channel_ids ?? []).map(String),
    loyaltyTierIds: (input.loyalty_tier_ids ?? []).map(String),
  };
}

export function PromotionEditorDialog({
  open,
  promotion,
  isSaving,
  onClose,
  onSave,
}: PromotionEditorDialogProps) {
  const [form, setForm] = useState<EditorState>(() =>
    initialEditorState(promotion),
  );
  const [validationError, setValidationError] = useState<string | null>(null);
  const roomTypesQuery = useAllRoomTypes(open);
  const targetingQuery = useTargetingOptions(open);

  useEffect(() => {
    if (open) {
      setForm(initialEditorState(promotion));
      setValidationError(null);
    }
  }, [open, promotion]);

  const handleNameChange = (name: string) => {
    setForm((current) => ({
      ...current,
      name,
      slug:
        current.slug === "" ||
        current.slug === slugifyPromotionName(current.name)
          ? slugifyPromotionName(name)
          : current.slug,
    }));
  };

  const handleSave = () => {
    const discountValue = Number(form.discountValue);
    const perGuestLimit = Number(form.perGuestLimit);
    if (!form.name.trim() || !form.slug.trim()) {
      setValidationError("Name and offer code are required.");
      return;
    }
    if (!Number.isFinite(discountValue) || discountValue <= 0) {
      setValidationError("Discount value must be greater than zero.");
      return;
    }
    if (!Number.isInteger(perGuestLimit) || perGuestLimit < 1) {
      setValidationError("Per-guest limit must be at least one.");
      return;
    }

    const roomTypeId = Number(form.roomTypeId);
    const toIds = (values: string[]) =>
      values.map(Number).filter((value) => Number.isInteger(value) && value > 0);

    onSave({
      slug: form.slug.trim(),
      name: form.name.trim(),
      description: form.description.trim() || null,
      terms: form.terms.trim() || null,
      promotion_kind: form.promotionKind,
      discount_type: form.discountType,
      discount_value: discountValue,
      max_discount_amount: nullableNumber(form.maxDiscountAmount),
      currency: form.currency.trim().toUpperCase() || "USD",
      claim_starts_at: toIsoDateTime(form.claimStartsAt),
      claim_ends_at: toIsoDateTime(form.claimEndsAt),
      stay_starts_on: form.stayStartsOn || null,
      stay_ends_on: form.stayEndsOn || null,
      min_nights: nullableNumber(form.minNights),
      max_nights: nullableNumber(form.maxNights),
      min_subtotal: nullableNumber(form.minSubtotal),
      claim_limit: nullableNumber(form.claimLimit),
      per_guest_limit: perGuestLimit,
      is_public: form.isPublic,
      is_cancellable: form.isCancellable,
      room_type_ids:
        Number.isInteger(roomTypeId) && roomTypeId > 0 ? [roomTypeId] : [],
      internal_code: form.internalCode.trim() || null,
      objective: (form.objective || null) as PromotionInput["objective"],
      booking_channel_ids: toIds(form.bookingChannelIds),
      loyalty_tier_ids: toIds(form.loyaltyTierIds),
      expected_version: promotion?.version,
    });
  };

  return (
    <Dialog
      open={open}
      onClose={isSaving ? undefined : onClose}
      maxWidth="md"
      fullWidth
    >
      <DialogTitle sx={{ pb: 1.5 }}>
        <Typography variant="h6" sx={{
          fontWeight: 750
        }}>
          {promotion ? "Edit promotion" : "Create promotion"}
        </Typography>
        <Typography variant="body2" sx={{
          color: "text.secondary"
        }}>
          {promotion
            ? "Update the offer details and save your changes. Publishing is managed from the promotion list."
            : "Set up the offer details now, then publish the draft when it is ready for guests."}
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        <Grid container spacing={2} sx={{ pt: 0.5 }}>
          <FormSection
            title="Offer basics"
            description="Give staff and guests a clear name, code, and description."
          />
          <Grid size={{ xs: 12, sm: 7 }}>
            <TextField
              label="Promotion name"
              value={form.name}
              onChange={(event) => handleNameChange(event.target.value)}
              required
              fullWidth
              autoFocus
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 5 }}>
            <TextField
              label="Offer code"
              helperText="A short URL-safe identifier"
              value={form.slug}
              onChange={(event) =>
                setForm({ ...form, slug: event.target.value })
              }
              required
              fullWidth
            />
          </Grid>
          <Grid size={{ xs: 12 }}>
            <TextField
              label="Description"
              value={form.description}
              onChange={(event) =>
                setForm({ ...form, description: event.target.value })
              }
              multiline
              minRows={2}
              fullWidth
            />
          </Grid>
          <FormSection
            title="Discount"
            description="Choose how the offer is applied and the value guests receive."
          />
          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth>
              <InputLabel id="promotion-kind-label">Offer type</InputLabel>
              <Select
                labelId="promotion-kind-label"
                label="Offer type"
                value={form.promotionKind}
                onChange={(event) =>
                  setForm({
                    ...form,
                    promotionKind: event.target
                      .value as EditorState["promotionKind"],
                  })
                }
              >
                {PROMOTION_KIND_OPTIONS.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth>
              <InputLabel id="discount-type-label">Discount type</InputLabel>
              <Select
                labelId="discount-type-label"
                label="Discount type"
                value={form.discountType}
                onChange={(event) =>
                  setForm({
                    ...form,
                    discountType: event.target
                      .value as EditorState["discountType"],
                  })
                }
              >
                {DISCOUNT_TYPE_OPTIONS.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <TextField
              label={discountValueLabel(form.discountType)}
              type="number"
              value={form.discountValue}
              onChange={(event) =>
                setForm({ ...form, discountValue: event.target.value })
              }
              slotProps={{ htmlInput: { min: 0, step: 0.01 } }}
              required
              fullWidth
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <TextField
              label="Maximum discount"
              type="number"
              value={form.maxDiscountAmount}
              onChange={(event) =>
                setForm({ ...form, maxDiscountAmount: event.target.value })
              }
              slotProps={{ htmlInput: { min: 0, step: 0.01 } }}
              fullWidth
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <TextField
              label="Currency"
              value={form.currency}
              onChange={(event) =>
                setForm({ ...form, currency: event.target.value })
              }
              slotProps={{ htmlInput: { maxLength: 3 } }}
              fullWidth
            />
          </Grid>
          <FormSection
            title="Availability"
            description="Control when guests may claim the offer and which stay dates qualify. Leave dates blank for no restriction."
          />
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Claim starts"
              type="datetime-local"
              value={form.claimStartsAt}
              onChange={(event) =>
                setForm({ ...form, claimStartsAt: event.target.value })
              }
              slotProps={{ inputLabel: { shrink: true } }}
              fullWidth
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Claim ends"
              type="datetime-local"
              value={form.claimEndsAt}
              onChange={(event) =>
                setForm({ ...form, claimEndsAt: event.target.value })
              }
              slotProps={{ inputLabel: { shrink: true } }}
              fullWidth
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Eligible stay starts"
              type="date"
              value={form.stayStartsOn}
              onChange={(event) =>
                setForm({ ...form, stayStartsOn: event.target.value })
              }
              slotProps={{ inputLabel: { shrink: true } }}
              fullWidth
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Eligible stay ends"
              type="date"
              value={form.stayEndsOn}
              onChange={(event) =>
                setForm({ ...form, stayEndsOn: event.target.value })
              }
              slotProps={{ inputLabel: { shrink: true } }}
              fullWidth
            />
          </Grid>
          <FormSection
            title="Eligibility & limits"
            description="Set booking requirements and protect inventory with sensible usage limits."
          />
          <Grid size={{ xs: 6, sm: 3 }}>
            <TextField
              label="Minimum nights"
              type="number"
              value={form.minNights}
              onChange={(event) =>
                setForm({ ...form, minNights: event.target.value })
              }
              slotProps={{ htmlInput: { min: 1, step: 1 } }}
              fullWidth
            />
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <TextField
              label="Maximum nights"
              type="number"
              value={form.maxNights}
              onChange={(event) =>
                setForm({ ...form, maxNights: event.target.value })
              }
              slotProps={{ htmlInput: { min: 1, step: 1 } }}
              fullWidth
            />
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <TextField
              label="Total claim limit"
              type="number"
              value={form.claimLimit}
              onChange={(event) =>
                setForm({ ...form, claimLimit: event.target.value })
              }
              slotProps={{ htmlInput: { min: 1, step: 1 } }}
              fullWidth
            />
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <TextField
              label="Per-guest limit"
              type="number"
              value={form.perGuestLimit}
              onChange={(event) =>
                setForm({ ...form, perGuestLimit: event.target.value })
              }
              slotProps={{ htmlInput: { min: 1, step: 1 } }}
              required
              fullWidth
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Minimum booking subtotal"
              type="number"
              value={form.minSubtotal}
              onChange={(event) =>
                setForm({ ...form, minSubtotal: event.target.value })
              }
              slotProps={{ htmlInput: { min: 0, step: 0.01 } }}
              fullWidth
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth>
              <InputLabel id="eligible-room-type-label">
                Eligible room type
              </InputLabel>
              <Select
                labelId="eligible-room-type-label"
                label="Eligible room type"
                value={form.roomTypeId}
                onChange={(event) =>
                  setForm({ ...form, roomTypeId: event.target.value })
                }
              >
                <MenuItem value="">All room types</MenuItem>
                {(roomTypesQuery.data ?? []).map((roomType) => (
                  <MenuItem key={roomType.id} value={String(roomType.id)}>
                    {roomType.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <FormSection
            title="Campaign targeting"
            description="Restrict who can claim and where the campaign redeems. Leave a list empty for no restriction."
          />
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Internal code"
              helperText="Staff-only operations reference"
              value={form.internalCode}
              onChange={(event) =>
                setForm({ ...form, internalCode: event.target.value })
              }
              slotProps={{ htmlInput: { maxLength: 64 } }}
              fullWidth
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth>
              <InputLabel id="campaign-objective-label">Objective</InputLabel>
              <Select
                labelId="campaign-objective-label"
                label="Objective"
                value={form.objective}
                onChange={(event) =>
                  setForm({ ...form, objective: event.target.value })
                }
              >
                <MenuItem value="">No objective</MenuItem>
                {CAMPAIGN_OBJECTIVE_OPTIONS.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth>
              <InputLabel id="campaign-channels-label">
                Booking channels
              </InputLabel>
              <Select
                labelId="campaign-channels-label"
                label="Booking channels"
                multiple
                value={form.bookingChannelIds}
                onChange={(event) =>
                  setForm({
                    ...form,
                    bookingChannelIds:
                      typeof event.target.value === "string"
                        ? event.target.value.split(",")
                        : event.target.value,
                  })
                }
                renderValue={(selected) =>
                  selected.length === 0
                    ? "All channels"
                    : `${selected.length} selected`
                }
              >
                {(targetingQuery.data?.channels ?? []).map((channel) => (
                  <MenuItem key={channel.id} value={String(channel.id)}>
                    <Checkbox
                      checked={form.bookingChannelIds.includes(
                        String(channel.id),
                      )}
                    />
                    <ListItemText
                      primary={channel.name}
                      secondary={channel.channel_type}
                    />
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth>
              <InputLabel id="campaign-tiers-label">Loyalty tiers</InputLabel>
              <Select
                labelId="campaign-tiers-label"
                label="Loyalty tiers"
                multiple
                value={form.loyaltyTierIds}
                onChange={(event) =>
                  setForm({
                    ...form,
                    loyaltyTierIds:
                      typeof event.target.value === "string"
                        ? event.target.value.split(",")
                        : event.target.value,
                  })
                }
                renderValue={(selected) =>
                  selected.length === 0
                    ? "All guests"
                    : `${selected.length} selected`
                }
              >
                {(targetingQuery.data?.loyalty_tiers ?? []).map((tier) => (
                  <MenuItem key={tier.id} value={String(tier.id)}>
                    <Checkbox
                      checked={form.loyaltyTierIds.includes(String(tier.id))}
                    />
                    <ListItemText primary={tier.name} secondary={tier.code} />
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <FormSection
            title="Guest experience"
            description="Explain the conditions clearly and choose how the promotion appears to guests."
          />
          <Grid size={{ xs: 12 }}>
            <TextField
              label="Terms and conditions"
              value={form.terms}
              onChange={(event) =>
                setForm({ ...form, terms: event.target.value })
              }
              multiline
              minRows={2}
              fullWidth
            />
          </Grid>
          <Grid size={{ xs: 12 }}>
            <FormControlLabel
              control={
                <Switch
                  checked={form.isCancellable}
                  onChange={(event) =>
                    setForm({ ...form, isCancellable: event.target.checked })
                  }
                />
              }
              label="Bookings using this offer can be cancelled by the guest"
            />
          </Grid>
          <Grid size={{ xs: 12 }}>
            <FormControlLabel
              control={
                <Switch
                  checked={form.isPublic}
                  onChange={(event) =>
                    setForm({ ...form, isPublic: event.target.checked })
                  }
                />
              }
              label="Show in the public offers catalog"
            />
          </Grid>
        </Grid>
        {validationError ? (
          <Alert severity="error" sx={{ mt: 2 }}>
            {validationError}
          </Alert>
        ) : null}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button onClick={onClose} disabled={isSaving}>
          Cancel
        </Button>
        <Button variant="contained" onClick={handleSave} disabled={isSaving}>
          {isSaving ? "Saving…" : promotion ? "Save changes" : "Create draft"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

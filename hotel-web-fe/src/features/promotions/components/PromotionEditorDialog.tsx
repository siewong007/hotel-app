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
import { useTranslation } from "../../../i18n";
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
  const { t } = useTranslation("promotions");
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
      setValidationError(t("editor.nameSlugRequired"));
      return;
    }
    if (!Number.isFinite(discountValue) || discountValue <= 0) {
      setValidationError(t("editor.discountPositive"));
      return;
    }
    if (!Number.isInteger(perGuestLimit) || perGuestLimit < 1) {
      setValidationError(t("editor.perGuestMin"));
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
          {promotion ? t("editor.titleEdit") : t("editor.titleCreate")}
        </Typography>
        <Typography variant="body2" sx={{
          color: "text.secondary"
        }}>
          {promotion
            ? t("editor.subtitleEdit")
            : t("editor.subtitleCreate")}
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        <Grid container spacing={2} sx={{ pt: 0.5 }}>
          <FormSection
            title={t("editor.sectionBasics")}
            description={t("editor.sectionBasicsDesc")}
          />
          <Grid size={{ xs: 12, sm: 7 }}>
            <TextField
              label={t("editor.fieldName")}
              value={form.name}
              onChange={(event) => handleNameChange(event.target.value)}
              required
              fullWidth
              autoFocus
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 5 }}>
            <TextField
              label={t("editor.fieldSlug")}
              helperText={t("editor.fieldSlugHelper")}
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
              label={t("editor.fieldDescription")}
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
            title={t("editor.sectionDiscount")}
            description={t("editor.sectionDiscountDesc")}
          />
          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth>
              <InputLabel id="promotion-kind-label">{t("editor.fieldKind")}</InputLabel>
              <Select
                labelId="promotion-kind-label"
                label={t("editor.fieldKind")}
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
                    {t(option.labelKey)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth>
              <InputLabel id="discount-type-label">{t("editor.fieldDiscountType")}</InputLabel>
              <Select
                labelId="discount-type-label"
                label={t("editor.fieldDiscountType")}
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
                    {t(option.labelKey)}
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
              label={t("editor.fieldMaxDiscount")}
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
              label={t("editor.fieldCurrency")}
              value={form.currency}
              onChange={(event) =>
                setForm({ ...form, currency: event.target.value })
              }
              slotProps={{ htmlInput: { maxLength: 3 } }}
              fullWidth
            />
          </Grid>
          <FormSection
            title={t("editor.sectionAvailability")}
            description={t("editor.sectionAvailabilityDesc")}
          />
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label={t("editor.fieldClaimStarts")}
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
              label={t("editor.fieldClaimEnds")}
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
              label={t("editor.fieldStayStarts")}
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
              label={t("editor.fieldStayEnds")}
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
            title={t("editor.sectionLimits")}
            description={t("editor.sectionLimitsDesc")}
          />
          <Grid size={{ xs: 6, sm: 3 }}>
            <TextField
              label={t("editor.fieldMinNights")}
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
              label={t("editor.fieldMaxNights")}
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
              label={t("editor.fieldClaimLimit")}
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
              label={t("editor.fieldPerGuestLimit")}
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
              label={t("editor.fieldMinSubtotal")}
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
                {t("editor.fieldRoomType")}
              </InputLabel>
              <Select
                labelId="eligible-room-type-label"
                label={t("editor.fieldRoomType")}
                value={form.roomTypeId}
                onChange={(event) =>
                  setForm({ ...form, roomTypeId: event.target.value })
                }
              >
                <MenuItem value="">{t("editor.allRoomTypes")}</MenuItem>
                {(roomTypesQuery.data ?? []).map((roomType) => (
                  <MenuItem key={roomType.id} value={String(roomType.id)}>
                    {roomType.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <FormSection
            title={t("editor.sectionTargeting")}
            description={t("editor.sectionTargetingDesc")}
          />
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label={t("editor.fieldInternalCode")}
              helperText={t("editor.fieldInternalCodeHelper")}
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
              <InputLabel id="campaign-objective-label">{t("editor.fieldObjective")}</InputLabel>
              <Select
                labelId="campaign-objective-label"
                label={t("editor.fieldObjective")}
                value={form.objective}
                onChange={(event) =>
                  setForm({ ...form, objective: event.target.value })
                }
              >
                <MenuItem value="">{t("editor.noObjective")}</MenuItem>
                {CAMPAIGN_OBJECTIVE_OPTIONS.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {t(option.labelKey)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth>
              <InputLabel id="campaign-channels-label">
                {t("editor.fieldChannels")}
              </InputLabel>
              <Select
                labelId="campaign-channels-label"
                label={t("editor.fieldChannels")}
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
                    ? t("editor.allChannels")
                    : t("editor.selectedCount", { count: selected.length })
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
              <InputLabel id="campaign-tiers-label">{t("editor.fieldTiers")}</InputLabel>
              <Select
                labelId="campaign-tiers-label"
                label={t("editor.fieldTiers")}
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
                    ? t("editor.allGuests")
                    : t("editor.selectedCount", { count: selected.length })
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
            title={t("editor.sectionExperience")}
            description={t("editor.sectionExperienceDesc")}
          />
          <Grid size={{ xs: 12 }}>
            <TextField
              label={t("editor.fieldTerms")}
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
              label={t("editor.cancellable")}
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
              label={t("editor.publicCatalog")}
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
          {t("common:actions.cancel")}
        </Button>
        <Button variant="contained" onClick={handleSave} disabled={isSaving}>
          {isSaving
            ? t("editor.saving")
            : promotion
              ? t("editor.saveChanges")
              : t("editor.createDraft")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

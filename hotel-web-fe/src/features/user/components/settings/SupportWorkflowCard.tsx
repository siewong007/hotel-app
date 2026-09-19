import React from "react";
import {
  Box,
  Card,
  CardContent,
  Divider,
  FormControlLabel,
  Grid,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { SupportAgent as SupportIcon } from "@mui/icons-material";

import { useTranslation } from "../../../../i18n";

export type SupportPriority = "low" | "normal" | "high" | "urgent";

const SUPPORT_PRIORITY_LABEL_KEYS: Record<SupportPriority, string> = {
  low: "settings.supportPriority.low",
  normal: "settings.supportPriority.normal",
  high: "settings.supportPriority.high",
  urgent: "settings.supportPriority.urgent",
};

const SUPPORT_PRIORITIES = Object.keys(
  SUPPORT_PRIORITY_LABEL_KEYS,
) as SupportPriority[];

const SUPPORT_CATEGORY_LABEL_KEYS: Record<string, string> = {
  booking: "settings.supportCategory.booking",
  stay: "settings.supportCategory.stay",
  billing: "settings.supportCategory.billing",
  loyalty: "settings.supportCategory.loyalty",
  technical: "settings.supportCategory.technical",
  other: "settings.supportCategory.other",
};

interface SupportWorkflowCardProps {
  isAdmin: boolean;
  guestBookingCancellationEnabled: boolean;
  onGuestBookingCancellationEnabledChange: React.Dispatch<
    React.SetStateAction<boolean>
  >;
  supportEnabled: boolean;
  onSupportEnabledChange: React.Dispatch<React.SetStateAction<boolean>>;
  supportCategories: string[];
  onSupportCategoriesChange: React.Dispatch<React.SetStateAction<string[]>>;
  supportFirstResponseMinutes: Record<SupportPriority, number>;
  onSupportFirstResponseMinutesChange: React.Dispatch<
    React.SetStateAction<Record<SupportPriority, number>>
  >;
  supportResolutionMinutes: Record<SupportPriority, number>;
  onSupportResolutionMinutesChange: React.Dispatch<
    React.SetStateAction<Record<SupportPriority, number>>
  >;
  supportReopenWindowDays: number;
  onSupportReopenWindowDaysChange: React.Dispatch<React.SetStateAction<number>>;
}

/**
 * "Guest" tab cards of SettingsPage (guest booking cancellation + the guest
 * support workflow: enable toggle, topic categories, per-priority response /
 * resolution targets, reopen window). Pure display + input: all values and
 * their setters come from the page.
 */
export function SupportWorkflowCard({
  isAdmin,
  guestBookingCancellationEnabled,
  onGuestBookingCancellationEnabledChange,
  supportEnabled,
  onSupportEnabledChange,
  supportCategories,
  onSupportCategoriesChange,
  supportFirstResponseMinutes,
  onSupportFirstResponseMinutesChange,
  supportResolutionMinutes,
  onSupportResolutionMinutesChange,
  supportReopenWindowDays,
  onSupportReopenWindowDaysChange,
}: SupportWorkflowCardProps) {
  const { t } = useTranslation('admin');

  return (
    <>
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" component="h2">{t('settings.guestCancelTitle')}</Typography>
          <Divider sx={{ my: 2 }} />
          <FormControlLabel
            control={
              <Switch
                checked={guestBookingCancellationEnabled}
                onChange={(event) =>
                  onGuestBookingCancellationEnabledChange(event.target.checked)
                }
                disabled={!isAdmin}
              />
            }
            label={t('settings.guestCancelToggle')}
          />
          <Typography variant="body2" sx={{
            color: "text.secondary"
          }}>
            {t('settings.guestCancelHint')}
          </Typography>
        </CardContent>
      </Card>
      {/* Guest Support Workflow */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
            <SupportIcon sx={{ mr: 1, color: "primary.main" }} />
            <Typography variant="h6" component="h2">{t('settings.supportTitle')}</Typography>
          </Box>
          <Divider sx={{ mb: 2 }} />

          <FormControlLabel
            control={
              <Switch
                checked={supportEnabled}
                onChange={(event) => onSupportEnabledChange(event.target.checked)}
                disabled={!isAdmin}
              />
            }
            label={t('settings.supportToggle')}
          />
          <Typography
            variant="body2"
            sx={{
              color: "text.secondary",
              mb: 3
            }}>
            {t('settings.supportHint')}
          </Typography>

          <Typography variant="subtitle1" component="h3" gutterBottom sx={{
            fontWeight: "medium"
          }}>
            {t('settings.supportTopics')}
          </Typography>
          <Stack
            direction="row"
            useFlexGap
            sx={{
              flexWrap: "wrap",
              mb: 3,
              columnGap: 1,
              rowGap: 0
            }}>
            {Object.entries(SUPPORT_CATEGORY_LABEL_KEYS).map(
              ([category, labelKey]) => {
                const isEnabled = supportCategories.includes(category);
                return (
                  <FormControlLabel
                    key={category}
                    label={t(labelKey)}
                    control={
                      <Switch
                        size="small"
                        checked={isEnabled}
                        disabled={
                          !isAdmin ||
                          (isEnabled && supportCategories.length === 1)
                        }
                        onChange={(event) =>
                          onSupportCategoriesChange((current) =>
                            event.target.checked
                              ? [...new Set([...current, category])]
                              : current.filter((value) => value !== category),
                          )
                        }
                      />
                    }
                  />
                );
              },
            )}
          </Stack>

          <Grid container spacing={3}>
            <Grid size={{ xs: 12, md: 6 }}>
              <Typography variant="subtitle1" gutterBottom sx={{
                fontWeight: "medium"
              }}>
                {t('settings.firstResponseTarget')}
              </Typography>
              <Grid container spacing={2}>
                {SUPPORT_PRIORITIES.map((priority) => (
                  <Grid key={priority} size={{ xs: 6, sm: 3 }}>
                    <TextField
                      fullWidth
                      label={`${t(SUPPORT_PRIORITY_LABEL_KEYS[priority])} (${t('common:units.minutes')})`}
                      type="number"
                      value={supportFirstResponseMinutes[priority]}
                      onChange={(event) =>
                        onSupportFirstResponseMinutesChange((current) => ({
                          ...current,
                          [priority]: Math.max(
                            1,
                            Number.parseInt(event.target.value, 10) || 1,
                          ),
                        }))
                      }
                      disabled={!isAdmin}
                      slotProps={{
                        htmlInput: { min: 1, step: 1 }
                      }}
                    />
                  </Grid>
                ))}
              </Grid>
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <Typography variant="subtitle1" gutterBottom sx={{
                fontWeight: "medium"
              }}>
                {t('settings.resolutionTarget')}
              </Typography>
              <Grid container spacing={2}>
                {SUPPORT_PRIORITIES.map((priority) => (
                  <Grid key={priority} size={{ xs: 6, sm: 3 }}>
                    <TextField
                      fullWidth
                      label={`${t(SUPPORT_PRIORITY_LABEL_KEYS[priority])} (${t('common:units.minutes')})`}
                      type="number"
                      value={supportResolutionMinutes[priority]}
                      onChange={(event) =>
                        onSupportResolutionMinutesChange((current) => ({
                          ...current,
                          [priority]: Math.max(
                            1,
                            Number.parseInt(event.target.value, 10) || 1,
                          ),
                        }))
                      }
                      disabled={!isAdmin}
                      slotProps={{
                        htmlInput: { min: 1, step: 1 }
                      }}
                    />
                  </Grid>
                ))}
              </Grid>
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <TextField
                fullWidth
                label={t('settings.reopenWindow')}
                type="number"
                value={supportReopenWindowDays}
                onChange={(event) =>
                  onSupportReopenWindowDaysChange(
                    Math.max(1, Number.parseInt(event.target.value, 10) || 1),
                  )
                }
                helperText={t('settings.reopenWindowHint')}
                disabled={!isAdmin}
                slotProps={{
                  htmlInput: { min: 1, step: 1 }
                }}
              />
            </Grid>
          </Grid>
        </CardContent>
      </Card>
    </>
  );
}

export default SupportWorkflowCard;

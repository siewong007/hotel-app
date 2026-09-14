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
import AssessmentIcon from "@mui/icons-material/Assessment";

import {
  REPORT_DISPLAY_FONT_SIZE_MAX,
  REPORT_DISPLAY_FONT_SIZE_MIN,
  REPORT_FONT_FAMILY_OPTIONS,
  REPORT_FONT_SIZE_MAX,
  REPORT_FONT_SIZE_MIN,
} from "../../../../utils/hotelSettings";
import {
  REPORT_TYPOGRAPHY_PRESETS,
  type ReportTypographyPresetKey,
  getReportTypographyPreset,
} from "../../../insights/utils/reportTypography";
import { useTranslation } from "../../../../i18n";

interface ReportSettingsCardProps {
  isAdmin: boolean;
  reportFontSize: number;
  onReportFontSizeChange: React.Dispatch<React.SetStateAction<number>>;
  reportFontFamily: string;
  onReportFontFamilyChange: React.Dispatch<React.SetStateAction<string>>;
  reportHeadingFontSize: number;
  onReportHeadingFontSizeChange: React.Dispatch<React.SetStateAction<number>>;
  reportSectionHeadingFontSize: number;
  onReportSectionHeadingFontSizeChange: React.Dispatch<React.SetStateAction<number>>;
  reportTableFontSize: number;
  onReportTableFontSizeChange: React.Dispatch<React.SetStateAction<number>>;
  reportCaptionFontSize: number;
  onReportCaptionFontSizeChange: React.Dispatch<React.SetStateAction<number>>;
  reportChipFontSize: number;
  onReportChipFontSizeChange: React.Dispatch<React.SetStateAction<number>>;
}

/**
 * "Report Settings" card of SettingsPage (report typography preset, font
 * family, and the six font-size inputs). Pure display + input: all values and
 * their setters come from the page.
 */
export function ReportSettingsCard({
  isAdmin,
  reportFontSize,
  onReportFontSizeChange,
  reportFontFamily,
  onReportFontFamilyChange,
  reportHeadingFontSize,
  onReportHeadingFontSizeChange,
  reportSectionHeadingFontSize,
  onReportSectionHeadingFontSizeChange,
  reportTableFontSize,
  onReportTableFontSizeChange,
  reportCaptionFontSize,
  onReportCaptionFontSizeChange,
  reportChipFontSize,
  onReportChipFontSizeChange,
}: ReportSettingsCardProps) {
  const { t } = useTranslation('admin');
  const selectedReportPreset = REPORT_TYPOGRAPHY_PRESETS.find(
    (preset) =>
      preset.sizes.report_font_size === reportFontSize &&
      preset.sizes.report_heading_font_size === reportHeadingFontSize &&
      preset.sizes.report_section_heading_font_size ===
        reportSectionHeadingFontSize &&
      preset.sizes.report_table_font_size === reportTableFontSize &&
      preset.sizes.report_caption_font_size === reportCaptionFontSize &&
      preset.sizes.report_chip_font_size === reportChipFontSize,
  );
  const reportPresetValue = selectedReportPreset?.key ?? "custom";
  const reportPresetHelperText = selectedReportPreset
    ? t(`settings.fontPresets.${selectedReportPreset.key}.description`)
    : t('settings.fontPresetCustomHint');

  const applyReportTypographyPreset = (value: string) => {
    if (value === "custom") return;
    const preset = getReportTypographyPreset(
      value as ReportTypographyPresetKey,
    );
    onReportFontSizeChange(preset.sizes.report_font_size);
    onReportHeadingFontSizeChange(preset.sizes.report_heading_font_size);
    onReportSectionHeadingFontSizeChange(
      preset.sizes.report_section_heading_font_size,
    );
    onReportTableFontSizeChange(preset.sizes.report_table_font_size);
    onReportCaptionFontSizeChange(preset.sizes.report_caption_font_size);
    onReportChipFontSizeChange(preset.sizes.report_chip_font_size);
  };

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
          <AssessmentIcon sx={{ mr: 1, color: "primary.main" }} />
          <Typography variant="h6">{t('settings.reportsTitle')}</Typography>
        </Box>
        <Divider sx={{ mb: 3 }} />

        <Grid container spacing={3}>
          <Grid size={{ xs: 12, md: 4 }}>
            <TextField
              select
              fullWidth
              label={t('settings.fontPreset')}
              value={reportPresetValue}
              onChange={(e) => applyReportTypographyPreset(e.target.value)}
              helperText={reportPresetHelperText}
              disabled={!isAdmin}
              slotProps={{
                select: { native: true }
              }}
            >
              <option value="custom">{t('settings.fontPresetCustom')}</option>
              {REPORT_TYPOGRAPHY_PRESETS.map((preset) => (
                <option key={preset.key} value={preset.key}>
                  {t(`settings.fontPresets.${preset.key}.label`)}
                </option>
              ))}
            </TextField>
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <TextField
              select
              fullWidth
              label={t('settings.fontFamily')}
              value={reportFontFamily}
              onChange={(e) => onReportFontFamilyChange(e.target.value)}
              helperText={t('settings.fontFamilyHint')}
              disabled={!isAdmin}
              slotProps={{
                select: { native: true }
              }}
            >
              {REPORT_FONT_FAMILY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </TextField>
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 4 }}>
            <SizeField
              label={t('settings.fontSizeBody')}
              value={reportFontSize}
              onChange={onReportFontSizeChange}
              helperText={t('settings.fontSizeBodyHint')}
              min={REPORT_FONT_SIZE_MIN}
              max={REPORT_FONT_SIZE_MAX}
              disabled={!isAdmin}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 4 }}>
            <SizeField
              label={t('settings.fontSizeHeading')}
              value={reportHeadingFontSize}
              onChange={onReportHeadingFontSizeChange}
              helperText={t('settings.fontSizeHeadingHint')}
              min={REPORT_DISPLAY_FONT_SIZE_MIN}
              max={REPORT_DISPLAY_FONT_SIZE_MAX}
              fallbackMin={REPORT_DISPLAY_FONT_SIZE_MIN}
              disabled={!isAdmin}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 4 }}>
            <SizeField
              label={t('settings.fontSizeSectionHeading')}
              value={reportSectionHeadingFontSize}
              onChange={onReportSectionHeadingFontSizeChange}
              helperText={t('settings.fontSizeSectionHeadingHint')}
              min={REPORT_FONT_SIZE_MIN}
              max={REPORT_DISPLAY_FONT_SIZE_MAX}
              disabled={!isAdmin}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 4 }}>
            <SizeField
              label={t('settings.fontSizeTable')}
              value={reportTableFontSize}
              onChange={onReportTableFontSizeChange}
              helperText={t('settings.fontSizeTableHint')}
              min={REPORT_FONT_SIZE_MIN}
              max={REPORT_FONT_SIZE_MAX}
              disabled={!isAdmin}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 4 }}>
            <SizeField
              label={t('settings.fontSizeCaption')}
              value={reportCaptionFontSize}
              onChange={onReportCaptionFontSizeChange}
              helperText={t('settings.fontSizeCaptionHint')}
              min={REPORT_FONT_SIZE_MIN}
              max={REPORT_FONT_SIZE_MAX}
              disabled={!isAdmin}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 4 }}>
            <SizeField
              label={t('settings.fontSizeChip')}
              value={reportChipFontSize}
              onChange={onReportChipFontSizeChange}
              helperText={t('settings.fontSizeChipHint')}
              min={REPORT_FONT_SIZE_MIN}
              max={REPORT_FONT_SIZE_MAX}
              disabled={!isAdmin}
            />
          </Grid>
        </Grid>
      </CardContent>
    </Card>
  );
}

function SizeField({
  label,
  value,
  onChange,
  helperText,
  min,
  max,
  fallbackMin,
  disabled,
}: {
  label: string;
  value: number;
  onChange: React.Dispatch<React.SetStateAction<number>>;
  helperText: string;
  min: number;
  max: number;
  /** Minimum applied when the parsed input is falsy (defaults to `min`). */
  fallbackMin?: number;
  disabled: boolean;
}) {
  return (
    <TextField
      fullWidth
      label={label}
      type="number"
      value={value}
      onChange={(e) =>
        onChange(parseInt(e.target.value, 10) || (fallbackMin ?? min))
      }
      helperText={helperText}
      disabled={disabled}
      slotProps={{
        input: {
          endAdornment: <Typography sx={{ ml: 0.5 }}>px</Typography>,
        },

        htmlInput: {
          min,
          max,
          step: 1,
        }
      }} />
  );
}

export default ReportSettingsCard;

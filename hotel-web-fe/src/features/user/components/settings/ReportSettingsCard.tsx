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
} from "../../../reports/utils/reportTypography";

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
  const reportPresetHelperText =
    selectedReportPreset?.description ?? "Custom report font sizes are active";

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
          <Typography variant="h6">Report Settings</Typography>
        </Box>
        <Divider sx={{ mb: 3 }} />

        <Grid container spacing={3}>
          <Grid size={{ xs: 12, md: 4 }}>
            <TextField
              select
              fullWidth
              label="Report Font Preset"
              value={reportPresetValue}
              onChange={(e) => applyReportTypographyPreset(e.target.value)}
              helperText={reportPresetHelperText}
              disabled={!isAdmin}
              slotProps={{
                select: { native: true }
              }}
            >
              <option value="custom">Custom</option>
              {REPORT_TYPOGRAPHY_PRESETS.map((preset) => (
                <option key={preset.key} value={preset.key}>
                  {preset.label}
                </option>
              ))}
            </TextField>
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <TextField
              select
              fullWidth
              label="Report Font Family"
              value={reportFontFamily}
              onChange={(e) => onReportFontFamilyChange(e.target.value)}
              helperText="Font used by generated report previews and print output"
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
              label="Report Body Font Size"
              value={reportFontSize}
              onChange={onReportFontSizeChange}
              helperText="Main report text size"
              min={REPORT_FONT_SIZE_MIN}
              max={REPORT_FONT_SIZE_MAX}
              disabled={!isAdmin}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 4 }}>
            <SizeField
              label="Heading / KPI Font Size"
              value={reportHeadingFontSize}
              onChange={onReportHeadingFontSizeChange}
              helperText="Large report titles and metric values"
              min={REPORT_DISPLAY_FONT_SIZE_MIN}
              max={REPORT_DISPLAY_FONT_SIZE_MAX}
              fallbackMin={REPORT_DISPLAY_FONT_SIZE_MIN}
              disabled={!isAdmin}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 4 }}>
            <SizeField
              label="Section Heading Font Size"
              value={reportSectionHeadingFontSize}
              onChange={onReportSectionHeadingFontSizeChange}
              helperText="Report section labels and subheads"
              min={REPORT_FONT_SIZE_MIN}
              max={REPORT_DISPLAY_FONT_SIZE_MAX}
              disabled={!isAdmin}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 4 }}>
            <SizeField
              label="Table Font Size"
              value={reportTableFontSize}
              onChange={onReportTableFontSizeChange}
              helperText="Rows, totals, and table headers"
              min={REPORT_FONT_SIZE_MIN}
              max={REPORT_FONT_SIZE_MAX}
              disabled={!isAdmin}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 4 }}>
            <SizeField
              label="Caption Font Size"
              value={reportCaptionFontSize}
              onChange={onReportCaptionFontSizeChange}
              helperText="Secondary labels and captions"
              min={REPORT_FONT_SIZE_MIN}
              max={REPORT_FONT_SIZE_MAX}
              disabled={!isAdmin}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 4 }}>
            <SizeField
              label="Status Chip Font Size"
              value={reportChipFontSize}
              onChange={onReportChipFontSizeChange}
              helperText="Payment and posting status chips"
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

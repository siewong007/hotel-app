import { describe, expect, it } from 'vitest';
import {
  REPORT_FONT_COVERAGE_SELECTORS,
  REPORT_TYPOGRAPHY_PRESETS,
  createReportContentSx,
  createReportPrintStyles,
  createReportTypography,
  getReportTypographyPreset,
} from './reportTypography';
import type { HotelSettings } from '../../../utils/hotelSettings';

const makeSettings = (overrides: Partial<HotelSettings> = {}) => ({
  report_font_size: 16,
  report_font_family: 'Georgia, "Times New Roman", serif',
  report_heading_font_size: 30,
  report_section_heading_font_size: 22,
  report_table_font_size: 15,
  report_caption_font_size: 12,
  report_chip_font_size: 11,
  ...overrides,
} as HotelSettings);

describe('reportTypography', () => {
  it('offers the expected readability presets', () => {
    expect(REPORT_TYPOGRAPHY_PRESETS.map(preset => preset.label)).toEqual([
      'Very Small',
      'Small',
      'Medium',
      'Large',
      'Very Large',
    ]);
    expect(getReportTypographyPreset('medium').sizes).toEqual({
      report_font_size: 14,
      report_heading_font_size: 24,
      report_section_heading_font_size: 18,
      report_table_font_size: 14,
      report_caption_font_size: 13,
      report_chip_font_size: 12,
    });
  });

  it('keeps preset font sizes within supported report ranges', () => {
    for (const preset of REPORT_TYPOGRAPHY_PRESETS) {
      const typography = createReportTypography({
        report_font_family: 'Arial, Helvetica, sans-serif',
        ...preset.sizes,
      });

      expect(typography.bodySize).toBe(preset.sizes.report_font_size);
      expect(typography.headingSize).toBe(preset.sizes.report_heading_font_size);
      expect(typography.sectionHeadingSize).toBe(preset.sizes.report_section_heading_font_size);
      expect(typography.tableSize).toBe(preset.sizes.report_table_font_size);
      expect(typography.captionSize).toBe(preset.sizes.report_caption_font_size);
      expect(typography.chipSize).toBe(preset.sizes.report_chip_font_size);
    }
  });

  it('builds role-specific report font settings from hotel settings', () => {
    const typography = createReportTypography(makeSettings());

    expect(typography.fontFamily).toBe('Georgia, "Times New Roman", serif');
    expect(typography.px).toEqual({
      body: '16px',
      heading: '30px',
      sectionHeading: '22px',
      table: '15px',
      caption: '12px',
      chip: '11px',
    });
  });

  it('covers every generated report font selector in preview styles', () => {
    const typography = createReportTypography(makeSettings());
    const previewStyles = createReportContentSx(typography);
    const serialized = JSON.stringify(previewStyles);

    for (const selector of REPORT_FONT_COVERAGE_SELECTORS) {
      expect(serialized).toContain(selector);
    }

    expect(serialized).toContain('30px');
    expect(serialized).toContain('22px');
    expect(serialized).toContain('15px');
    expect(serialized).toContain('12px');
    expect(serialized).toContain('11px');
  });

  it('covers every generated report font selector in print CSS', () => {
    const typography = createReportTypography(makeSettings());
    const printStyles = createReportPrintStyles(typography);

    for (const selector of REPORT_FONT_COVERAGE_SELECTORS) {
      expect(printStyles).toContain(selector);
    }

    expect(printStyles).toContain('font-family: Georgia, "Times New Roman", serif');
    expect(printStyles).toContain('font-size: 30px');
    expect(printStyles).toContain('font-size: 22px');
    expect(printStyles).toContain('font-size: 15px');
    expect(printStyles).toContain('font-size: 12px');
    expect(printStyles).toContain('font-size: 11px');
  });

  it('normalizes unsupported report font settings', () => {
    const typography = createReportTypography(makeSettings({
      report_font_size: 4,
      report_font_family: 'Comic Sans MS',
      report_heading_font_size: 100,
      report_section_heading_font_size: Number.NaN,
    }));

    expect(typography.fontFamily).toBe('Arial, Helvetica, sans-serif');
    expect(typography.bodySize).toBe(10);
    expect(typography.headingSize).toBe(40);
    expect(typography.sectionHeadingSize).toBe(14);
  });
});

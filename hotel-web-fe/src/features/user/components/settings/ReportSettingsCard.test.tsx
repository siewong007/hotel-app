import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  REPORT_TYPOGRAPHY_PRESETS,
  getReportTypographyPreset,
} from '../../../reports/utils/reportTypography';
import ReportSettingsCard from './ReportSettingsCard';

const mocks = vi.hoisted(() => ({
  sizes: {
    reportFontSize: 14,
    reportFontFamily: 'helvetica',
    reportHeadingFontSize: 24,
    reportSectionHeadingFontSize: 18,
    reportTableFontSize: 14,
    reportCaptionFontSize: 13,
    reportChipFontSize: 12,
  },
}));

function renderCard({ isAdmin = true }: { isAdmin?: boolean } = {}) {
  render(
    <ReportSettingsCard
      isAdmin={isAdmin}
      {...mocks.sizes}
      onReportFontSizeChange={(v) => { mocks.sizes.reportFontSize = typeof v === 'function' ? v(mocks.sizes.reportFontSize) : v; }}
      onReportFontFamilyChange={(v) => { mocks.sizes.reportFontFamily = typeof v === 'function' ? v(mocks.sizes.reportFontFamily) : v; }}
      onReportHeadingFontSizeChange={(v) => { mocks.sizes.reportHeadingFontSize = typeof v === 'function' ? v(mocks.sizes.reportHeadingFontSize) : v; }}
      onReportSectionHeadingFontSizeChange={(v) => { mocks.sizes.reportSectionHeadingFontSize = typeof v === 'function' ? v(mocks.sizes.reportSectionHeadingFontSize) : v; }}
      onReportTableFontSizeChange={(v) => { mocks.sizes.reportTableFontSize = typeof v === 'function' ? v(mocks.sizes.reportTableFontSize) : v; }}
      onReportCaptionFontSizeChange={(v) => { mocks.sizes.reportCaptionFontSize = typeof v === 'function' ? v(mocks.sizes.reportCaptionFontSize) : v; }}
      onReportChipFontSizeChange={(v) => { mocks.sizes.reportChipFontSize = typeof v === 'function' ? v(mocks.sizes.reportChipFontSize) : v; }}
    />,
  );
}

describe('ReportSettingsCard', () => {
  beforeEach(() => {
    // The default MUI "medium" preset sizes — the select should recognise
    // this combination instead of reading "custom".
    mocks.sizes = {
      reportFontSize: 14,
      reportFontFamily: 'Arial, Helvetica, sans-serif',
      reportHeadingFontSize: 24,
      reportSectionHeadingFontSize: 18,
      reportTableFontSize: 14,
      reportCaptionFontSize: 13,
      reportChipFontSize: 12,
    };
  });

  afterEach(cleanup);

  it('recognises the current sizes as the matching preset', () => {
    renderCard();

    const preset = screen.getByLabelText('Report Font Preset') as HTMLSelectElement;
    expect(preset.value).toBe('medium');
    expect(screen.getByText('Balanced default for screen and print')).toBeTruthy();
  });

  it('falls back to Custom with helper text when no preset matches', () => {
    mocks.sizes.reportFontSize = 15;

    renderCard();

    const preset = screen.getByLabelText('Report Font Preset') as HTMLSelectElement;
    expect(preset.value).toBe('custom');
    expect(screen.getByText('Custom report font sizes are active')).toBeTruthy();
  });

  it('applies a preset to every font-size input at once', () => {
    renderCard();

    const preset = screen.getByLabelText('Report Font Preset') as HTMLSelectElement;
    const target = REPORT_TYPOGRAPHY_PRESETS.find(p => p.key === 'very_small')!;
    fireEvent.change(preset, { target: { value: 'very_small' } });

    expect(mocks.sizes.reportFontSize).toBe(target.sizes.report_font_size);
    expect(mocks.sizes.reportHeadingFontSize).toBe(target.sizes.report_heading_font_size);
    expect(mocks.sizes.reportSectionHeadingFontSize).toBe(target.sizes.report_section_heading_font_size);
    expect(mocks.sizes.reportTableFontSize).toBe(target.sizes.report_table_font_size);
    expect(mocks.sizes.reportCaptionFontSize).toBe(target.sizes.report_caption_font_size);
    expect(mocks.sizes.reportChipFontSize).toBe(target.sizes.report_chip_font_size);
    expect(getReportTypographyPreset('very_small').key).toBe('very_small'); // sanity: preset exists
  });

  it('edits a single font-size field independently', () => {
    renderCard();

    fireEvent.change(screen.getByLabelText('Table Font Size'), {
      target: { value: '16' },
    });

    expect(mocks.sizes.reportTableFontSize).toBe(16);
  });

  it('changes the report font family through its select', () => {
    renderCard();

    const family = screen.getByLabelText('Report Font Family') as HTMLSelectElement;
    expect(family.value).toBe('Arial, Helvetica, sans-serif');

    fireEvent.change(family, { target: { value: 'Georgia, "Times New Roman", serif' } });
    expect(mocks.sizes.reportFontFamily).toBe('Georgia, "Times New Roman", serif');
  });

  it('disables every control for non-admins', () => {
    renderCard({ isAdmin: false });

    expect((screen.getByLabelText('Report Font Preset') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Report Font Family') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Report Body Font Size') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Status Chip Font Size') as HTMLInputElement).disabled).toBe(true);
  });
});

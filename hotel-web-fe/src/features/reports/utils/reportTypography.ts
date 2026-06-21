import {
  REPORT_DISPLAY_FONT_SIZE_MAX,
  REPORT_DISPLAY_FONT_SIZE_MIN,
  REPORT_FONT_SIZE_MIN,
  normalizeReportFontFamily,
  normalizeReportFontSize,
  type HotelSettings,
} from '../../../utils/hotelSettings';

type ReportTypographySettings = Pick<
  HotelSettings,
  | 'report_font_size'
  | 'report_font_family'
  | 'report_heading_font_size'
  | 'report_section_heading_font_size'
  | 'report_table_font_size'
  | 'report_caption_font_size'
  | 'report_chip_font_size'
>;

export type ReportTypographyPresetKey =
  | 'very_small'
  | 'small'
  | 'medium'
  | 'large'
  | 'very_large';

export interface ReportTypographyPreset {
  key: ReportTypographyPresetKey;
  label: string;
  description: string;
  sizes: Pick<
    ReportTypographySettings,
    | 'report_font_size'
    | 'report_heading_font_size'
    | 'report_section_heading_font_size'
    | 'report_table_font_size'
    | 'report_caption_font_size'
    | 'report_chip_font_size'
  >;
}

export interface ReportTypography {
  fontFamily: string;
  bodySize: number;
  headingSize: number;
  sectionHeadingSize: number;
  tableSize: number;
  captionSize: number;
  chipSize: number;
  px: {
    body: string;
    heading: string;
    sectionHeading: string;
    table: string;
    caption: string;
    chip: string;
  };
}

type ReportContentSx = Record<string, unknown>;

export const REPORT_TYPOGRAPHY_PRESETS: ReportTypographyPreset[] = [
  {
    key: 'very_small',
    label: 'Very Small',
    description: 'Dense reports with maximum rows per page',
    sizes: {
      report_font_size: 10,
      report_heading_font_size: 18,
      report_section_heading_font_size: 14,
      report_table_font_size: 10,
      report_caption_font_size: 10,
      report_chip_font_size: 10,
    },
  },
  {
    key: 'small',
    label: 'Small',
    description: 'Compact reports for longer tables',
    sizes: {
      report_font_size: 12,
      report_heading_font_size: 20,
      report_section_heading_font_size: 16,
      report_table_font_size: 12,
      report_caption_font_size: 11,
      report_chip_font_size: 10,
    },
  },
  {
    key: 'medium',
    label: 'Medium',
    description: 'Balanced default for screen and print',
    sizes: {
      report_font_size: 14,
      report_heading_font_size: 24,
      report_section_heading_font_size: 18,
      report_table_font_size: 14,
      report_caption_font_size: 13,
      report_chip_font_size: 12,
    },
  },
  {
    key: 'large',
    label: 'Large',
    description: 'Roomier reports with stronger headings',
    sizes: {
      report_font_size: 18,
      report_heading_font_size: 30,
      report_section_heading_font_size: 22,
      report_table_font_size: 16,
      report_caption_font_size: 15,
      report_chip_font_size: 14,
    },
  },
  {
    key: 'very_large',
    label: 'Very Large',
    description: 'High-readability reports for review screens',
    sizes: {
      report_font_size: 22,
      report_heading_font_size: 36,
      report_section_heading_font_size: 28,
      report_table_font_size: 20,
      report_caption_font_size: 18,
      report_chip_font_size: 16,
    },
  },
];

export const getReportTypographyPreset = (
  key: ReportTypographyPresetKey
) => REPORT_TYPOGRAPHY_PRESETS.find(preset => preset.key === key) ?? REPORT_TYPOGRAPHY_PRESETS[2];

export const REPORT_FONT_COVERAGE_SELECTORS = [
  '.MuiTypography-root',
  '.MuiTypography-h1',
  '.MuiTypography-h2',
  '.MuiTypography-h3',
  '.MuiTypography-h4',
  '.MuiTypography-h5',
  '.MuiTypography-h6',
  '.MuiTypography-subtitle1',
  '.MuiTypography-subtitle2',
  '.MuiTypography-body1',
  '.MuiTypography-body2',
  '.MuiTypography-caption',
  '.MuiTableCell-root',
  '.MuiTableSortLabel-root',
  '.MuiChip-root',
  '.MuiChip-label',
  'strong',
] as const;

const toPx = (value: number) => `${value}px`;

export const createReportTypography = (
  settings: ReportTypographySettings
): ReportTypography => {
  const bodySize = normalizeReportFontSize(settings.report_font_size);
  const headingSize = normalizeReportFontSize(
    settings.report_heading_font_size,
    Math.max(bodySize + 10, 20),
    { min: REPORT_DISPLAY_FONT_SIZE_MIN, max: REPORT_DISPLAY_FONT_SIZE_MAX }
  );
  const sectionHeadingSize = normalizeReportFontSize(
    settings.report_section_heading_font_size,
    Math.max(bodySize + 4, 14),
    { min: REPORT_FONT_SIZE_MIN, max: REPORT_DISPLAY_FONT_SIZE_MAX }
  );
  const tableSize = normalizeReportFontSize(settings.report_table_font_size, bodySize);
  const captionSize = normalizeReportFontSize(
    settings.report_caption_font_size,
    Math.max(bodySize - 1, REPORT_FONT_SIZE_MIN)
  );
  const chipSize = normalizeReportFontSize(
    settings.report_chip_font_size,
    Math.max(bodySize - 2, REPORT_FONT_SIZE_MIN)
  );

  return {
    fontFamily: normalizeReportFontFamily(settings.report_font_family),
    bodySize,
    headingSize,
    sectionHeadingSize,
    tableSize,
    captionSize,
    chipSize,
    px: {
      body: toPx(bodySize),
      heading: toPx(headingSize),
      sectionHeading: toPx(sectionHeadingSize),
      table: toPx(tableSize),
      caption: toPx(captionSize),
      chip: toPx(chipSize),
    },
  };
};

export const createReportContentSx = (
  typography: ReportTypography
): ReportContentSx => ({
  fontFamily: typography.fontFamily,
  fontSize: typography.px.body,
  lineHeight: 1.45,
  '& .MuiTypography-root, & .MuiTableCell-root, & .MuiTableSortLabel-root, & .MuiChip-root': {
    fontFamily: typography.fontFamily,
  },
  '& .MuiTypography-root': {
    fontSize: typography.px.body,
    lineHeight: 'inherit',
  },
  '& .MuiTypography-h1, & .MuiTypography-h2, & .MuiTypography-h3, & .MuiTypography-h4, & .MuiTypography-h5': {
    fontSize: typography.px.heading,
    lineHeight: 1.2,
  },
  '& .MuiTypography-h6': {
    fontSize: typography.px.sectionHeading,
    lineHeight: 1.3,
  },
  '& .MuiTypography-subtitle1, & .MuiTypography-subtitle2, & .MuiTypography-body1, & .MuiTypography-body2': {
    fontSize: typography.px.body,
  },
  '& .MuiTypography-caption': {
    fontSize: typography.px.caption,
    lineHeight: 1.35,
  },
  '& .MuiTableCell-root': {
    fontSize: typography.px.table,
    lineHeight: 1.4,
  },
  '& .MuiTableSortLabel-root': {
    fontSize: 'inherit',
    fontFamily: 'inherit',
  },
  '& .MuiChip-root': {
    fontSize: typography.px.chip,
    fontFamily: typography.fontFamily,
  },
  '& .MuiChip-label': {
    fontSize: 'inherit',
    lineHeight: 1.2,
  },
  '& strong': {
    fontSize: 'inherit',
  },
});

export const createReportPrintStyles = (typography: ReportTypography) => `
  body {
    font-family: ${typography.fontFamily};
    font-size: ${typography.px.body};
    padding: 20px;
    margin: 0;
    line-height: 1.45;
  }
  *, *::before, *::after { box-sizing: border-box; }
  .MuiTypography-root,
  .MuiTableCell-root,
  .MuiTableSortLabel-root,
  .MuiChip-root {
    font-family: ${typography.fontFamily};
  }
  .MuiTypography-root {
    font-size: ${typography.px.body};
    line-height: inherit;
  }
  h1,
  h2,
  h3,
  h4,
  h5,
  .MuiTypography-h1,
  .MuiTypography-h2,
  .MuiTypography-h3,
  .MuiTypography-h4,
  .MuiTypography-h5 {
    font-size: ${typography.px.heading};
    line-height: 1.2;
    margin: 10px 0;
  }
  h6,
  .MuiTypography-h6 {
    font-size: ${typography.px.sectionHeading};
    line-height: 1.3;
    margin: 10px 0;
  }
  .MuiTypography-subtitle1,
  .MuiTypography-subtitle2,
  .MuiTypography-body1,
  .MuiTypography-body2 {
    font-size: ${typography.px.body};
  }
  .MuiTypography-caption {
    font-size: ${typography.px.caption};
    line-height: 1.35;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    margin: 10px 0;
    font-size: ${typography.px.table};
  }
  th,
  td,
  .MuiTableCell-root {
    border: 1px solid #ddd;
    padding: 8px;
    text-align: left;
    font-size: ${typography.px.table};
    line-height: 1.4;
  }
  th { background-color: #f5f5f5; }
  .MuiTableSortLabel-root {
    font-size: inherit;
    font-family: inherit;
  }
  .MuiChip-root {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 16px;
    font-size: ${typography.px.chip};
    font-family: ${typography.fontFamily};
  }
  .MuiChip-label {
    font-size: inherit;
    line-height: 1.2;
  }
  strong { font-size: inherit; }
  .header { text-align: center; margin-bottom: 20px; }
  .MuiPaper-root { box-shadow: none !important; }
`;

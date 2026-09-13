import type { KpiFormat, ReportEnvelope } from '../types';
import { getHotelSettings } from '../../../utils/hotelSettings';
import { formatCurrency } from '../../../utils/currency';
import {
  createReportPrintStyles,
  createReportTypography,
} from './reportTypography';

const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const formatValue = (value: unknown, format: KpiFormat): string => {
  if (value == null) return '—';
  const num = typeof value === 'number' ? value : Number(value);
  switch (format) {
    case 'currency':
      return Number.isFinite(num) ? formatCurrency(num) : String(value);
    case 'percent':
      return Number.isFinite(num) ? `${num.toFixed(1)}%` : String(value);
    case 'number':
      return Number.isFinite(num) ? num.toLocaleString() : String(value);
    default:
      return String(value);
  }
};

/** Render a report envelope as a self-contained printable HTML document. */
export const envelopeToPrintHtml = (envelope: ReportEnvelope): string => {
  const typography = createReportTypography(getHotelSettings());
  const printStyles = createReportPrintStyles(typography);
  const { meta } = envelope;

  const kpiBlock =
    envelope.kpis.length === 0
      ? ''
      : `<table class="kpi-grid"><tbody><tr>${envelope.kpis
          .map(
            (kpi) =>
              `<td><div class="MuiTypography-caption kpi-label">${escapeHtml(kpi.label)}</div>` +
              `<div class="kpi-value">${escapeHtml(formatValue(kpi.value, kpi.format))}</div></td>`
          )
          .join('')}</tr></tbody></table>`;

  const sections = envelope.sections
    .map((section) => {
      const head =
        section.columns.length === 0
          ? ''
          : `<thead><tr>${section.columns
              .map((col) => `<th>${escapeHtml(col.label)}</th>`)
              .join('')}</tr></thead>`;
      const body = section.rows
        .map(
          (row) =>
            `<tr>${section.columns
              .map((col) => `<td>${escapeHtml(formatValue(row[col.key], col.format))}</td>`)
              .join('')}</tr>`
        )
        .join('');
      const empty =
        section.rows.length === 0
          ? `<tr><td colspan="${Math.max(section.columns.length, 1)}" class="empty">No rows for this period</td></tr>`
          : '';
      return `<h6>${escapeHtml(section.title)}</h6><table>${head}<tbody>${body}${empty}</tbody></table>`;
    })
    .join('');

  const range =
    meta.range_start && meta.range_end
      ? `<div class="MuiTypography-caption">${escapeHtml(meta.range_start)} → ${escapeHtml(meta.range_end)}</div>`
      : '';

  return `<!DOCTYPE html>
<html>
  <head>
    <title>Report - ${escapeHtml(meta.title)}</title>
    <style>
      ${printStyles}
      .kpi-grid td { border: none; padding: 4px 16px 4px 0; }
      .kpi-label { color: #555; }
      .kpi-value { font-size: ${typography.px.sectionHeading}; font-weight: 600; }
      .empty { text-align: center; color: #777; padding: 16px; }
    </style>
  </head>
  <body>
    <div class="header">
      <h5>${escapeHtml(meta.title)}</h5>
      ${range}
    </div>
    ${kpiBlock}
    ${sections}
  </body>
</html>`;
};

/** Open the printable document in a new window and trigger the print dialog. */
export const printReportEnvelope = (envelope: ReportEnvelope): void => {
  const printWindow = window.open('', '', 'width=800,height=600');
  if (!printWindow) {
    window.print();
    return;
  }
  printWindow.document.write(envelopeToPrintHtml(envelope));
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
};

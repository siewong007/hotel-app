// Print / download helpers extracted from CustomerLedgerPage.
//
// These build standalone HTML documents (or read the already-rendered invoice
// DOM node) and print them via a hidden iframe — the iframe approach is used so
// printing works inside the Tauri desktop shell as well as the browser.
//
// Everything here is intentionally framework-free: callers pass in the data and
// formatting helpers they already hold, keeping the page component thin.

import type { CustomerLedger, Company } from '../../../../types';
import type { HotelSettings } from '../../../../utils/hotelSettings';
import { formatDateForDisplay } from './helpers';
import { formatHotelDate, formatHotelDateTime } from '../../../../utils/date';
import { isPositiveMoney, sumMoney, toMoneyNumber } from '../../../../utils/money';
import { statusLabel, t } from '../../../../i18n';
import { paperTokens } from '../../../../theme';

type FormatCurrency = (value: number) => string;

// Write an HTML string into a throwaway iframe and trigger the print dialog,
// then tear the iframe down once printing has had a chance to start.
function printHtmlViaIframe(htmlContent: string): void {
  const printFrame = document.createElement('iframe');
  printFrame.style.position = 'absolute';
  printFrame.style.top = '-10000px';
  printFrame.style.left = '-10000px';
  printFrame.style.width = '0';
  printFrame.style.height = '0';
  document.body.appendChild(printFrame);

  const frameDoc = printFrame.contentWindow?.document;
  if (frameDoc) {
    frameDoc.open();
    frameDoc.write(htmlContent);
    frameDoc.close();

    setTimeout(() => {
      printFrame.contentWindow?.print();
      setTimeout(() => {
        document.body.removeChild(printFrame);
      }, 1000);
    }, 250);
  }
}

// Print the on-screen company invoice by lifting its rendered markup into a
// print document with print-friendly CSS (including MUI element overrides).
export function printCompanyInvoice(invoiceNumber: string): void {
  const invoiceContent = document.getElementById('company-invoice-content');
  if (!invoiceContent) return;

  const printFrame = document.createElement('iframe');
  printFrame.style.position = 'absolute';
  printFrame.style.top = '-10000px';
  printFrame.style.left = '-10000px';
  printFrame.style.width = '0';
  printFrame.style.height = '0';
  document.body.appendChild(printFrame);

  const printDoc = printFrame.contentDocument || printFrame.contentWindow?.document;
  if (!printDoc) {
    document.body.removeChild(printFrame);
    return;
  }

  printDoc.open();
  printDoc.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>${t('finance:ledger.print.invoiceDocTitle', { number: invoiceNumber })}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: Arial, sans-serif; padding: 20px; color: ${paperTokens.text}; }
          .invoice-header, [class*="header"] { text-align: center; margin-bottom: 30px; border-bottom: 2px solid ${paperTokens.accent} !important; padding-bottom: 20px; }
          .invoice-header h1, [class*="header"] h4, [class*="header"] h5 { color: ${paperTokens.accentText}; font-size: 28px; margin-bottom: 5px; }
          .invoice-header p, [class*="header"] p { color: ${paperTokens.textSecondary}; font-size: 14px; }
          .invoice-meta { display: flex; justify-content: space-between; margin-bottom: 30px; }
          .invoice-meta div { flex: 1; }
          .invoice-meta h3 { font-size: 14px; color: ${paperTokens.accentText}; margin-bottom: 10px; text-transform: uppercase; }
          .invoice-meta p { font-size: 13px; margin: 5px 0; line-height: 1.6; }
          .invoice-meta .label { color: ${paperTokens.textSecondary}; display: inline-block; min-width: 120px; }
          .invoice-meta .value { font-weight: 600; color: ${paperTokens.text}; }
          /* MUI overrides for print */
          .MuiGrid-container { display: flex !important; flex-wrap: wrap !important; width: 100% !important; margin-bottom: 20px !important; }
          .MuiGrid-item { padding: 8px !important; }
          [class*="MuiGrid-grid-xs-6"] { flex: 0 0 50% !important; max-width: 50% !important; }
          [class*="MuiTypography-overline"] { font-size: 11px !important; text-transform: uppercase !important; letter-spacing: 1px !important; color: ${paperTokens.accentText} !important; font-weight: 600 !important; }
          table { width: 100%; border-collapse: collapse; margin: 20px 0; }
          th { background-color: ${paperTokens.accent} !important; color: ${paperTokens.onAccent} !important; padding: 12px; text-align: left; font-size: 13px; text-transform: uppercase; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          td { padding: 12px; border-bottom: 1px solid ${paperTokens.border}; font-size: 13px; }
          .amount, [class*="amount"] { text-align: right; font-weight: 600; }
          .total-row, tr:last-child { background-color: ${paperTokens.surfaceSunken} !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .total-row td { border-top: 3px double ${paperTokens.accent}; font-size: 16px; font-weight: 700; padding: 15px 12px; color: ${paperTokens.accentText}; }
          /* MUI Paper/Table overrides */
          .MuiPaper-root, .MuiTableContainer-root { box-shadow: none !important; border: 1px solid ${paperTokens.border} !important; border-radius: 0 !important; }
          .MuiTableHead-root .MuiTableRow-root { background-color: ${paperTokens.accent} !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .MuiTableHead-root .MuiTableCell-root { background-color: ${paperTokens.accent} !important; color: ${paperTokens.onAccent} !important; font-weight: 700 !important; text-transform: uppercase !important; font-size: 13px !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .MuiTableBody-root .MuiTableCell-root { padding: 12px !important; border-bottom: 1px solid ${paperTokens.border} !important; font-size: 13px !important; }
          .MuiDivider-root { border-color: ${paperTokens.border} !important; margin: 15px 0 !important; }
          .footer, [class*="footer"] { margin-top: 40px; text-align: center; padding-top: 20px; border-top: 1px solid ${paperTokens.border}; font-size: 12px; color: ${paperTokens.textSecondary}; }
          .footer strong { display: block; font-size: 14px; color: ${paperTokens.accentText}; margin-bottom: 5px; }
          /* Hide MUI visual-only elements */
          .MuiChip-root { display: none !important; }
          hr { border: none; border-top: 1px solid ${paperTokens.border}; margin: 15px 0; }
          @media print { body { padding: 0; } }
        </style>
      </head>
      <body>
        ${invoiceContent.innerHTML}
      </body>
    </html>
  `);
  printDoc.close();

  setTimeout(() => {
    printFrame.contentWindow?.focus();
    printFrame.contentWindow?.print();
    setTimeout(() => {
      document.body.removeChild(printFrame);
    }, 1000);
  }, 250);
}

// Build a self-contained invoice HTML document from the selected ledger rows and
// download it as an .html file (no DOM dependency, unlike printCompanyInvoice).
export function downloadCompanyInvoice(params: {
  invoiceNumber: string;
  hotelSettings: HotelSettings;
  invoiceCompany: Company | null;
  invoiceDate: string;
  invoiceDueDate: string;
  invoiceNotes: string;
  invoiceLedgerEntries: CustomerLedger[];
  selectedInvoiceLedgers: number[];
  selectedLedgerTotal: number;
  selectedLedgerBalanceDue: number;
  formatCurrency: FormatCurrency;
}): void {
  const {
    invoiceNumber,
    hotelSettings,
    invoiceCompany,
    invoiceDate,
    invoiceDueDate,
    invoiceNotes,
    invoiceLedgerEntries,
    selectedInvoiceLedgers,
    selectedLedgerTotal,
    selectedLedgerBalanceDue,
    formatCurrency,
  } = params;

  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>Invoice - ${invoiceNumber}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: Arial, sans-serif; padding: 30px; color: ${paperTokens.text}; max-width: 800px; margin: 0 auto; }
          .invoice-header { text-align: center; margin-bottom: 25px; padding-bottom: 15px; border-bottom: 3px solid ${paperTokens.accent}; }
          .invoice-header h1 { color: ${paperTokens.accentText}; font-size: 28px; margin-bottom: 4px; }
          .invoice-header p { color: ${paperTokens.textSecondary}; font-size: 13px; margin: 2px 0; }
          .title-bar { background-color: ${paperTokens.accent}; color: ${paperTokens.onAccent}; padding: 8px 16px; margin-bottom: 25px; display: flex; justify-content: space-between; align-items: center; }
          .title-bar h2 { font-size: 18px; letter-spacing: 2px; text-transform: uppercase; margin: 0; }
          .title-bar span { font-size: 15px; font-weight: 600; }
          .meta { display: flex; justify-content: space-between; margin-bottom: 25px; }
          .meta-left { flex: 1; }
          .meta-right { min-width: 220px; text-align: right; }
          .meta h3 { font-size: 11px; color: ${paperTokens.accentText}; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 8px; }
          .meta p { font-size: 13px; margin: 4px 0; line-height: 1.5; }
          .meta .label { color: ${paperTokens.textSecondary}; display: inline-block; min-width: 70px; }
          .meta .value { font-weight: 600; }
          .detail-row { display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 13px; }
          .detail-row .dlabel { color: ${paperTokens.textSecondary}; }
          .detail-row .dvalue { font-weight: 600; margin-left: 12px; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 0; border: 1px solid ${paperTokens.border}; }
          th { background-color: ${paperTokens.accent}; color: ${paperTokens.onAccent}; padding: 10px 12px; text-align: left; font-size: 12px; text-transform: uppercase; font-weight: 700; }
          th.right { text-align: right; }
          td { padding: 10px 12px; border-bottom: 1px solid ${paperTokens.borderSubtle}; font-size: 13px; }
          td.right { text-align: right; font-weight: 600; }
          tr.alt { background-color: ${paperTokens.surfaceSunken}; }
          tr.subtotal td { border-top: 2px solid ${paperTokens.border}; padding-top: 14px; font-weight: 600; }
          tr.total { background-color: ${paperTokens.surfaceSunken}; }
          tr.total td { border-top: 3px double ${paperTokens.accent}; font-size: 16px; font-weight: 700; color: ${paperTokens.accentText}; padding: 14px 12px; }
          .notes { margin-top: 25px; padding: 12px 16px; background: ${paperTokens.warningBg}; border-left: 4px solid ${paperTokens.warning}; }
          .notes strong { display: block; color: ${paperTokens.warning}; margin-bottom: 4px; font-size: 13px; }
          .notes p { color: ${paperTokens.warning}; font-size: 13px; white-space: pre-wrap; }
          .footer { margin-top: 40px; padding-top: 15px; border-top: 1px solid ${paperTokens.border}; text-align: center; }
          .footer .thanks { font-weight: 600; color: ${paperTokens.accentText}; font-size: 14px; margin-bottom: 4px; }
          .footer p { color: ${paperTokens.textSecondary}; font-size: 12px; margin: 3px 0; }
          .green { color: ${paperTokens.success}; }
          .red { color: ${paperTokens.danger}; }
          @media print { body { padding: 0; } }
        </style>
      </head>
      <body>
        <div class="invoice-header">
          <h1>${hotelSettings.hotel_name}</h1>
          <p>${hotelSettings.hotel_address}</p>
          <p>${t('common:field.phone')}: ${hotelSettings.hotel_phone} | ${t('common:field.email')}: ${hotelSettings.hotel_email}</p>
        </div>

        <div class="title-bar">
          <h2>${t('finance:ledger.invoice.docTitle')}</h2>
          <span>#${invoiceNumber}</span>
        </div>

        <div class="meta">
          <div class="meta-left">
            <h3>${t('finance:ledger.invoice.billTo')}</h3>
            <p><strong>${invoiceCompany?.company_name || ''}</strong></p>
            ${invoiceCompany?.registration_number ? `<p>${t('finance:ledger.invoice.regNo', { number: invoiceCompany.registration_number })}</p>` : ''}
            ${invoiceCompany?.billing_address ? `<p>${invoiceCompany.billing_address}</p>` : ''}
            ${[invoiceCompany?.billing_city, invoiceCompany?.billing_state, invoiceCompany?.billing_postal_code].filter(Boolean).length > 0
              ? `<p>${[invoiceCompany?.billing_city, invoiceCompany?.billing_state, invoiceCompany?.billing_postal_code].filter(Boolean).join(', ')}</p>` : ''}
            ${invoiceCompany?.contact_person ? `<p><span class="label">${t('finance:ledger.invoice.attn')}:</span> <span class="value">${invoiceCompany.contact_person}</span></p>` : ''}
            ${invoiceCompany?.contact_email ? `<p><span class="label">${t('common:field.email')}:</span> ${invoiceCompany.contact_email}</p>` : ''}
            ${invoiceCompany?.contact_phone ? `<p><span class="label">${t('common:field.phone')}:</span> ${invoiceCompany.contact_phone}</p>` : ''}
          </div>
          <div class="meta-right">
            <h3>${t('finance:ledger.invoice.docDetails')}</h3>
            <div class="detail-row"><span class="dlabel">${t('finance:ledger.field.invoiceDate')}:</span><span class="dvalue">${formatDateForDisplay(invoiceDate)}</span></div>
            <div class="detail-row"><span class="dlabel">${t('finance:ledger.field.dueDate')}:</span><span class="dvalue">${formatDateForDisplay(invoiceDueDate)}</span></div>
            <div class="detail-row"><span class="dlabel">${t('finance:ledger.invoice.terms')}:</span><span class="dvalue">${t('finance:ledger.print.termsDays', { days: invoiceCompany?.payment_terms_days || 30 })}</span></div>
            <div class="detail-row"><span class="dlabel">${t('common:field.status')}:</span><span class="dvalue ${isPositiveMoney(selectedLedgerBalanceDue) ? 'red' : 'green'}">${statusLabel(t, 'ledger', isPositiveMoney(selectedLedgerBalanceDue) ? 'outstanding' : 'settled')}</span></div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>${t('common:field.description')}</th>
              <th>${t('common:field.date')}</th>
              <th>${t('finance:ledger.field.room')}</th>
              <th class="right">${t('common:field.amount')}</th>
              <th class="right">${t('finance:ledger.col.paid')}</th>
              <th class="right">${t('finance:ledger.col.balance')}</th>
            </tr>
          </thead>
          <tbody>
            ${invoiceLedgerEntries
              .filter(l => selectedInvoiceLedgers.includes(l.id))
              .map((ledger, idx) => {
                const amount = toMoneyNumber(ledger.amount);
                const paidAmount = toMoneyNumber(ledger.paid_amount);
                const balanceDue = toMoneyNumber(ledger.balance_due);
                return `<tr class="${idx % 2 !== 0 ? 'alt' : ''}">
                  <td>${ledger.description}</td>
                  <td>${formatDateForDisplay(ledger.created_at)}</td>
                  <td>${ledger.room_number || '-'}</td>
                  <td class="right">${formatCurrency(amount)}</td>
                  <td class="right green">${isPositiveMoney(paidAmount) ? formatCurrency(paidAmount) : '-'}</td>
                  <td class="right ${isPositiveMoney(balanceDue) ? 'red' : 'green'}">${formatCurrency(balanceDue)}</td>
                </tr>`;
              }).join('')}
            <tr class="subtotal">
              <td colspan="3" style="text-align:right">${t('finance:ledger.invoice.subtotal')}:</td>
              <td class="right">${formatCurrency(selectedLedgerTotal)}</td>
              <td colspan="2"></td>
            </tr>
            <tr class="total">
              <td colspan="5" style="text-align:right">${t('finance:ledger.invoice.totalDue')}:</td>
              <td class="right">${formatCurrency(selectedLedgerBalanceDue)}</td>
            </tr>
          </tbody>
        </table>

        ${invoiceNotes ? `<div class="notes"><strong>${t('common:field.notes')}:</strong><p>${invoiceNotes}</p></div>` : ''}

        <div class="footer">
          <p class="thanks">${t('finance:ledger.invoice.thanks')}</p>
          <p>${t('finance:ledger.invoice.paymentTermsNote', { days: invoiceCompany?.payment_terms_days || 30 })}</p>
          <p>${t('finance:ledger.invoice.generated')} | ${hotelSettings.hotel_name}</p>
        </div>
      </body>
    </html>
  `;

  const blob = new Blob([htmlContent], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${t('finance:ledger.print.invoiceFileName', { number: invoiceNumber })}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Print a full statement for one company: every ledger row plus summary totals.
export function printCompanyStatement(params: {
  companyName: string;
  ledgers: CustomerLedger[];
  hotelSettings: HotelSettings;
  formatCurrency: FormatCurrency;
  onEmpty: () => void;
}): void {
  const { companyName, ledgers, hotelSettings, formatCurrency, onEmpty } = params;

  const entries = ledgers.filter(l => l.company_name === companyName);
  if (entries.length === 0) {
    onEmpty();
    return;
  }
  const totalAmount = entries.reduce((sum, e) => sumMoney([sum, e.amount]), 0);
  const totalPaid = entries.reduce((sum, e) => sumMoney([sum, e.paid_amount]), 0);
  const totalBalance = entries.reduce((sum, e) => sumMoney([sum, e.balance_due]), 0);

  const htmlContent = `
    <html>
      <head>
        <title>${t('finance:ledger.print.statementDocTitle', { company: companyName })}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; max-width: 800px; margin: 0 auto; }
          .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #333; padding-bottom: 20px; }
          .header h1 { margin: 0; color: #333; }
          .header h2 { margin: 10px 0 0; color: #666; font-weight: normal; }
          .company-info { margin-bottom: 20px; }
          .summary { display: flex; justify-content: space-between; margin-bottom: 20px; background: #f5f5f5; padding: 15px; border-radius: 4px; }
          .summary-item { text-align: center; }
          .summary-item .label { font-size: 12px; color: #666; }
          .summary-item .value { font-size: 18px; font-weight: bold; }
          table { border-collapse: collapse; width: 100%; margin-top: 20px; }
          th, td { border: 1px solid #ddd; padding: 10px; text-align: left; }
          th { background-color: #26a69a; color: white; }
          tr:nth-child(even) { background-color: #f9f9f9; }
          .text-right { text-align: right; }
          .status-paid { color: green; }
          .status-pending { color: orange; }
          .status-overdue { color: red; }
          .footer { margin-top: 30px; text-align: center; color: #666; font-size: 12px; }
          @media print { body { padding: 0; } }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>${hotelSettings.hotel_name}</h1>
          <h2>${t('finance:ledger.print.statementTitle')}</h2>
        </div>
        <div class="company-info">
          <h3>${companyName}</h3>
          <p>${t('finance:ledger.print.statementDate')} ${formatHotelDate(new Date())}</p>
        </div>
        <div class="summary">
          <div class="summary-item">
            <div class="label">${t('finance:ledger.print.totalEntries')}</div>
            <div class="value">${entries.length}</div>
          </div>
          <div class="summary-item">
            <div class="label">${t('finance:ledger.payment.totalAmount')}</div>
            <div class="value">${formatCurrency(totalAmount)}</div>
          </div>
          <div class="summary-item">
            <div class="label">${t('finance:ledger.print.totalPaid')}</div>
            <div class="value" style="color: green;">${formatCurrency(totalPaid)}</div>
          </div>
          <div class="summary-item">
            <div class="label">${t('finance:ledger.payment.balanceDue')}</div>
            <div class="value" style="color: ${isPositiveMoney(totalBalance) ? 'red' : 'green'};">${formatCurrency(totalBalance)}</div>
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th>${t('finance:ledger.field.invoiceNumber')}</th>
              <th>${t('common:field.date')}</th>
              <th>${t('bookings:details.checkIn')}</th>
              <th>${t('bookings:details.checkOut')}</th>
              <th>${t('common:field.description')}</th>
              <th>${t('common:field.type')}</th>
              <th class="text-right">${t('common:field.amount')}</th>
              <th class="text-right">${t('finance:ledger.col.paid')}</th>
              <th class="text-right">${t('finance:ledger.col.balance')}</th>
              <th>${t('common:field.status')}</th>
            </tr>
          </thead>
          <tbody>
            ${entries.map(entry => `
              <tr>
                <td>${entry.invoice_number || '-'}</td>
                <td>${formatDateForDisplay(entry.created_at)}</td>
                <td>${formatDateForDisplay(entry.check_in_date)}</td>
                <td>${formatDateForDisplay(entry.check_out_date)}</td>
                <td>${entry.description}</td>
                <td>${entry.expense_type}</td>
                <td class="text-right">${formatCurrency(toMoneyNumber(entry.amount))}</td>
                <td class="text-right">${formatCurrency(toMoneyNumber(entry.paid_amount))}</td>
                <td class="text-right">${formatCurrency(toMoneyNumber(entry.balance_due))}</td>
                <td class="status-${entry.status}">${statusLabel(t, 'ledger', entry.status)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <div class="footer">
          <p>${t('finance:ledger.print.generatedOn', { date: formatHotelDateTime(new Date()) })}</p>
          <p>${t('finance:ledger.print.appFooter', { hotel: hotelSettings.hotel_name })}</p>
        </div>
      </body>
    </html>
  `;

  printHtmlViaIframe(htmlContent);
}

// Print a single payment receipt for one ledger entry.
export function printSingleReceipt(params: {
  entry: CustomerLedger;
  hotelSettings: HotelSettings;
  formatCurrency: FormatCurrency;
}): void {
  const { entry, hotelSettings, formatCurrency } = params;

  const htmlContent = `
    <html>
      <head>
        <title>${t('finance:ledger.print.receiptDocTitle', { number: entry.invoice_number || entry.folio_number || `#${entry.id}` })}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; }
          .header { text-align: center; margin-bottom: 20px; border-bottom: 2px solid #333; padding-bottom: 15px; }
          .header h1 { margin: 0; color: #333; font-size: 24px; }
          .header h2 { margin: 5px 0 0; color: #666; font-weight: normal; font-size: 16px; }
          .receipt-info { margin-bottom: 20px; }
          .receipt-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
          .receipt-row .label { color: #666; font-weight: 500; }
          .receipt-row .value { font-weight: 600; }
          .amount-section { background: #f5f5f5; padding: 15px; border-radius: 4px; margin-top: 20px; }
          .amount-row { display: flex; justify-content: space-between; padding: 5px 0; }
          .amount-row.total { font-size: 18px; font-weight: bold; border-top: 2px solid #333; margin-top: 10px; padding-top: 10px; }
          .status { display: inline-block; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: bold; text-transform: uppercase; }
          .status-paid { background: #e8f5e9; color: #2e7d32; }
          .status-pending { background: #e3f2fd; color: #1565c0; }
          .status-partial { background: #fff3e0; color: #e65100; }
          .status-overdue { background: #ffebee; color: #c62828; }
          .footer { margin-top: 30px; text-align: center; color: #666; font-size: 12px; border-top: 1px solid #ddd; padding-top: 15px; }
          @media print { body { padding: 0; } }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>${hotelSettings.hotel_name}</h1>
          <h2>${t('finance:ledger.print.receiptTitle')}</h2>
        </div>
        <div class="receipt-info">
          <div class="receipt-row">
            <span class="label">${t('finance:ledger.print.receiptNumber')}</span>
            <span class="value">${entry.invoice_number || entry.folio_number || `#${entry.id}`}</span>
          </div>
          <div class="receipt-row">
            <span class="label">${t('finance:ledger.field.company')}</span>
            <span class="value">${entry.company_name}</span>
          </div>
          <div class="receipt-row">
            <span class="label">${t('common:field.description')}</span>
            <span class="value">${entry.description}</span>
          </div>
          <div class="receipt-row">
            <span class="label">${t('finance:ledger.field.expenseType')}</span>
            <span class="value">${entry.expense_type}</span>
          </div>
          <div class="receipt-row">
            <span class="label">${t('finance:ledger.print.dateCreated')}</span>
            <span class="value">${formatDateForDisplay(entry.created_at)}</span>
          </div>
          <div class="receipt-row">
            <span class="label">${t('finance:ledger.print.checkInDate')}</span>
            <span class="value">${formatDateForDisplay(entry.check_in_date)}</span>
          </div>
          <div class="receipt-row">
            <span class="label">${t('finance:ledger.print.checkOutDate')}</span>
            <span class="value">${formatDateForDisplay(entry.check_out_date)}</span>
          </div>
          ${entry.payment_date ? `
          <div class="receipt-row">
            <span class="label">${t('finance:ledger.payment.date')}</span>
            <span class="value">${formatDateForDisplay(entry.payment_date)}</span>
          </div>` : ''}
          ${entry.payment_method ? `
          <div class="receipt-row">
            <span class="label">${t('finance:ledger.payment.method')}</span>
            <span class="value">${entry.payment_method}</span>
          </div>` : ''}
          ${entry.payment_reference ? `
          <div class="receipt-row">
            <span class="label">${t('finance:ledger.payment.reference')}</span>
            <span class="value">${entry.payment_reference}</span>
          </div>` : ''}
          <div class="receipt-row">
            <span class="label">${t('common:field.status')}</span>
            <span class="value"><span class="status status-${entry.status}">${statusLabel(t, 'ledger', entry.status)}</span></span>
          </div>
        </div>
        <div class="amount-section">
          <div class="amount-row">
            <span>${t('finance:ledger.payment.totalAmount')}</span>
            <span>${formatCurrency(toMoneyNumber(entry.amount))}</span>
          </div>
          <div class="amount-row">
            <span>${t('finance:ledger.print.paidAmount')}</span>
            <span style="color: green;">${formatCurrency(toMoneyNumber(entry.paid_amount))}</span>
          </div>
          <div class="amount-row total">
            <span>${t('finance:ledger.payment.balanceDue')}</span>
            <span style="color: ${isPositiveMoney(entry.balance_due) ? 'red' : 'green'};">${formatCurrency(toMoneyNumber(entry.balance_due))}</span>
          </div>
        </div>
        ${entry.notes ? `<div style="margin-top: 15px;"><strong>${t('common:field.notes')}:</strong> ${entry.notes}</div>` : ''}
        <div class="footer">
          <p>${t('finance:ledger.print.generatedOn', { date: formatHotelDateTime(new Date()) })}</p>
          <p>${t('finance:ledger.print.appFooter', { hotel: hotelSettings.hotel_name })}</p>
        </div>
      </body>
    </html>
  `;

  printHtmlViaIframe(htmlContent);
}

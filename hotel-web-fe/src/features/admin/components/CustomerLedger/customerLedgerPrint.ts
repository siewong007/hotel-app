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
import { isPositiveMoney, sumMoney, toMoneyNumber } from '../../../../utils/money';

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
        <title>Invoice - ${invoiceNumber}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: Arial, sans-serif; padding: 20px; color: #333; }
          .invoice-header, [class*="header"] { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #1976d2 !important; padding-bottom: 20px; }
          .invoice-header h1, [class*="header"] h4, [class*="header"] h5 { color: #1976d2; font-size: 28px; margin-bottom: 5px; }
          .invoice-header p, [class*="header"] p { color: #666; font-size: 14px; }
          .invoice-meta { display: flex; justify-content: space-between; margin-bottom: 30px; }
          .invoice-meta div { flex: 1; }
          .invoice-meta h3 { font-size: 14px; color: #1976d2; margin-bottom: 10px; text-transform: uppercase; }
          .invoice-meta p { font-size: 13px; margin: 5px 0; line-height: 1.6; }
          .invoice-meta .label { color: #666; display: inline-block; min-width: 120px; }
          .invoice-meta .value { font-weight: 600; color: #333; }
          /* MUI overrides for print */
          .MuiGrid-container { display: flex !important; flex-wrap: wrap !important; width: 100% !important; margin-bottom: 20px !important; }
          .MuiGrid-item { padding: 8px !important; }
          [class*="MuiGrid-grid-xs-6"] { flex: 0 0 50% !important; max-width: 50% !important; }
          [class*="MuiTypography-overline"] { font-size: 11px !important; text-transform: uppercase !important; letter-spacing: 1px !important; color: #1976d2 !important; font-weight: 600 !important; }
          table { width: 100%; border-collapse: collapse; margin: 20px 0; }
          th { background-color: #1976d2 !important; color: white !important; padding: 12px; text-align: left; font-size: 13px; text-transform: uppercase; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          td { padding: 12px; border-bottom: 1px solid #ddd; font-size: 13px; }
          .amount, [class*="amount"] { text-align: right; font-weight: 600; }
          .total-row, tr:last-child { background-color: #f5f5f5 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .total-row td { border-top: 3px double #1976d2; font-size: 16px; font-weight: 700; padding: 15px 12px; color: #1976d2; }
          /* MUI Paper/Table overrides */
          .MuiPaper-root, .MuiTableContainer-root { box-shadow: none !important; border: 1px solid #ddd !important; border-radius: 0 !important; }
          .MuiTableHead-root .MuiTableRow-root { background-color: #1976d2 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .MuiTableHead-root .MuiTableCell-root { background-color: #1976d2 !important; color: white !important; font-weight: 700 !important; text-transform: uppercase !important; font-size: 13px !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .MuiTableBody-root .MuiTableCell-root { padding: 12px !important; border-bottom: 1px solid #ddd !important; font-size: 13px !important; }
          .MuiDivider-root { border-color: #ddd !important; margin: 15px 0 !important; }
          .footer, [class*="footer"] { margin-top: 40px; text-align: center; padding-top: 20px; border-top: 1px solid #ddd; font-size: 12px; color: #666; }
          .footer strong { display: block; font-size: 14px; color: #1976d2; margin-bottom: 5px; }
          /* Hide MUI visual-only elements */
          .MuiChip-root { display: none !important; }
          hr { border: none; border-top: 1px solid #ddd; margin: 15px 0; }
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
          body { font-family: Arial, sans-serif; padding: 30px; color: #333; max-width: 800px; margin: 0 auto; }
          .invoice-header { text-align: center; margin-bottom: 25px; padding-bottom: 15px; border-bottom: 3px solid #1976d2; }
          .invoice-header h1 { color: #1976d2; font-size: 28px; margin-bottom: 4px; }
          .invoice-header p { color: #666; font-size: 13px; margin: 2px 0; }
          .title-bar { background-color: #1976d2; color: white; padding: 8px 16px; margin-bottom: 25px; display: flex; justify-content: space-between; align-items: center; }
          .title-bar h2 { font-size: 18px; letter-spacing: 2px; text-transform: uppercase; margin: 0; }
          .title-bar span { font-size: 15px; font-weight: 600; }
          .meta { display: flex; justify-content: space-between; margin-bottom: 25px; }
          .meta-left { flex: 1; }
          .meta-right { min-width: 220px; text-align: right; }
          .meta h3 { font-size: 11px; color: #1976d2; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 8px; }
          .meta p { font-size: 13px; margin: 4px 0; line-height: 1.5; }
          .meta .label { color: #666; display: inline-block; min-width: 70px; }
          .meta .value { font-weight: 600; }
          .detail-row { display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 13px; }
          .detail-row .dlabel { color: #666; }
          .detail-row .dvalue { font-weight: 600; margin-left: 12px; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 0; border: 1px solid #ddd; }
          th { background-color: #1976d2; color: white; padding: 10px 12px; text-align: left; font-size: 12px; text-transform: uppercase; font-weight: 700; }
          th.right { text-align: right; }
          td { padding: 10px 12px; border-bottom: 1px solid #eee; font-size: 13px; }
          td.right { text-align: right; font-weight: 600; }
          tr.alt { background-color: #fafafa; }
          tr.subtotal td { border-top: 2px solid #ddd; padding-top: 14px; font-weight: 600; }
          tr.total { background-color: #f5f5f5; }
          tr.total td { border-top: 3px double #1976d2; font-size: 16px; font-weight: 700; color: #1976d2; padding: 14px 12px; }
          .notes { margin-top: 25px; padding: 12px 16px; background: #fff3cd; border-left: 4px solid #ffc107; }
          .notes strong { display: block; color: #856404; margin-bottom: 4px; font-size: 13px; }
          .notes p { color: #856404; font-size: 13px; white-space: pre-wrap; }
          .footer { margin-top: 40px; padding-top: 15px; border-top: 1px solid #ddd; text-align: center; }
          .footer .thanks { font-weight: 600; color: #1976d2; font-size: 14px; margin-bottom: 4px; }
          .footer p { color: #666; font-size: 12px; margin: 3px 0; }
          .green { color: #2e7d32; }
          .red { color: #d32f2f; }
          @media print { body { padding: 0; } }
        </style>
      </head>
      <body>
        <div class="invoice-header">
          <h1>${hotelSettings.hotel_name}</h1>
          <p>${hotelSettings.hotel_address}</p>
          <p>Phone: ${hotelSettings.hotel_phone} | Email: ${hotelSettings.hotel_email}</p>
        </div>

        <div class="title-bar">
          <h2>Invoice</h2>
          <span>#${invoiceNumber}</span>
        </div>

        <div class="meta">
          <div class="meta-left">
            <h3>Bill To</h3>
            <p><strong>${invoiceCompany?.company_name || ''}</strong></p>
            ${invoiceCompany?.registration_number ? `<p>Reg No: ${invoiceCompany.registration_number}</p>` : ''}
            ${invoiceCompany?.billing_address ? `<p>${invoiceCompany.billing_address}</p>` : ''}
            ${[invoiceCompany?.billing_city, invoiceCompany?.billing_state, invoiceCompany?.billing_postal_code].filter(Boolean).length > 0
              ? `<p>${[invoiceCompany?.billing_city, invoiceCompany?.billing_state, invoiceCompany?.billing_postal_code].filter(Boolean).join(', ')}</p>` : ''}
            ${invoiceCompany?.contact_person ? `<p><span class="label">Attn:</span> <span class="value">${invoiceCompany.contact_person}</span></p>` : ''}
            ${invoiceCompany?.contact_email ? `<p><span class="label">Email:</span> ${invoiceCompany.contact_email}</p>` : ''}
            ${invoiceCompany?.contact_phone ? `<p><span class="label">Phone:</span> ${invoiceCompany.contact_phone}</p>` : ''}
          </div>
          <div class="meta-right">
            <h3>Invoice Details</h3>
            <div class="detail-row"><span class="dlabel">Invoice Date:</span><span class="dvalue">${formatDateForDisplay(invoiceDate)}</span></div>
            <div class="detail-row"><span class="dlabel">Due Date:</span><span class="dvalue">${formatDateForDisplay(invoiceDueDate)}</span></div>
            <div class="detail-row"><span class="dlabel">Terms:</span><span class="dvalue">${invoiceCompany?.payment_terms_days || 30} days</span></div>
            <div class="detail-row"><span class="dlabel">Status:</span><span class="dvalue ${isPositiveMoney(selectedLedgerBalanceDue) ? 'red' : 'green'}">${isPositiveMoney(selectedLedgerBalanceDue) ? 'Outstanding' : 'Settled'}</span></div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Description</th>
              <th>Date</th>
              <th>Room</th>
              <th class="right">Amount</th>
              <th class="right">Paid</th>
              <th class="right">Balance</th>
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
              <td colspan="3" style="text-align:right">Subtotal:</td>
              <td class="right">${formatCurrency(selectedLedgerTotal)}</td>
              <td colspan="2"></td>
            </tr>
            <tr class="total">
              <td colspan="5" style="text-align:right">Total Amount Due:</td>
              <td class="right">${formatCurrency(selectedLedgerBalanceDue)}</td>
            </tr>
          </tbody>
        </table>

        ${invoiceNotes ? `<div class="notes"><strong>Notes:</strong><p>${invoiceNotes}</p></div>` : ''}

        <div class="footer">
          <p class="thanks">Thank you for your business!</p>
          <p>Please make payment within ${invoiceCompany?.payment_terms_days || 30} days of invoice date.</p>
          <p>This is a computer-generated invoice. | ${hotelSettings.hotel_name}</p>
        </div>
      </body>
    </html>
  `;

  const blob = new Blob([htmlContent], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Invoice-${invoiceNumber}.html`;
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
        <title>Company Ledger Statement - ${companyName}</title>
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
          <h2>Company Ledger Statement</h2>
        </div>
        <div class="company-info">
          <h3>${companyName}</h3>
          <p>Statement Date: ${new Date().toLocaleDateString()}</p>
        </div>
        <div class="summary">
          <div class="summary-item">
            <div class="label">Total Entries</div>
            <div class="value">${entries.length}</div>
          </div>
          <div class="summary-item">
            <div class="label">Total Amount</div>
            <div class="value">${formatCurrency(totalAmount)}</div>
          </div>
          <div class="summary-item">
            <div class="label">Total Paid</div>
            <div class="value" style="color: green;">${formatCurrency(totalPaid)}</div>
          </div>
          <div class="summary-item">
            <div class="label">Balance Due</div>
            <div class="value" style="color: ${isPositiveMoney(totalBalance) ? 'red' : 'green'};">${formatCurrency(totalBalance)}</div>
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Invoice #</th>
              <th>Date</th>
              <th>Description</th>
              <th>Type</th>
              <th class="text-right">Amount</th>
              <th class="text-right">Paid</th>
              <th class="text-right">Balance</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${entries.map(entry => `
              <tr>
                <td>${entry.invoice_number || '-'}</td>
                <td>${new Date(entry.created_at).toLocaleDateString()}</td>
                <td>${entry.description}</td>
                <td>${entry.expense_type}</td>
                <td class="text-right">${formatCurrency(toMoneyNumber(entry.amount))}</td>
                <td class="text-right">${formatCurrency(toMoneyNumber(entry.paid_amount))}</td>
                <td class="text-right">${formatCurrency(toMoneyNumber(entry.balance_due))}</td>
                <td class="status-${entry.status}">${entry.status.toUpperCase()}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <div class="footer">
          <p>Generated on ${new Date().toLocaleString()}</p>
          <p>${hotelSettings.hotel_name} - Hotel Management System</p>
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
        <title>Receipt - ${entry.invoice_number || entry.folio_number || `#${entry.id}`}</title>
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
          <h2>Payment Receipt</h2>
        </div>
        <div class="receipt-info">
          <div class="receipt-row">
            <span class="label">Receipt / Invoice #</span>
            <span class="value">${entry.invoice_number || entry.folio_number || `#${entry.id}`}</span>
          </div>
          <div class="receipt-row">
            <span class="label">Company</span>
            <span class="value">${entry.company_name}</span>
          </div>
          <div class="receipt-row">
            <span class="label">Description</span>
            <span class="value">${entry.description}</span>
          </div>
          <div class="receipt-row">
            <span class="label">Expense Type</span>
            <span class="value">${entry.expense_type}</span>
          </div>
          <div class="receipt-row">
            <span class="label">Date Created</span>
            <span class="value">${new Date(entry.created_at).toLocaleDateString()}</span>
          </div>
          ${entry.payment_date ? `
          <div class="receipt-row">
            <span class="label">Payment Date</span>
            <span class="value">${new Date(entry.payment_date).toLocaleDateString()}</span>
          </div>` : ''}
          ${entry.payment_method ? `
          <div class="receipt-row">
            <span class="label">Payment Method</span>
            <span class="value">${entry.payment_method}</span>
          </div>` : ''}
          ${entry.payment_reference ? `
          <div class="receipt-row">
            <span class="label">Payment Reference</span>
            <span class="value">${entry.payment_reference}</span>
          </div>` : ''}
          <div class="receipt-row">
            <span class="label">Status</span>
            <span class="value"><span class="status status-${entry.status}">${entry.status}</span></span>
          </div>
        </div>
        <div class="amount-section">
          <div class="amount-row">
            <span>Total Amount</span>
            <span>${formatCurrency(toMoneyNumber(entry.amount))}</span>
          </div>
          <div class="amount-row">
            <span>Paid Amount</span>
            <span style="color: green;">${formatCurrency(toMoneyNumber(entry.paid_amount))}</span>
          </div>
          <div class="amount-row total">
            <span>Balance Due</span>
            <span style="color: ${isPositiveMoney(entry.balance_due) ? 'red' : 'green'};">${formatCurrency(toMoneyNumber(entry.balance_due))}</span>
          </div>
        </div>
        ${entry.notes ? `<div style="margin-top: 15px;"><strong>Notes:</strong> ${entry.notes}</div>` : ''}
        <div class="footer">
          <p>Generated on ${new Date().toLocaleString()}</p>
          <p>${hotelSettings.hotel_name} - Hotel Management System</p>
        </div>
      </body>
    </html>
  `;

  printHtmlViaIframe(htmlContent);
}

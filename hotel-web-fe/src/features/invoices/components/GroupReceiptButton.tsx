import React, { useState } from 'react';
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material';
import { Print as PrintIcon, ReceiptLong as ReceiptIcon } from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import { fetchBookingGroup } from '../../bookings/components/Bookings/BookingGroupSection';
import { fetchGroupReceipt, type GroupReceipt } from '../api/groupReceipt';
import { useTranslation } from '../../../i18n';
import { useCurrency } from '../../../hooks/useCurrency';
import { formatHotelDate } from '../../../utils/date';
import { toMoneyNumber } from '../../../utils/money';
import { paperTokens } from '../../../theme';
import type { HotelSettings } from '../../../utils/hotelSettings';

const esc = (value: unknown) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Print the combined receipt in the same paper style as the per-room invoice. */
function printGroupReceipt(html: string, title: string) {
  const frame = document.createElement('iframe');
  Object.assign(frame.style, { position: 'absolute', top: '-10000px', left: '-10000px', width: '0', height: '0' });
  document.body.appendChild(frame);
  const doc = frame.contentDocument || frame.contentWindow?.document;
  if (!doc) {
    document.body.removeChild(frame);
    return;
  }
  doc.open();
  doc.write(`<!DOCTYPE html><html><head><title>${esc(title)}</title><style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, sans-serif; padding: 20px; color: ${paperTokens.text}; }
    .invoice-header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid ${paperTokens.accent}; padding-bottom: 20px; }
    .invoice-header h1 { color: ${paperTokens.accentText}; font-size: 28px; margin-bottom: 5px; }
    .invoice-header p { color: ${paperTokens.textSecondary}; font-size: 14px; }
    .invoice-meta { display: flex; justify-content: space-between; margin-bottom: 30px; }
    .invoice-meta div { flex: 1; }
    .invoice-meta h3 { font-size: 14px; color: ${paperTokens.accentText}; margin-bottom: 10px; text-transform: uppercase; }
    .invoice-meta p { font-size: 13px; margin: 5px 0; line-height: 1.6; }
    .label { color: ${paperTokens.textSecondary}; display: inline-block; min-width: 120px; }
    .value { font-weight: 600; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 13px; }
    th { background-color: ${paperTokens.accent}; color: ${paperTokens.onAccent}; padding: 10px; text-align: left; }
    td { padding: 10px; border-bottom: 1px solid ${paperTokens.border}; }
    .num { text-align: right; }
    tfoot td { font-weight: 700; font-size: 15px; border-top: 2px solid ${paperTokens.accent}; }
    @media print { body { padding: 0; } }
  </style></head><body>${html}</body></html>`);
  doc.close();
  setTimeout(() => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => document.body.removeChild(frame), 1000);
  }, 250);
}

interface Props {
  bookingId: number;
  hotelSettings: HotelSettings;
}

/**
 * "Group receipt" action for a room that belongs to a multi-room booking:
 * one document listing every room's invoice with a single grand total.
 * Renders nothing for a single-room booking.
 */
const GroupReceiptButton: React.FC<Props> = ({ bookingId, hotelSettings }) => {
  const { t } = useTranslation('finance');
  const { format: formatCurrency } = useCurrency();
  const [open, setOpen] = useState(false);
  const groupQuery = useQuery({
    queryKey: ['bookings', 'group', bookingId],
    queryFn: () => fetchBookingGroup(bookingId),
    staleTime: 60_000,
  });
  const groupId = groupQuery.data?.group?.id;
  const receiptQuery = useQuery({
    queryKey: ['booking-groups', groupId, 'receipt'],
    queryFn: () => fetchGroupReceipt(groupId as number),
    enabled: open && groupId != null,
  });
  if (groupId == null) return null;

  const money = (v: string | number) => formatCurrency(toMoneyNumber(v));
  const receipt = receiptQuery.data;

  const buildPrintHtml = (r: GroupReceipt) => {
    const rows = r.rooms.map((room) => `<tr>
      <td>${esc(room.invoice_number)}</td>
      <td>${esc(room.room_number ?? '')}${room.room_type ? ` - ${esc(room.room_type)}` : ''}</td>
      <td>${esc(formatHotelDate(room.check_in_date))} – ${esc(formatHotelDate(room.check_out_date))}</td>
      <td class="num">${room.nights}</td>
      <td class="num">${esc(money(room.room_total))}</td>
      <td class="num">${esc(money(room.tourism_tax_amount))}</td>
      <td class="num">${esc(money(room.extra_bed_charge))}</td>
      <td class="num">${esc(money(room.total))}</td></tr>`).join('');
    return `<div class="invoice-header"><h1>${esc(hotelSettings.hotel_name)}</h1>
      <p>${esc(hotelSettings.hotel_address)}</p>
      <p>${esc(t('checkout.phoneEmail', { phone: hotelSettings.hotel_phone, email: hotelSettings.hotel_email }))}</p></div>
      <div class="invoice-meta"><div><h3>${esc(t('groupReceipt.title'))}</h3>
        <p><span class="label">${esc(t('groupReceipt.groupNumber'))}:</span><span class="value">${esc(r.group_number)}</span></p>
        <p><span class="label">${esc(t('common:field.date'))}:</span><span class="value">${esc(formatHotelDate(new Date()))}</span></p>
        ${r.group_payment_ref ? `<p><span class="label">${esc(t('groupReceipt.paymentRef'))}:</span><span class="value">${esc(r.group_payment_ref)}</span></p>` : ''}
      </div><div><h3>${esc(t('checkout.guestInfo'))}</h3>
        <p><span class="label">${esc(t('common:field.name'))}:</span><span class="value">${esc(r.guest_name ?? '')}</span></p>
        <p><span class="label">${esc(t('groupReceipt.rooms'))}:</span><span class="value">${r.rooms.length}</span></p>
      </div></div>
      <table><thead><tr><th>${esc(t('checkout.field.invoiceNumber'))}</th><th>${esc(t('ledger.field.room'))}</th>
        <th>${esc(t('groupReceipt.dates'))}</th><th class="num">${esc(t('groupReceipt.nights'))}</th>
        <th class="num">${esc(t('groupReceipt.roomCharges'))}</th><th class="num">${esc(t('groupReceipt.tourismTax'))}</th>
        <th class="num">${esc(t('groupReceipt.extraBeds'))}</th><th class="num">${esc(t('groupReceipt.total'))}</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="7">${esc(t('groupReceipt.grandTotal'))}</td><td class="num">${esc(money(r.grand_total))}</td></tr></tfoot></table>`;
  };

  return (
    <>
      <Button variant="outlined" startIcon={<ReceiptIcon />} onClick={() => setOpen(true)} data-testid="group-receipt-button">
        {t('groupReceipt.button')}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          {t('groupReceipt.title')}
          {receipt && (
            <Typography variant="body2" color="text.secondary">
              {t('groupReceipt.groupNumber')}: {receipt.group_number}
              {receipt.group_payment_ref ? ` · ${t('groupReceipt.paymentRef')}: ${receipt.group_payment_ref}` : ''}
            </Typography>
          )}
        </DialogTitle>
        <DialogContent dividers>
          {receiptQuery.isLoading && <Box sx={{ textAlign: 'center', py: 3 }}><CircularProgress size={28} /></Box>}
          {receiptQuery.isError && <Alert severity="error">{t('groupReceipt.loadFailed')}</Alert>}
          {receipt && (
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small" data-testid="group-receipt-table">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('checkout.field.invoiceNumber')}</TableCell>
                    <TableCell>{t('ledger.field.room')}</TableCell>
                    <TableCell>{t('groupReceipt.dates')}</TableCell>
                    <TableCell align="right">{t('groupReceipt.nights')}</TableCell>
                    <TableCell align="right">{t('groupReceipt.roomCharges')}</TableCell>
                    <TableCell align="right">{t('groupReceipt.tourismTax')}</TableCell>
                    <TableCell align="right">{t('groupReceipt.extraBeds')}</TableCell>
                    <TableCell align="right">{t('groupReceipt.total')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {receipt.rooms.map((room) => (
                    <TableRow key={room.booking_id}>
                      <TableCell>{room.invoice_number}</TableCell>
                      <TableCell>{room.room_number}{room.room_type ? ` - ${room.room_type}` : ''}</TableCell>
                      <TableCell>{formatHotelDate(room.check_in_date)} – {formatHotelDate(room.check_out_date)}</TableCell>
                      <TableCell align="right">{room.nights}</TableCell>
                      <TableCell align="right">{money(room.room_total)}</TableCell>
                      <TableCell align="right">{money(room.tourism_tax_amount)}</TableCell>
                      <TableCell align="right">{money(room.extra_bed_charge)}</TableCell>
                      <TableCell align="right">{money(room.total)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell colSpan={7} sx={{ fontWeight: 700 }}>{t('groupReceipt.grandTotal')}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }} data-testid="group-receipt-grand-total">
                      {money(receipt.grand_total)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>{t('common:actions.close')}</Button>
          <Button
            variant="contained"
            startIcon={<PrintIcon />}
            disabled={!receipt}
            onClick={() => receipt && printGroupReceipt(buildPrintHtml(receipt), `${t('groupReceipt.title')} - ${receipt.group_number}`)}
          >{t('groupReceipt.print')}</Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default GroupReceiptButton;

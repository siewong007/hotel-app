import { api } from '../../../api/client';

export interface GroupReceiptRow {
  booking_id: number;
  booking_number?: string | null;
  invoice_number: string;
  room_number?: string | null;
  room_type?: string | null;
  check_in_date: string;
  check_out_date: string;
  nights: number;
  room_total: string | number;
  tourism_tax_amount: string | number;
  extra_bed_count: number;
  extra_bed_charge: string | number;
  total: string | number;
}

export interface GroupReceipt {
  booking_group_id: number;
  group_number: string;
  guest_id: number;
  guest_name?: string | null;
  check_in_date: string;
  check_out_date: string;
  currency: string;
  payment_status: string;
  group_payment_ref?: string | null;
  rooms: GroupReceiptRow[];
  room_total: string | number;
  tourism_tax_amount: string | number;
  extra_bed_charge: string | number;
  grand_total: string | number;
}

/** Combined receipt for a multi-room booking group (per-room invoices are unchanged). */
export async function fetchGroupReceipt(groupId: number): Promise<GroupReceipt> {
  return await api.get(`booking-groups/${groupId}/receipt`).json<GroupReceipt>();
}

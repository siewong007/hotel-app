import { api } from '../../api/client';
import type { CellUpdateInput, OnlineInventoryAllocation } from './types';

export const getOnlineInventoryRange = (from: string, to: string) =>
  api
    .get('admin/online-inventory', { searchParams: { from, to } })
    .json<OnlineInventoryAllocation[]>();

export const bulkUpdateOnlineInventory = (cells: CellUpdateInput[]) =>
  api
    .put('admin/online-inventory/bulk', { json: { cells } })
    .json<OnlineInventoryAllocation[]>();

// --- Compatibility shims for the legacy single-date page; removed with it ---

export const getOnlineInventory = (stayDate: string) =>
  getOnlineInventoryRange(stayDate, stayDate);

export const updateOnlineInventory = (
  roomTypeId: number,
  stayDate: string,
  input: {
    walk_in_reserved_rooms: number;
    online_booking_enabled: boolean;
    custom_price: string | null;
  },
) =>
  api
    .put(`admin/online-inventory/${roomTypeId}/${stayDate}`, { json: input })
    .json<OnlineInventoryAllocation>();

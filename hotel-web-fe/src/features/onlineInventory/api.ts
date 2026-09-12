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


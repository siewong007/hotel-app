import { api } from '../../api/client';
import { SKIP_API_NOTIFICATION_HEADER } from '../../utils/apiNotifications';
import type { CellUpdateInput, OnlineInventoryAllocation } from './types';

export const getOnlineInventoryRange = (from: string, to: string) =>
  api
    .get('admin/online-inventory', { searchParams: { from, to } })
    .json<OnlineInventoryAllocation[]>();

export const bulkUpdateOnlineInventory = (cells: CellUpdateInput[]) =>
  api
    // The page renders save failures inline (including the 409 conflict
    // banner with its Reload action), so skip the duplicate global toast.
    .put('admin/online-inventory/bulk', {
      json: { cells },
      headers: { [SKIP_API_NOTIFICATION_HEADER]: 'true' },
    })
    .json<OnlineInventoryAllocation[]>();


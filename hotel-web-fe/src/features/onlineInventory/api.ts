import { api } from '../../api/client';
import type { OnlineInventoryAllocation, UpdateOnlineInventoryInput } from './types';

export const getOnlineInventory = (stayDate: string) =>
  api
    .get('admin/online-inventory', { searchParams: { stay_date: stayDate } })
    .json<OnlineInventoryAllocation[]>();

export const updateOnlineInventory = (
  roomTypeId: number,
  stayDate: string,
  input: UpdateOnlineInventoryInput,
) =>
  api
    .put(`admin/online-inventory/${roomTypeId}/${stayDate}`, { json: input })
    .json<OnlineInventoryAllocation>();

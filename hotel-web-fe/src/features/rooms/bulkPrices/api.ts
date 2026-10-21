import { api } from '../../../api/client';
import type {
  BulkPricePreview,
  BulkPriceRequest,
  BulkPriceResult,
  LastBulkPriceChange,
} from './types';

export const previewBulkPrices = (input: BulkPriceRequest) =>
  api.post('room-type-prices/bulk-preview', { json: input }).json<BulkPricePreview>();

export const applyBulkPrices = (input: BulkPriceRequest) =>
  api.post('room-type-prices/bulk-update', { json: input }).json<BulkPriceResult>();

export const revertBulkPrices = (reason: string) =>
  api
    .post('room-type-prices/bulk-revert', { json: { reason } })
    .json<LastBulkPriceChange>();

export const getLastBulkPriceChange = () =>
  api.get('room-type-prices/last-bulk-update').json<LastBulkPriceChange | null>();

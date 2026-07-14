import { api } from '../../../api/client';
import type {
  Promotion,
  PromotionInput,
  PromotionLifecycleAction,
  PromotionLifecycleInput,
  PromotionListParams,
  PromotionListResponse,
  PromotionUpdateInput,
  Voucher,
  VoucherIssueInput,
  VoucherListParams,
  VoucherListResponse,
  VoucherRevokeInput,
} from '../types';

function toSearchParams(
  values?: PromotionListParams | VoucherListParams
): URLSearchParams | undefined {
  if (!values) return undefined;
  const searchParams = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      searchParams.set(key, String(value));
    }
  });
  return searchParams;
}

export const PromotionsApi = {
  listPublic(params?: PromotionListParams): Promise<PromotionListResponse> {
    return api
      .get('promotions', { searchParams: toSearchParams(params) })
      .json<PromotionListResponse>();
  },

  listAdmin(params?: PromotionListParams): Promise<PromotionListResponse> {
    return api
      .get('admin/promotions', { searchParams: toSearchParams(params) })
      .json<PromotionListResponse>();
  },

  create(input: PromotionInput): Promise<Promotion> {
    return api.post('admin/promotions', { json: input }).json<Promotion>();
  },

  update(promotionId: number, input: PromotionUpdateInput): Promise<Promotion> {
    return api
      .patch(`admin/promotions/${promotionId}`, { json: input })
      .json<Promotion>();
  },

  transition(
    promotionId: number,
    action: PromotionLifecycleAction,
    input: PromotionLifecycleInput = {}
  ): Promise<Promotion> {
    return api
      .post(`admin/promotions/${promotionId}/${action}`, { json: input })
      .json<Promotion>();
  },

  listVouchers(params?: VoucherListParams): Promise<VoucherListResponse> {
    return api
      .get('admin/vouchers', { searchParams: toSearchParams(params) })
      .json<VoucherListResponse>();
  },

  issueVoucher(input: VoucherIssueInput): Promise<Voucher> {
    return api.post('admin/vouchers', { json: input }).json<Voucher>();
  },

  revokeVoucher(voucherId: number, input: VoucherRevokeInput = {}): Promise<Voucher> {
    return api
      .post(`admin/vouchers/${voucherId}/revoke`, { json: input })
      .json<Voucher>();
  },
};

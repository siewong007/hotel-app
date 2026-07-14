import { api } from '../../../api/client';
import { getPortalToken } from '../../guestPortal/api/portalTokenStore';
import type {
  ClaimPromotionInput,
  GuestPromotionListResponse,
  PromotionListParams,
  Voucher,
  VoucherListParams,
  VoucherListResponse,
} from '../types';

function authHeaders(token?: string): Record<string, string> {
  const portalToken = token ?? getPortalToken();
  if (!portalToken) {
    throw new Error('Sign in to the guest portal to continue');
  }
  return { Authorization: `Bearer ${portalToken}` };
}

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

export const PortalPromotionsApi = {
  listPromotions(
    params?: PromotionListParams,
    token?: string
  ): Promise<GuestPromotionListResponse> {
    return api
      .get('guest-portal/me/promotions', {
        headers: authHeaders(token),
        searchParams: toSearchParams(params),
      })
      .json<GuestPromotionListResponse>();
  },

  claim(
    promotionId: number,
    input: ClaimPromotionInput,
    token?: string
  ): Promise<Voucher> {
    return api
      .post(`guest-portal/me/promotions/${promotionId}/claim`, {
        headers: authHeaders(token),
        json: input,
      })
      .json<Voucher>();
  },

  listVouchers(
    params?: VoucherListParams,
    token?: string
  ): Promise<VoucherListResponse> {
    return api
      .get('guest-portal/me/vouchers', {
        headers: authHeaders(token),
        searchParams: toSearchParams(params),
      })
      .json<VoucherListResponse>();
  },
};

import { api } from '../../api/client';
import type {
  BookingChannel,
  BookingChannelInput,
  BookingChannelUpdate,
  ChannelCommissionRule,
  ChannelCommissionRuleInput,
  ChannelMappings,
  ChannelMatrix,
  ChannelPricePreview,
  ChannelPricePreviewRequest,
  ChannelPricingRule,
  ChannelPricingRuleInput,
  ChannelRatePlanMapping,
  ChannelRatePlanMappingInput,
  ChannelRoomTypeMapping,
  ChannelRoomTypeMappingInput,
  PricingRuleResponse,
} from './types';

/** All payloads arrive unwrapped — handlers return the object directly. */
export const ChannelsApi = {
  list(): Promise<BookingChannel[]> {
    return api.get('booking-channels').json<BookingChannel[]>();
  },

  create(input: BookingChannelInput): Promise<BookingChannel> {
    return api.post('booking-channels', { json: input }).json<BookingChannel>();
  },

  update(id: number, input: BookingChannelUpdate): Promise<BookingChannel> {
    return api
      .put(`booking-channels/${id}`, { json: input })
      .json<BookingChannel>();
  },

  deactivate(id: number): Promise<BookingChannel> {
    return api.delete(`booking-channels/${id}`).json<BookingChannel>();
  },

  pricingRules(channelId: number): Promise<ChannelPricingRule[]> {
    return api
      .get(`booking-channels/${channelId}/pricing-rules`)
      .json<ChannelPricingRule[]>();
  },

  createPricingRule(
    channelId: number,
    input: ChannelPricingRuleInput,
  ): Promise<PricingRuleResponse> {
    return api
      .post(`booking-channels/${channelId}/pricing-rules`, { json: input })
      .json<PricingRuleResponse>();
  },

  updatePricingRule(
    id: number,
    input: Partial<ChannelPricingRuleInput>,
  ): Promise<PricingRuleResponse> {
    return api
      .patch(`channel-pricing-rules/${id}`, { json: input })
      .json<PricingRuleResponse>();
  },

  deletePricingRule(id: number): Promise<void> {
    return api.delete(`channel-pricing-rules/${id}`).then(() => undefined);
  },

  commissionRules(channelId: number): Promise<ChannelCommissionRule[]> {
    return api
      .get(`booking-channels/${channelId}/commission-rules`)
      .json<ChannelCommissionRule[]>();
  },

  createCommissionRule(
    channelId: number,
    input: ChannelCommissionRuleInput,
  ): Promise<ChannelCommissionRule> {
    return api
      .post(`booking-channels/${channelId}/commission-rules`, { json: input })
      .json<ChannelCommissionRule>();
  },

  updateCommissionRule(
    id: number,
    input: Partial<ChannelCommissionRuleInput>,
  ): Promise<ChannelCommissionRule> {
    return api
      .patch(`channel-commission-rules/${id}`, { json: input })
      .json<ChannelCommissionRule>();
  },

  deleteCommissionRule(id: number): Promise<void> {
    return api.delete(`channel-commission-rules/${id}`).then(() => undefined);
  },

  mappings(channelId: number): Promise<ChannelMappings> {
    return api
      .get(`booking-channels/${channelId}/mappings`)
      .json<ChannelMappings>();
  },

  upsertRoomTypeMapping(
    channelId: number,
    input: ChannelRoomTypeMappingInput,
  ): Promise<ChannelRoomTypeMapping> {
    return api
      .put(`booking-channels/${channelId}/mappings/room-types`, { json: input })
      .json<ChannelRoomTypeMapping>();
  },

  upsertRatePlanMapping(
    channelId: number,
    input: ChannelRatePlanMappingInput,
  ): Promise<ChannelRatePlanMapping> {
    return api
      .put(`booking-channels/${channelId}/mappings/rate-plans`, { json: input })
      .json<ChannelRatePlanMapping>();
  },

  deleteRoomTypeMapping(id: number): Promise<void> {
    return api.delete(`channel-room-type-mappings/${id}`).then(() => undefined);
  },

  deleteRatePlanMapping(id: number): Promise<void> {
    return api.delete(`channel-rate-plan-mappings/${id}`).then(() => undefined);
  },

  preview(input: ChannelPricePreviewRequest): Promise<ChannelPricePreview> {
    return api
      .post('channel-pricing/preview', { json: input })
      .json<ChannelPricePreview>();
  },

  matrix(date?: string, ratePlanId?: number): Promise<ChannelMatrix> {
    const searchParams = new URLSearchParams();
    if (date) searchParams.set('date', date);
    if (ratePlanId !== undefined) searchParams.set('rate_plan_id', String(ratePlanId));
    return api
      .get('channel-pricing/matrix', { searchParams })
      .json<ChannelMatrix>();
  },
};

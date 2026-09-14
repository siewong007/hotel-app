import { api } from '../../api/client';
import type {
  BulkRoomRateInput,
  RateCalendar,
  RatePlan,
  RatePlanInput,
  RatePlanWithRates,
  RoomRate,
  RoomRateWithDetails,
  RoomTypeRef,
} from './types';

interface MutationEnvelope<T> {
  message: string;
  [key: string]: unknown;
}

const unwrap = <T>(key: string) => (body: MutationEnvelope<T>) => body[key] as T;

export const RatesApi = {
  calendar(from: string, to: string): Promise<RateCalendar> {
    return api
      .get('revenue/rate-calendar', { searchParams: { from, to } })
      .json<RateCalendar>();
  },

  plans(): Promise<RatePlan[]> {
    return api.get('rate-plans').json<RatePlan[]>();
  },

  planWithRates(id: number): Promise<RatePlanWithRates> {
    return api.get(`rate-plans/${id}/with-rates`).json<RatePlanWithRates>();
  },

  roomTypes(): Promise<RoomTypeRef[]> {
    return api.get('rate-management/room-types').json<RoomTypeRef[]>();
  },

  createPlan(input: RatePlanInput): Promise<RatePlan> {
    return api
      .post('rate-plans', { json: input })
      .json<MutationEnvelope<RatePlan>>()
      .then(unwrap('rate_plan'));
  },

  updatePlan(id: number, input: Partial<RatePlanInput>): Promise<RatePlan> {
    return api
      .patch(`rate-plans/${id}`, { json: input })
      .json<MutationEnvelope<RatePlan>>()
      .then(unwrap('rate_plan'));
  },

  deletePlan(id: number): Promise<void> {
    return api.delete(`rate-plans/${id}`).then(() => undefined);
  },

  createRoomRate(input: {
    rate_plan_id: number;
    room_type_id: number;
    price: number;
    effective_from: string;
    effective_to?: string;
  }): Promise<RoomRate> {
    return api
      .post('room-rates', { json: input })
      .json<MutationEnvelope<RoomRate>>()
      .then(unwrap('room_rate'));
  },

  updateRoomRate(
    id: number,
    input: { price?: number; effective_from?: string; effective_to?: string },
  ): Promise<RoomRate> {
    return api
      .patch(`room-rates/${id}`, { json: input })
      .json<MutationEnvelope<RoomRate>>()
      .then(unwrap('room_rate'));
  },

  deleteRoomRate(id: number): Promise<void> {
    return api.delete(`room-rates/${id}`).then(() => undefined);
  },

  bulkUpsert(input: BulkRoomRateInput): Promise<RoomRate[]> {
    return api
      .post('room-rates/bulk', { json: input })
      .json<MutationEnvelope<RoomRate[]>>()
      .then(unwrap('room_rates'));
  },
};

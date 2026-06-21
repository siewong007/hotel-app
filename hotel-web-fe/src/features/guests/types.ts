import type { GuestCreateRequest, TourismType } from '../../types';

export interface GuestFormData extends Omit<GuestCreateRequest, 'tourism_type'> {
  id?: number;
  tourism_type?: TourismType;
}

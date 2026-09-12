import { api, toApiError } from './client';
import { RateCodesResponse, MarketCodesResponse } from '../types';

export class RatesService {
  static async getRateCodes(): Promise<RateCodesResponse> {
    try {
      return await api
        .get('rate-codes')
        .json<RateCodesResponse>();
    } catch (error) {
      throw toApiError(error, 'Failed to fetch rate codes');
    }
  }

  static async getMarketCodes(): Promise<MarketCodesResponse> {
    try {
      return await api
        .get('market-codes')
        .json<MarketCodesResponse>();
    } catch (error) {
      throw toApiError(error, 'Failed to fetch market codes');
    }
  }
}

import { HTTPError } from 'ky';
import { api, APIError, readErrorData } from './client';
import { RateCodesResponse, MarketCodesResponse } from '../types';

export class RatesService {
  static async getRateCodes(): Promise<RateCodesResponse> {
    try {
      return await api
        .get('rate-codes')
        .json<RateCodesResponse>();
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = readErrorData(error);
        throw new APIError(
          errorData.error || 'Failed to fetch rate codes',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to fetch rate codes');
    }
  }

  static async getMarketCodes(): Promise<MarketCodesResponse> {
    try {
      return await api
        .get('market-codes')
        .json<MarketCodesResponse>();
    } catch (error) {
      if (error instanceof HTTPError) {
        const errorData = readErrorData(error);
        throw new APIError(
          errorData.error || 'Failed to fetch market codes',
          error.response.status,
          errorData
        );
      }
      throw new APIError('Failed to fetch market codes');
    }
  }
}

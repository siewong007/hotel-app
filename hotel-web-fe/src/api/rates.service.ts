import { api, toApiError } from './client';
import { RateCodesResponse, MarketCodesResponse } from '../types';
import { t } from '../i18n';

export class RatesService {
  static async getRateCodes(): Promise<RateCodesResponse> {
    try {
      return await api
        .get('rate-codes')
        .json<RateCodesResponse>();
    } catch (error) {
      throw toApiError(error, t('errors:request.fetchRateCodes'));
    }
  }

  static async getMarketCodes(): Promise<MarketCodesResponse> {
    try {
      return await api
        .get('market-codes')
        .json<MarketCodesResponse>();
    } catch (error) {
      throw toApiError(error, t('errors:request.fetchMarketCodes'));
    }
  }
}

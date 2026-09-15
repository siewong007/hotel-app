import { api, toApiError } from './client';
import { t } from '../i18n';
import { RateCodesResponse, MarketCodesResponse } from '../types';

export class RatesService {
  static async getRateCodes(): Promise<RateCodesResponse> {
    try {
      return await api
        .get('rate-codes')
        .json<RateCodesResponse>();
    } catch (error) {
      throw toApiError(error, t('generic', undefined, 'errors'));
    }
  }

  static async getMarketCodes(): Promise<MarketCodesResponse> {
    try {
      return await api
        .get('market-codes')
        .json<MarketCodesResponse>();
    } catch (error) {
      throw toApiError(error, t('generic', undefined, 'errors'));
    }
  }
}

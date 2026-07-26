import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HTTPError } from 'ky';

// Mock the configured ky instance so no real HTTP happens.
const get = vi.fn();
vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return {
    ...actual,
    api: { get: (...args: any[]) => get(...args) },
  };
});

import { RatesService } from './rates.service';
import { APIError } from './client';

function mockJsonResponse(payload: unknown) {
  return { json: () => Promise.resolve(payload) };
}

function httpErrorWith(status: number, body: unknown) {
  const httpError = Object.create(HTTPError.prototype);
  httpError.response = {
    status,
    json: () => Promise.resolve(body),
  };
  return httpError;
}

describe('RatesService.getRateCodes', () => {
  beforeEach(() => {
    get.mockReset();
  });

  it('GETs rate-codes and returns the unwrapped response', async () => {
    const payload = { rate_codes: [{ id: 1, code: 'RACK' }] };
    get.mockReturnValue(mockJsonResponse(payload));

    const result = await RatesService.getRateCodes();

    expect(get).toHaveBeenCalledWith('rate-codes');
    expect(result).toEqual(payload);
  });

  it('surfaces backend error messages as an APIError', async () => {
    get.mockReturnValue({
      json: () => Promise.reject(httpErrorWith(500, { error: 'DB down' })),
    });

    await expect(RatesService.getRateCodes()).rejects.toMatchObject({
      message: 'DB down',
      statusCode: 500,
    });
    await expect(RatesService.getRateCodes()).rejects.toBeInstanceOf(APIError);
  });

  it('falls back to a generic message when the error body has none', async () => {
    get.mockReturnValue({ json: () => Promise.reject(httpErrorWith(500, {})) });

    await expect(RatesService.getRateCodes()).rejects.toMatchObject({
      message: 'Failed to fetch rate codes',
    });
  });

  it('throws a generic APIError on non-HTTP failures', async () => {
    get.mockReturnValue({ json: () => Promise.reject(new Error('network down')) });

    await expect(RatesService.getRateCodes()).rejects.toMatchObject({
      message: 'Failed to fetch rate codes',
    });
  });
});

describe('RatesService.getMarketCodes', () => {
  beforeEach(() => {
    get.mockReset();
  });

  it('GETs market-codes and returns the unwrapped response', async () => {
    const payload = { market_codes: [{ id: 1, code: 'CORP' }] };
    get.mockReturnValue(mockJsonResponse(payload));

    const result = await RatesService.getMarketCodes();

    expect(get).toHaveBeenCalledWith('market-codes');
    expect(result).toEqual(payload);
  });

  it('surfaces backend error messages as an APIError', async () => {
    get.mockReturnValue({
      json: () => Promise.reject(httpErrorWith(400, { error: 'Bad request' })),
    });

    await expect(RatesService.getMarketCodes()).rejects.toMatchObject({
      message: 'Bad request',
      statusCode: 400,
    });
  });

  it('falls back to a generic message when the error body has none', async () => {
    get.mockReturnValue({ json: () => Promise.reject(httpErrorWith(500, {})) });

    await expect(RatesService.getMarketCodes()).rejects.toMatchObject({
      message: 'Failed to fetch market codes',
    });
  });

  it('throws a generic APIError on non-HTTP failures', async () => {
    get.mockReturnValue({ json: () => Promise.reject(new Error('network down')) });

    await expect(RatesService.getMarketCodes()).rejects.toMatchObject({
      message: 'Failed to fetch market codes',
    });
  });
});

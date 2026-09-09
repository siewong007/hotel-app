import { describe, it, expect } from 'vitest';
import { buildKyHttpError } from './httpError';
import { readErrorData } from '../client';

describe('buildKyHttpError', () => {
  it('leaves the response stream spent, exactly as ky does before throwing', async () => {
    const error = buildKyHttpError(400, { error: 'Room locked' });

    // Load-bearing. If this stream were still readable, every fixture built
    // here would let `error.response.json()` resolve, and a test asserting the
    // server message would pass against the very bug it exists to catch —
    // a check that cannot fail (lessons theme 13).
    expect(error.response.bodyUsed).toBe(true);
    // eslint-disable-next-line no-restricted-syntax
    await expect(error.response.json()).rejects.toThrow();
  });

  it('carries the parsed body on `data`, where ky puts it', () => {
    const error = buildKyHttpError(409, { error: 'Room has bookings' });

    expect(readErrorData(error)).toEqual({ error: 'Room has bookings' });
    expect(error.response.status).toBe(409);
  });
});

describe('readErrorData', () => {
  it('falls back to an empty object when the body is not a JSON object', () => {
    const error = buildKyHttpError(502, {});
    const setData = (value: unknown) => {
      (error as unknown as { data: unknown }).data = value;
    };

    // ky sets `data` to a plain string for non-JSON content types (e.g. a
    // proxy's HTML error page), and leaves it undefined on an empty body.
    setData('<html>Bad Gateway</html>');
    expect(readErrorData(error)).toEqual({});

    setData(undefined);
    expect(readErrorData(error)).toEqual({});

    setData(['not', 'an', 'object']);
    expect(readErrorData(error)).toEqual({});
  });
});

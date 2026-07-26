import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { batchWithRetry, createRetryConfig, retryable, withRetry } from './retry';

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the result on first success without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn);

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries a retryable failure and eventually succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('NetworkError'))
      .mockResolvedValueOnce('ok');
    const onRetry = vi.fn();

    const promise = withRetry(fn, { initialDelay: 100, onRetry });
    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 1, 100);
  });

  it('does not retry a 4xx client error other than 429', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('Request failed with status code 404'));

    await expect(withRetry(fn)).rejects.toThrow('404');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries a 429 Too Many Requests error', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('429 Too Many Requests'))
      .mockResolvedValueOnce('ok');

    const promise = withRetry(fn, { initialDelay: 50 });
    await vi.advanceTimersByTimeAsync(50);
    await expect(promise).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('gives up after maxAttempts and throws the last error', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('NetworkError persists'));

    const promise = withRetry(fn, { maxAttempts: 2, initialDelay: 10 });
    const expectation = expect(promise).rejects.toThrow('NetworkError persists');
    await vi.advanceTimersByTimeAsync(10);
    await expectation;

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('honors a custom shouldRetry predicate', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('custom failure'));
    const shouldRetry = vi.fn().mockReturnValue(false);

    await expect(withRetry(fn, { shouldRetry })).rejects.toThrow('custom failure');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(shouldRetry).toHaveBeenCalledWith(expect.any(Error), 1);
  });

  it('caps the backoff delay at maxDelay', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('NetworkError'))
      .mockRejectedValueOnce(new Error('NetworkError'))
      .mockResolvedValueOnce('ok');
    const onRetry = vi.fn();

    const promise = withRetry(fn, {
      maxAttempts: 3,
      initialDelay: 1000,
      backoffFactor: 10,
      maxDelay: 1500,
      onRetry,
    });

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1500);
    await expect(promise).resolves.toBe('ok');

    expect(onRetry).toHaveBeenNthCalledWith(1, expect.any(Error), 1, 1000);
    expect(onRetry).toHaveBeenNthCalledWith(2, expect.any(Error), 2, 1500);
  });
});

describe('retryable', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('forwards arguments to the wrapped function and retries on failure', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('NetworkError'))
      .mockResolvedValueOnce('done');
    const wrapped = retryable(fn, { initialDelay: 10 });

    const promise = wrapped('a', 2);
    await vi.advanceTimersByTimeAsync(10);
    await expect(promise).resolves.toBe('done');

    expect(fn).toHaveBeenNthCalledWith(1, 'a', 2);
    expect(fn).toHaveBeenNthCalledWith(2, 'a', 2);
  });
});

describe('batchWithRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves every request and preserves order', async () => {
    const requests = [
      () => Promise.resolve(1),
      () => Promise.resolve(2),
      () => Promise.resolve(3),
    ];

    const results = await batchWithRetry(requests);
    expect(results).toEqual([1, 2, 3]);
  });

  it('processes requests in concurrency-sized batches', async () => {
    const started: number[] = [];
    const requests = [1, 2, 3, 4, 5].map((n) => () => {
      started.push(n);
      return Promise.resolve(n);
    });

    const results = await batchWithRetry(requests, { concurrency: 2 });

    expect(results).toEqual([1, 2, 3, 4, 5]);
    expect(started).toEqual([1, 2, 3, 4, 5]);
  });

  it('retries individual failing requests within a batch', async () => {
    const flaky = vi.fn()
      .mockRejectedValueOnce(new Error('NetworkError'))
      .mockResolvedValueOnce('recovered');

    const promise = batchWithRetry([flaky], { initialDelay: 10 });
    await vi.advanceTimersByTimeAsync(10);

    await expect(promise).resolves.toEqual(['recovered']);
    expect(flaky).toHaveBeenCalledTimes(2);
  });
});

describe('createRetryConfig', () => {
  it('defaults to the DEFAULT_OPTIONS retry count and backoff', () => {
    const config = createRetryConfig();
    expect(config.retry).toBe(3);
    expect(config.retryDelay(1)).toBe(1000);
    expect(config.retryDelay(2)).toBe(2000);
    expect(config.retryDelay(3)).toBe(4000);
  });

  it('honors overrides for maxAttempts/initialDelay/backoffFactor', () => {
    const config = createRetryConfig({ maxAttempts: 5, initialDelay: 200, backoffFactor: 3 });
    expect(config.retry).toBe(5);
    expect(config.retryDelay(1)).toBe(200);
    expect(config.retryDelay(2)).toBe(600);
  });

  it('caps retryDelay at maxDelay', () => {
    const config = createRetryConfig({ initialDelay: 1000, backoffFactor: 10, maxDelay: 5000 });
    expect(config.retryDelay(3)).toBe(5000);
  });
});

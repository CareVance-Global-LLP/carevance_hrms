import { describe, expect, it } from 'vitest';
import type { AxiosError } from 'axios';
import { isRetryableError } from '@/services/api';

/**
 * Guards the rule that stops a timed-out write from being replayed.
 *
 * A request that times out may well have SUCCEEDED on the server — only the
 * response was lost. Replaying a POST in that state duplicates the write,
 * which here means duplicate payroll runs, check-ins and payments.
 *
 * A previous iteration stamped an `Idempotency-Key` header on every POST and
 * treated any POST carrying it as replayable, which re-enabled exactly the
 * behaviour this guard exists to prevent — while no server-side handler for
 * that header existed. These tests pin the corrected rule.
 */
const makeError = (
  method: string,
  overrides: Partial<AxiosError> = {},
): AxiosError => ({
  config: { method, url: `/${method}-endpoint`, headers: {} },
  isAxiosError: true,
  name: 'AxiosError',
  message: 'Network Error',
  toJSON: () => ({}),
  ...overrides,
}) as AxiosError;

describe('isRetryableError', () => {
  it.each(['get', 'head', 'options', 'put', 'delete'])(
    'retries idempotent method %s on a network error',
    (method) => {
      expect(isRetryableError(makeError(method))).toBe(true);
    },
  );

  it.each(['post', 'patch'])('never retries non-idempotent method %s', (method) => {
    expect(isRetryableError(makeError(method))).toBe(false);
  });

  it('does not retry a POST even when it carries an Idempotency-Key', () => {
    const error = makeError('post', {
      config: {
        method: 'post',
        url: '/payroll/process-and-pay',
        headers: { 'Idempotency-Key': 'abc-123' },
      },
    } as Partial<AxiosError>);

    expect(isRetryableError(error)).toBe(false);
  });

  it('retries a GET that failed with a 5xx', () => {
    const error = makeError('get', {
      response: { status: 503, data: {}, statusText: '', headers: {}, config: {} },
    } as Partial<AxiosError>);

    expect(isRetryableError(error)).toBe(true);
  });

  it('does not retry a GET that failed with a 4xx', () => {
    const error = makeError('get', {
      response: { status: 422, data: {}, statusText: '', headers: {}, config: {} },
    } as Partial<AxiosError>);

    expect(isRetryableError(error)).toBe(false);
  });

  it('stops after the retry budget is exhausted', () => {
    const error = makeError('get');
    (error.config as unknown as { _retryCount: number })._retryCount = 3;

    expect(isRetryableError(error)).toBe(false);
  });

  it('does not retry when there is no config to replay', () => {
    expect(isRetryableError({ isAxiosError: true } as AxiosError)).toBe(false);
  });
});

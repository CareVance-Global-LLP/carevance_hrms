import { describe, expect, it } from 'vitest';
import { apiErrorMessage } from './apiErrorMessage';

const FALLBACK = 'Could not add dependency. Please try again.';

describe('apiErrorMessage', () => {
  it('uses the message the server sent for a refused request', () => {
    const error = {
      response: { status: 422, data: { message: 'That would create a circular dependency.' } },
    };

    expect(apiErrorMessage(error, FALLBACK)).toBe('That would create a circular dependency.');
  });

  it('prefers the first field error over the generic summary', () => {
    // Laravel sends both; `message` is often just "The given data was invalid."
    const error = {
      response: {
        status: 422,
        data: {
          message: 'The given data was invalid.',
          errors: { depends_on_task_id: ['That would create a circular dependency.'] },
        },
      },
    };

    expect(apiErrorMessage(error, FALLBACK)).toBe('That would create a circular dependency.');
  });

  it('falls back when the request never reached the server', () => {
    expect(apiErrorMessage(new Error('Network Error'), FALLBACK)).toBe(FALLBACK);
  });

  it('falls back rather than showing a server fault to the user', () => {
    // A 500 body is whatever the framework felt like emitting — in debug mode
    // that is an exception string with file paths in it.
    const error = {
      response: { status: 500, data: { message: 'SQLSTATE[23000]: Integrity constraint violation' } },
    };

    expect(apiErrorMessage(error, FALLBACK)).toBe(FALLBACK);
  });

  it('falls back on an empty or blank server message', () => {
    expect(apiErrorMessage({ response: { status: 422, data: { message: '   ' } } }, FALLBACK)).toBe(FALLBACK);
    expect(apiErrorMessage({ response: { status: 422, data: {} } }, FALLBACK)).toBe(FALLBACK);
  });

  it('survives junk without throwing', () => {
    expect(apiErrorMessage(null, FALLBACK)).toBe(FALLBACK);
    expect(apiErrorMessage(undefined, FALLBACK)).toBe(FALLBACK);
    expect(apiErrorMessage('a string', FALLBACK)).toBe(FALLBACK);
    expect(apiErrorMessage({ response: { status: 422, data: { errors: { f: [] } } } }, FALLBACK)).toBe(FALLBACK);
  });
});

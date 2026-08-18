import { describe, expect, it, vi, beforeEach } from 'vitest';
import { getApiErrorMessage } from '@/services/api';

/**
 * The client-side half of the override API, which no backend test can see.
 *
 * The CSV import shipped broken in a way every server test passed through:
 * PHPUnit builds a multipart request directly, so it never exercised the axios
 * client that actually sends one. In the browser the FormData went out under
 * the instance's default Content-Type: application/json, Laravel never parsed
 * the body, and the upload failed `required` on a file the user had definitely
 * chosen.
 */
describe('override import upload', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  /**
   * The regression. Every other upload in api.ts overrides the JSON default;
   * this one did not, and there is no way to notice from the server side.
   */
  it('posts the CSV as multipart, not as JSON', async () => {
    const post = vi.fn().mockResolvedValue({ data: {} });

    vi.doMock('axios', () => ({
      default: {
        create: () => ({
          post,
          get: vi.fn(),
          put: vi.fn(),
          delete: vi.fn(),
          patch: vi.fn(),
          interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
          defaults: { headers: { common: {} } },
        }),
        isAxiosError: vi.fn(),
      },
    }));

    const { payrollApi } = await import('@/services/api');

    const form = new FormData();
    form.append('file', new File(['employee_number\n100001\n'], 'overrides.csv', { type: 'text/csv' }));

    await payrollApi.overrides.validateImport(form);

    expect(post).toHaveBeenCalledTimes(1);
    const [, body, config] = post.mock.calls[0];

    expect(body).toBeInstanceOf(FormData);
    expect(config?.headers?.['Content-Type']).toBe('multipart/form-data');
  });
});

/**
 * Laravel's generic validation message names nothing, which is what made the
 * upload failure unreadable: the user was told "The given data was invalid."
 * about a file they had visibly attached.
 */
describe('getApiErrorMessage', () => {
  it('names the field when Laravel refuses without saying why', () => {
    const message = getApiErrorMessage({
      response: { data: { message: 'The given data was invalid.', errors: { file: ['The file field is required.'] } } },
    });

    expect(message).toBe('file: The file field is required.');
  });

  /** A written refusal is better than any field name — do not replace it. */
  it('keeps a real message in preference to the errors beside it', () => {
    const message = getApiErrorMessage({
      response: {
        data: {
          message: '2 of these changes cannot be applied. Nothing was saved.',
          errors: [{ index: 0, user_id: 41, message: 'Basic exceeds what this CTC supports.' }],
        },
      },
    });

    expect(message).toBe('2 of these changes cannot be applied. Nothing was saved.');
  });

  /** An array of errors must never be indexed as if it were a field map. */
  it('does not turn an error array into "0: undefined"', () => {
    const message = getApiErrorMessage({
      response: { data: { message: 'The given data was invalid.', errors: [{ index: 0, message: 'nope' }] } },
    });

    expect(message).toBe('The given data was invalid.');
  });
});

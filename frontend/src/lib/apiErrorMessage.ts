/**
 * The message to show a user when a request was refused.
 *
 * Call sites used to pass a hardcoded string straight to the toast and drop the
 * response, so every refusal read "Please try again." — including the ones that
 * can never succeed on a retry, like a circular task dependency or a duplicate
 * edge. The server already says exactly what is wrong; this just prefers it.
 *
 * Only 4xx bodies are trusted. A 5xx body is whatever the framework happened to
 * emit, which in debug mode is an exception string carrying SQL and file paths,
 * so those fall back to the caller's wording.
 */
const firstFieldError = (errors: unknown): string | null => {
  if (!errors || typeof errors !== 'object') {
    return null;
  }

  for (const value of Object.values(errors as Record<string, unknown>)) {
    const candidate = Array.isArray(value) ? value[0] : value;
    if (typeof candidate === 'string' && candidate.trim() !== '') {
      return candidate.trim();
    }
  }

  return null;
};

export const apiErrorMessage = (error: unknown, fallback: string): string => {
  if (!error || typeof error !== 'object') {
    return fallback;
  }

  const response = (error as { response?: unknown }).response;
  if (!response || typeof response !== 'object') {
    return fallback;
  }

  const { status, data } = response as { status?: unknown; data?: unknown };
  if (typeof status !== 'number' || status < 400 || status >= 500) {
    return fallback;
  }

  if (!data || typeof data !== 'object') {
    return fallback;
  }

  // Laravel sends both on a validation failure, and `message` there is the
  // useless "The given data was invalid." — the field error is the real one.
  const fieldError = firstFieldError((data as { errors?: unknown }).errors);
  if (fieldError) {
    return fieldError;
  }

  const message = (data as { message?: unknown }).message;
  return typeof message === 'string' && message.trim() !== '' ? message.trim() : fallback;
};

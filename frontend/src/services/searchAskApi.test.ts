import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import api, { searchAskApi } from './api';

/**
 * The spy goes ON the axios instance, not over the module's default export.
 * searchAskApi closes over the instance this module creates, so replacing the
 * export leaves the real request going out — which is exactly what happened:
 * a live XHR at localhost:3000 instead of an assertion.
 */
describe('searchAskApi', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('posts the question to the protected ask route', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({ data: { rows: [] } } as never);

    await searchAskApi.ask('headcount by department');

    expect(api.post).toHaveBeenCalledWith('/search/ask', { question: 'headcount by department' });
  });

  it('sends columns and rows to the summary route', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({ data: { summary: null } } as never);
    const columns = [{ key: 'department', label: 'Department', type: 'text' as const }];
    const rows = [{ department: 'Engineering' }];

    await searchAskApi.summary({ question: 'q', columns, rows });

    expect(api.post).toHaveBeenCalledWith('/search/ask/summary', { question: 'q', columns, rows });
  });
});

import { describe, expect, it, vi, beforeEach } from 'vitest';

const begin = vi.fn();
const sendChunk = vi.fn();
const complete = vi.fn();
const abort = vi.fn();
const limits = vi.fn();

vi.mock('@/services/api', () => ({
  uploadApi: {
    begin: (...args: unknown[]) => begin(...args),
    sendChunk: (...args: unknown[]) => sendChunk(...args),
    complete: (...args: unknown[]) => complete(...args),
    abort: (...args: unknown[]) => abort(...args),
    limits: (...args: unknown[]) => limits(...args),
  },
}));

import {
  uploadFileInChunks,
  getUploadLimits,
  resetUploadLimitsCache,
  UploadCancelledError,
} from '@/lib/chunkedUpload';

const fileOf = (contents: string, name = 'report.txt') =>
  new File([contents], name, { type: 'text/plain' });

describe('chunked upload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetUploadLimitsCache();

    begin.mockResolvedValue({
      data: { upload_key: 'key-1', chunk_size: 4, total_chunks: 3, missing_chunks: [0, 1, 2] },
    });
    sendChunk.mockResolvedValue({ data: { received: 1, total_chunks: 3, progress_percent: 33, is_complete: false } });
    complete.mockResolvedValue({ data: { upload_key: 'key-1', name: 'report.txt', mime: 'text/plain', size: 12 } });
    abort.mockResolvedValue({});
  });

  it('sends every piece the server asked for and returns the claim key', async () => {
    const uploadKey = await uploadFileInChunks(fileOf('AAAABBBBCCCC'));

    expect(uploadKey).toBe('key-1');
    expect(sendChunk).toHaveBeenCalledTimes(3);
    expect(sendChunk.mock.calls.map((call) => call[1])).toEqual([0, 1, 2]);
    expect(complete).toHaveBeenCalledWith('key-1');
  });

  /**
   * The server nominates the pieces. On a resumed upload it names only what is
   * missing, so the client must not re-send everything from zero — that is the
   * whole reason a session exists rather than a single stream.
   */
  it('sends only the pieces the server says are missing', async () => {
    begin.mockResolvedValue({
      data: { upload_key: 'key-2', chunk_size: 4, total_chunks: 3, missing_chunks: [2] },
    });

    await uploadFileInChunks(fileOf('AAAABBBBCCCC'));

    expect(sendChunk).toHaveBeenCalledTimes(1);
    expect(sendChunk.mock.calls[0][1]).toBe(2);
  });

  it('reports progress that ends at exactly 100 percent', async () => {
    const seen: number[] = [];

    await uploadFileInChunks(fileOf('AAAABBBBCCCC'), {
      onProgress: (progress) => seen.push(progress.percent),
    });

    expect(seen[0]).toBe(0);
    expect(seen[seen.length - 1]).toBe(100);
    // Never goes backwards — a bar that retreats reads as a failure.
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
  });

  /**
   * Retrying is the point of chunking beyond size. A blip at 180 MB should
   * cost one piece, not the whole file.
   */
  it('retries a failed piece rather than failing the whole upload', async () => {
    sendChunk
      .mockRejectedValueOnce(new Error('network blip'))
      .mockResolvedValue({ data: { received: 1, total_chunks: 3, progress_percent: 33, is_complete: false } });

    const uploadKey = await uploadFileInChunks(fileOf('AAAABBBBCCCC'));

    expect(uploadKey).toBe('key-1');
    expect(sendChunk).toHaveBeenCalledTimes(4); // one retry, then the rest
  });

  it('gives up after repeated failures and releases the upload server-side', async () => {
    sendChunk.mockRejectedValue(new Error('gone'));

    await expect(uploadFileInChunks(fileOf('AAAABBBBCCCC'))).rejects.toThrow('gone');

    // Otherwise the pieces sit on disk until the sweep runs, and these are the
    // largest files the system handles.
    expect(abort).toHaveBeenCalledWith('key-1');
  });

  it('stops when cancelled and releases the upload', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      uploadFileInChunks(fileOf('AAAABBBBCCCC'), { signal: controller.signal })
    ).rejects.toBeInstanceOf(UploadCancelledError);

    expect(sendChunk).not.toHaveBeenCalled();
    expect(abort).toHaveBeenCalledWith('key-1');
  });

  it('asks the server for its limits once and reuses the answer', async () => {
    limits.mockResolvedValue({
      data: { chunk_size: 1024, max_upload_bytes: 200, allowed_mimes: ['text/plain'] },
    });

    const first = await getUploadLimits();
    const second = await getUploadLimits();

    expect(first).toEqual(second);
    expect(limits).toHaveBeenCalledTimes(1);
  });
});

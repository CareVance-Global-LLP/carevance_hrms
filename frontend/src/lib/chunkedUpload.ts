import { uploadApi } from '@/services/api';
import { reportSilentError } from '@/lib/reportSilentError';

/**
 * Sending a file that will not fit in one request.
 *
 * The interface used to offer 200 MB while PHP silently discarded anything
 * over 2 MB (dev) or 10 MB (production) before the application ever ran — so a
 * large attachment produced "no attachment", which is the least helpful thing
 * it could have said. Slicing the file removes the ceiling rather than raising
 * it: no single request is ever large, so the server's limit stops deciding
 * the maximum attachment size.
 */

export type UploadProgress = {
  uploadedBytes: number;
  totalBytes: number;
  /** 0–100, already rounded. */
  percent: number;
};

export type UploadLimits = {
  chunkSize: number;
  maxUploadBytes: number;
  allowedMimes: string[];
};

/**
 * How many times to re-send a piece before giving up.
 *
 * Retrying is the entire reason for chunking beyond size: a dropped connection
 * at 180 MB should cost one piece, not the whole file. Only the failed piece is
 * re-sent, because everything already accepted stays accepted server-side.
 */
const MAX_CHUNK_ATTEMPTS = 3;

let cachedLimits: UploadLimits | null = null;

/**
 * What this server accepts, asked once per session.
 *
 * Deliberately not a constant. The safe chunk size is a property of the
 * server's php.ini, and hardcoding one is how the same client works in one
 * environment and fails in another.
 */
export const getUploadLimits = async (): Promise<UploadLimits> => {
  if (cachedLimits) return cachedLimits;

  const response = await uploadApi.limits();
  cachedLimits = {
    chunkSize: Number(response.data?.chunk_size || 0),
    maxUploadBytes: Number(response.data?.max_upload_bytes || 0),
    allowedMimes: response.data?.allowed_mimes || [],
  };

  return cachedLimits;
};

/** Only exported so tests can start from a known state. */
export const resetUploadLimitsCache = () => {
  cachedLimits = null;
};

export class UploadCancelledError extends Error {
  constructor() {
    super('Upload cancelled');
    this.name = 'UploadCancelledError';
  }
}

const isAbort = (error: unknown) =>
  error instanceof UploadCancelledError ||
  (error as { name?: string })?.name === 'CanceledError' ||
  (error as { code?: string })?.code === 'ERR_CANCELED';

/**
 * Upload a file in pieces and return the key that claims it.
 *
 * The key is quoted when the message is sent; the assembled file is never
 * exposed to the client as a path it could reuse for something else.
 */
export const uploadFileInChunks = async (
  file: File,
  options: {
    onProgress?: (progress: UploadProgress) => void;
    signal?: AbortSignal;
  } = {}
): Promise<string> => {
  const { onProgress, signal } = options;

  const report = (uploadedBytes: number) => {
    const clamped = Math.min(uploadedBytes, file.size);
    onProgress?.({
      uploadedBytes: clamped,
      totalBytes: file.size,
      percent: file.size > 0 ? Math.round((clamped / file.size) * 100) : 0,
    });
  };

  report(0);

  const begun = await uploadApi.begin({ name: file.name, size: file.size, mime: file.type || undefined });
  const uploadKey = begun.data.upload_key;
  const chunkSize = begun.data.chunk_size;

  try {
    // The server says which pieces it wants. On a fresh upload that is all of
    // them; asking rather than assuming is what makes resuming the same code
    // path as starting.
    const missing = begun.data.missing_chunks ?? [];
    let completedBytes = 0;

    for (const index of missing) {
      if (signal?.aborted) throw new UploadCancelledError();

      const start = index * chunkSize;
      const slice = file.slice(start, Math.min(start + chunkSize, file.size));

      let attempt = 0;
      for (;;) {
        attempt += 1;

        try {
          await uploadApi.sendChunk(uploadKey, index, slice, {
            signal,
            // Bytes inside the current piece, added to everything already
            // finished. Without this the bar jumps one chunk at a time and
            // looks frozen between them on a slow link.
            onProgress: (loaded) => report(completedBytes + loaded),
          });
          break;
        } catch (error) {
          if (isAbort(error) || signal?.aborted) throw new UploadCancelledError();

          if (attempt >= MAX_CHUNK_ATTEMPTS) throw error;

          // Re-sending an already-accepted piece is harmless — the server
          // records indexes, not arrivals — so a retry after an ambiguous
          // failure cannot corrupt or double-count anything.
          reportSilentError(
            `chunkedUpload: piece ${index} failed (attempt ${attempt}/${MAX_CHUNK_ATTEMPTS}); retrying`,
            error
          );
        }
      }

      completedBytes += slice.size;
      report(completedBytes);
    }

    const finished = await uploadApi.complete(uploadKey);
    report(file.size);

    return finished.data.upload_key;
  } catch (error) {
    // Tell the server to let go of the pieces. Without this every cancelled or
    // failed upload leaves its chunks until the sweep runs, and these are the
    // largest files the system handles.
    void uploadApi.abort(uploadKey).catch((abortError) => {
      reportSilentError('chunkedUpload: could not release a failed upload', abortError);
    });

    throw error;
  }
};

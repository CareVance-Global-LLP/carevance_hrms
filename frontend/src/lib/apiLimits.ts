/**
 * API Limits for Scalability - Prevents crashes with large datasets
 * These limits ensure the app works with 500+ users
 */

// Maximum records to fetch per API call
export const API_LIMITS = {
  // Time entries - max 500 per user to prevent memory issues
  TIME_ENTRIES_PER_USER: 500,

  // Activities - max 1000 total per query
  ACTIVITIES_MAX: 1000,

  // Screenshots - max 100 per query (they're heavy)
  SCREENSHOTS_MAX: 100,

  // Reports - max 30 days of daily data
  REPORT_DAYS_MAX: 30,

  // Batch size for user queries (fetch users in batches)
  USERS_BATCH_SIZE: 50,

  // Max concurrent API calls
  CONCURRENT_REQUESTS: 5,

  // Max pages to fetch (prevents infinite loops)
  MAX_PAGES: 10,

  // Per page limit
  DEFAULT_PER_PAGE: 100,
} as const;

// Check if date range exceeds limit
export function validateDateRange(startDate: string, endDate: string, maxDays: number = API_LIMITS.REPORT_DAYS_MAX): boolean {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  return diffDays <= maxDays;
}

// Get safe date range
export function getSafeDateRange(endDate: string = new Date().toISOString().split('T')[0], days: number = API_LIMITS.REPORT_DAYS_MAX): { startDate: string; endDate: string } {
  const end = new Date(endDate);
  const start = new Date(end);
  start.setDate(start.getDate() - days);
  return {
    startDate: start.toISOString().split('T')[0],
    endDate: end.toISOString().split('T')[0],
  };
}

// Limit concurrent promises
export async function limitConcurrency<T>(promises: Promise<T>[], limit: number = API_LIMITS.CONCURRENT_REQUESTS): Promise<T[]> {
  const results: T[] = [];
  const executing: Promise<void>[] = [];

  for (const [index, promise] of promises.entries()) {
    const p = promise.then((result) => {
      results[index] = result;
    });
    executing.push(p);

    if (executing.length >= limit) {
      await Promise.race(executing);
      executing.splice(executing.findIndex((ep) => ep === p), 1);
    }
  }

  await Promise.all(executing);
  return results;
}

// Batch array into chunks
export function batchArray<T>(array: T[], batchSize: number = API_LIMITS.USERS_BATCH_SIZE): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < array.length; i += batchSize) {
    batches.push(array.slice(i, i + batchSize));
  }
  return batches;
}

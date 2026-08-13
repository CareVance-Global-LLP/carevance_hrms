import { describe, expect, it } from 'vitest';
import * as offlineService from './offlineService';

describe('offlineService surface', () => {
  it('exposes no app-usage writer', () => {
    // The legacy path wrote to POST /api/activities, the retired flat model,
    // while live sessions write activity_sessions. Two writers for one
    // timeline is how the record starts disagreeing with itself depending on
    // whether the user happened to be online.
    expect('saveAppUsageOffline' in offlineService).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { newSessionLocalId } from './desktopSessionIdentity';

describe('newSessionLocalId', () => {
  it('returns a distinct id per call', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newSessionLocalId()));

    expect(ids.size).toBe(500);
  });

  it('fits the 120-character column the server matches on', () => {
    // activity_sessions.local_id is string(120); a longer value would be
    // truncated by the database and stop matching on replay.
    expect(newSessionLocalId().length).toBeLessThanOrEqual(120);
  });

  it('is a UUID v4', () => {
    expect(newSessionLocalId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });
});

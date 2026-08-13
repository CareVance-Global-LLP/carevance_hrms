/**
 * Client-minted identity for one desktop activity session.
 *
 * `activity_sessions` has a unique index on (local_id, device_id) and
 * ActivitySessionController::store returns the existing row when it sees a
 * pair it already holds. That is what makes a retry safe; without these keys
 * a retry inserts a second row for the same stretch of time.
 */
export const newSessionLocalId = (): string => {
  if (typeof crypto?.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  // Electron's renderer has randomUUID, but happy-dom in tests and any older
  // embedded runtime may not. getRandomValues is far more widely present.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

/**
 * Distance on the ground, and how to say it to somebody standing on it.
 *
 * `haversineMeters` was copied into two screens. It is here once because the
 * geofence decision — may this person check in — is computed from it, and two
 * copies of a rule is two chances for them to disagree.
 */

const EARTH_RADIUS_M = 6371000;

export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * A distance a person can act on.
 *
 * The screen used to print raw coordinates to six decimal places and a metre
 * count from the zone centre. Nobody standing outside an office can do anything
 * with "23.022505, 72.571362" — they need to know how far, and which way the
 * number has to move.
 */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return '—';
  if (meters < 1000) return Math.round(meters) + ' m';
  return (meters / 1000).toFixed(meters < 10000 ? 1 : 0) + ' km';
}

/**
 * Above this, a fix is too vague to trust for a geofence decision and the user
 * should be told rather than left wondering why the zone check is wrong.
 * Consumer GPS indoors routinely reports 30-50m; beyond that it is usually a
 * cell-tower or wifi fix, not a satellite one.
 */
export const POOR_ACCURACY_M = 50;

export function isAccuracyPoor(accuracy: number | undefined): boolean {
  return typeof accuracy === 'number' && accuracy > POOR_ACCURACY_M;
}

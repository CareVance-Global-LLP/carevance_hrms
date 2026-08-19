/**
 * Labelling for timeline rows belonging to people in another timezone.
 *
 * The Timeline renders every lane in the VIEWER's zone, which is right for
 * comparing colleagues on one axis but silently misleading on its own: measured
 * on a two-office org (19 Aug 2026), an employee who started at 09:00 in Manila
 * was drawn at 05:30 for a viewer in Mumbai, with nothing on screen to say so.
 * The data was correct; the label was missing. In HR software that is how
 * somebody gets wrongly flagged for a late start.
 *
 * These helpers exist to say something ONLY when it matters. A badge on every
 * row is noise, and noise gets ignored.
 */

/** "Asia/Manila" -> "Manila". Underscores become spaces; anything else passes through. */
export const zoneCityLabel = (zone?: string | null): string => {
  const value = String(zone ?? '').trim();
  if (value === '') {
    return '';
  }

  // A three-part zone such as America/Argentina/Buenos_Aires names the city last.
  const city = value.split('/').pop() ?? value;

  return city.replace(/_/g, ' ');
};

/**
 * Some zones are the same place under two spellings. Browsers still report
 * Asia/Calcutta where the server says Asia/Kolkata, and badging that as
 * "foreign" would put a notice on every row in an Indian company.
 */
const ALIASES: Record<string, string> = {
  'asia/calcutta': 'asia/kolkata',
  'asia/saigon': 'asia/ho_chi_minh',
  'america/buenos_aires': 'america/argentina/buenos_aires',
  'europe/kiev': 'europe/kyiv',
};

const canonical = (zone: string) => {
  const key = zone.trim().toLowerCase();
  return ALIASES[key] ?? key;
};

/**
 * What to show beside a lane whose employee is in a different zone from the
 * viewer, or null when there is nothing worth saying.
 *
 * Returns null on unknown input rather than guessing: a wrong timezone label is
 * worse than no label, because it will be believed.
 */
export const foreignZoneNotice = (
  employeeZone?: string | null,
  viewerZone?: string | null
): string | null => {
  const employee = String(employeeZone ?? '').trim();
  const viewer = String(viewerZone ?? '').trim();

  if (employee === '' || viewer === '') {
    return null;
  }

  if (canonical(employee) === canonical(viewer)) {
    return null;
  }

  const city = zoneCityLabel(employee);

  return city === '' ? null : `${city} time`;
};

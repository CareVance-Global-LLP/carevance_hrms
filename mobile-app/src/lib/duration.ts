/**
 * How a length of time is written and how it is spoken.
 *
 * These were two copies of the same formatter, one per screen. They are here
 * together because the spoken form is the point: a screen reader reads
 * "07:32:10" as "zero seven colon three two colon one zero", so the app's most
 * important number was its least intelligible one. Every place that renders a
 * clock needs the label to go with it.
 */

const clamp = (seconds: number): number =>
  Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;

/** HH:MM:SS, zero-padded, hours uncapped (a 30-hour span reads "30:00:00"). */
export function formatClock(seconds: number): string {
  const total = clamp(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

/** Compact written form for labels and lists: "7h 32m", "48m", "0m". */
export function formatShort(seconds: number): string {
  const total = clamp(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

/**
 * What a screen reader should say. Seconds are omitted above a minute — a
 * ticking seconds count would make VoiceOver re-announce continuously.
 */
export function spokenDuration(seconds: number): string {
  const total = clamp(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);

  const parts: string[] = [];
  if (h) parts.push(`${h} hour${h === 1 ? '' : 's'}`);
  if (m) parts.push(`${m} minute${m === 1 ? '' : 's'}`);
  if (!parts.length) return 'less than a minute';
  return parts.join(' ');
}

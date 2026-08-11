/**
 * Time-of-day greeting.
 *
 * Both dashboards hard-coded "Good morning" with no time logic, so every user
 * was greeted with it at every hour — it was verified reading "Good morning" at
 * 23:30. It is the first line of text after signing in, which makes it a poor
 * place to be visibly wrong.
 *
 * Boundaries follow ordinary Indian-office usage rather than astronomical noon:
 * afternoon starts at 12, evening at 17. Anything from midnight to 04:59 still
 * reads "Good evening" — someone working at 2am is finishing a long day, not
 * starting an early one, and "Good morning" at 2am reads as a bug.
 */
export function greetingFor(date: Date = new Date()): string {
  const hour = date.getHours();

  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/** "Good afternoon, Priya" — falls back to "there" when the name is unknown. */
export function greetUser(name?: string | null, date: Date = new Date()): string {
  const firstName = name?.trim().split(/\s+/)[0];

  return `${greetingFor(date)}, ${firstName || 'there'}`;
}

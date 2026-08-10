/**
 * For failures a user should not be interrupted by, but nobody should have to
 * guess at either.
 *
 * `catch {}` was doing this job in a dozen places, and it hides two very
 * different situations behind the same silence: a cache read that missed, and a
 * save that never happened. The second kind is how entering a PAN, pressing
 * "Add Government ID", and receiving no message at all could leave nothing
 * written — the request failed and the error was discarded on the way out.
 *
 * Use this only where swallowing really is correct — an optional read, a
 * best-effort background sync. Anything the user is waiting on should surface a
 * message instead.
 */
export function reportSilentError(context: string, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  console.warn(`[${context}] suppressed: ${detail}`);
}

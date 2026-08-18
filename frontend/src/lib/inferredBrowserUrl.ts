/**
 * Which URL a desktop context should be credited with, and how much to trust it.
 *
 * Two possible sources, in descending authority. A browser extension used to
 * sit above both and own website sessions outright; it was removed on 14 Aug
 * 2026, having never written a session in the life of the database, so the
 * desktop agent is now the only writer and no precedence is needed.
 *
 *   platform `url`         Filled natively by get-windows, macOS only. Always
 *                          null on the Windows build, but preferred if present.
 *
 *   inferred_url           Read out of the browser's own UI by the desktop
 *                          agent. Exact whenever the browser's Document element
 *                          answers — verified on Chrome and Edge, 14 Aug 2026 —
 *                          and host-only when the read fell back to the address
 *                          bar, which can still hold text somebody typed and
 *                          never submitted. The tier follows the SOURCE, not
 *                          the browser: any Chromium browser degrades to the
 *                          address bar while its accessibility tree is cold.
 *
 * Keeping the tiers apart matters because a report that shows an inferred host
 * identically to a confirmed visit is the same defect the rollout's canonical
 * rules already forbid: an honest fallback beats a confident wrong claim.
 */

export type BrowserUrlSource = 'platform' | 'document' | 'address_bar';

/** Exact enough to name a page. */
const EXACT_CONFIDENCE = 100;

/** A host we believe was visited, without standing behind the path. */
const HOST_ONLY_CONFIDENCE = 60;

export interface BrowserUrlContext {
  url?: string | null;
  inferred_url?: string | null;
  inferred_url_source?: BrowserUrlSource | null;
  inferred_url_confidence?: number | null;
}

export interface ResolvedBrowserUrl {
  url: string | null;
  confidence: number;
  source: BrowserUrlSource | null;
  reason?: string;
}

const NONE = (reason: string): ResolvedBrowserUrl => ({ url: null, confidence: 0, source: null, reason });

export const resolveBrowserUrlForContext = ({
  context,
  isBrowser,
}: {
  context?: BrowserUrlContext | null;
  isBrowser: boolean;
}): ResolvedBrowserUrl => {
  if (!context) return NONE('no-url');

  /*
   * Checked before anything else. A reading can outlive the window it came
   * from by a poll, and attaching a stale URL to a spreadsheet because someone
   * alt-tabbed is worse than reporting no URL at all.
   */
  if (!isBrowser) return NONE('not-a-browser');

  const platformUrl = String(context.url || '').trim();
  if (platformUrl) {
    return { url: platformUrl, confidence: EXACT_CONFIDENCE, source: 'platform' };
  }

  const inferred = String(context.inferred_url || '').trim();
  if (!inferred) return NONE('no-url');

  /*
   * Only the document tier is exact, and only when the desktop says so. An
   * older desktop build can send a URL with no grade at all; assuming the
   * exact tier there would quietly promote an Edge host-guess into a confirmed
   * visit, so anything unrecognised lands on the low tier.
   */
  const source: BrowserUrlSource = context.inferred_url_source === 'document' ? 'document' : 'address_bar';
  const confidence = source === 'document' ? EXACT_CONFIDENCE : HOST_ONLY_CONFIDENCE;

  return { url: inferred, confidence, source };
};

'use strict';

/**
 * Turn a raw browser-chrome reading into something safe to record as a visit.
 *
 * Two sources, deliberately trusted differently. Measurements from 13 Aug 2026
 * on Chrome 1xx, Edge and Brave:
 *
 *   'document'    Chrome exposes a UIA Document element whose value is the real
 *                 page URL, scheme and all. Proven immune to a half-typed
 *                 address bar: the bar read "how to avoid being monit" while
 *                 the document read the actual URL at the same instant.
 *
 *   'address_bar' All that Edge and Brave expose. It contains whatever is in
 *                 the box, INCLUDING text somebody typed and never submitted —
 *                 which persists after Escape and after keyboard focus leaves
 *                 the bar, so focus state cannot be used to filter it.
 *
 * The address bar is therefore reduced to a host and anything not clearly a
 * host is dropped. Recording "how to avoid being monit" as a website visit
 * would be both wrong and a capture of something the person chose not to send.
 */

/** Schemes that are a browser's own UI rather than a website visit. */
const INTERNAL_SCHEMES = ['chrome:', 'edge:', 'brave:', 'about:', 'vivaldi:', 'opera:', 'devtools:', 'view-source:'];

const DROP = (reason) => ({ url: null, confidence: 0, reason });

const isInternal = (value) => {
  const lower = value.toLowerCase();
  return INTERNAL_SCHEMES.some((scheme) => lower.startsWith(scheme));
};

/**
 * Does this look like a host somebody actually navigated to?
 *
 * Deliberately strict. A partially typed address is indistinguishable from a
 * real one at the character level, so the test is for shapes that a person
 * mid-keystroke is unlikely to have produced: no whitespace, a dot with at
 * least two letters after it, and no trailing dot.
 */
const looksLikeHost = (host) => {
  if (!host || /\s/.test(host)) return false;
  if (host.endsWith('.')) return false;

  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host);
};

/**
 * @param {{ source?: string, value?: string|null }|null} capture
 * @returns {{ url: string|null, confidence: number, reason?: string }}
 */
const normalizeCapturedUrl = (capture) => {
  const source = capture && capture.source;
  const raw = capture && capture.value;

  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return DROP('empty');
  if (isInternal(value)) return DROP('browser-internal');

  if (source === 'document') {
    // Already a real URL from the page itself; the only thing worth removing is
    // a browser-internal page, handled above.
    return { url: value, confidence: 100 };
  }

  if (source !== 'address_bar') {
    // Fail closed. A source this module does not understand cannot be graded,
    // and guessing would silently grant it document-level trust.
    return DROP('unknown-source');
  }

  /*
   * URL needs a scheme to parse a host, and the bar supplies one only
   * sometimes — Edge includes https://, Chrome and Brave elide it. Adding one
   * for parsing does not assert the site was https; the scheme simply is not
   * knowable from an elided bar, and https is the safer thing to record than a
   * guess of http.
   */
  /*
   * Reject internal whitespace before parsing rather than after. URL happily
   * parses "example.com and more" into the host example.com, so checking only
   * the parsed hostname lets typed prose through as a visit.
   */
  if (/\s/.test(value)) return DROP('not-host-shaped');

  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return DROP('not-host-shaped');
  }

  if (!looksLikeHost(parsed.hostname)) return DROP('not-host-shaped');

  /*
   * Host and port only. The path cannot be trusted from a bar that may hold a
   * partially typed value, and `parsed.host` drops any user:password that was
   * in the value — credentials must never reach a report.
   */
  return { url: `${parsed.protocol}//${parsed.host}`.toLowerCase(), confidence: 60 };
};

module.exports = { normalizeCapturedUrl, looksLikeHost, INTERNAL_SCHEMES };

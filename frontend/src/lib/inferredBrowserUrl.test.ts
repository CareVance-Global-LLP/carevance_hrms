import { describe, expect, it } from 'vitest';
import { resolveBrowserUrlForContext } from './inferredBrowserUrl';

const exact = {
  inferred_url: 'https://developer.chrome.com/docs/extensions/reference/api/tabs',
  inferred_url_source: 'document' as const,
  inferred_url_confidence: 100,
};

const hostOnly = {
  inferred_url: 'https://example.com',
  inferred_url_source: 'address_bar' as const,
  inferred_url_confidence: 60,
};

describe('resolveBrowserUrlForContext', () => {
  it('uses an exact document URL from the desktop agent', () => {
    const result = resolveBrowserUrlForContext({
      context: exact,
      isBrowser: true,
    });

    expect(result.url).toBe(exact.inferred_url);
    expect(result.confidence).toBe(100);
    expect(result.source).toBe('document');
  });

  it('uses a host-only reading when that is all the browser exposes', () => {
    const result = resolveBrowserUrlForContext({
      context: hostOnly,
      isBrowser: true,
    });

    expect(result.url).toBe('https://example.com');
    expect(result.confidence).toBe(60);
  });

  it('never reports an inferred URL for a non-browser window', () => {
    // A stale reading must not attach itself to Excel because the poll landed
    // a moment after someone alt-tabbed.
    const result = resolveBrowserUrlForContext({
      context: exact,
      isBrowser: false,
    });

    expect(result.url).toBeNull();
    expect(result.reason).toBe('not-a-browser');
  });

  it('prefers a real url from the platform over an inferred one', () => {
    // macOS fills `url` natively. If it is ever populated, it beats a reading
    // scraped out of the browser's chrome.
    const result = resolveBrowserUrlForContext({
      context: { ...hostOnly, url: 'https://native.example/page' },
      isBrowser: true,
    });

    expect(result.url).toBe('https://native.example/page');
    expect(result.confidence).toBe(100);
    expect(result.source).toBe('platform');
  });

  it('reports nothing when there is nothing to report', () => {
    const result = resolveBrowserUrlForContext({
      context: { inferred_url: null },
      isBrowser: true,
    });

    expect(result.url).toBeNull();
    expect(result.reason).toBe('no-url');
  });

  it('survives a missing context without throwing', () => {
    expect(resolveBrowserUrlForContext({ context: null, isBrowser: true }).url).toBeNull();
    expect(resolveBrowserUrlForContext({ context: undefined, isBrowser: false }).url).toBeNull();
  });

  it('defaults confidence conservatively when the desktop sends none', () => {
    // An older desktop build could send the url without a grade. Assuming the
    // exact tier would let a host-only guess be recorded as a confirmed visit.
    const result = resolveBrowserUrlForContext({
      context: { inferred_url: 'https://example.com', inferred_url_source: 'address_bar' },
      isBrowser: true,
    });

    expect(result.confidence).toBe(60);
  });

  it('treats an unrecognised source as the low tier', () => {
    const result = resolveBrowserUrlForContext({
      context: { inferred_url: 'https://example.com', inferred_url_source: 'something-new' as never },
      isBrowser: true,
    });

    expect(result.url).toBe('https://example.com');
    expect(result.confidence).toBe(60);
  });
});

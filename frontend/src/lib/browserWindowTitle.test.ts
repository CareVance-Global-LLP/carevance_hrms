import { describe, expect, it } from 'vitest';
import { buildTrackedContextName, cleanBrowserWindowTitle } from './activityProductivity';

describe('cleanBrowserWindowTitle', () => {
  it('strips the tab count and profile Chromium appends to the window title', () => {
    /*
     * The exact label recorded on a real timeline row, 14 Aug 2026. Tab count
     * and profile describe the WINDOW, never the page, so they are noise in a
     * column whose job is to name what somebody was reading.
     */
    expect(
      cleanBrowserWindowTitle('Fetch API - Web APIs | MDN and 1 more page - Profile 1 - Microsoft Edge')
    ).toBe('Fetch API - Web APIs | MDN');
  });

  it('handles a plural tab count and a named profile', () => {
    expect(cleanBrowserWindowTitle('Inbox and 12 more pages - Profile Work - Google Chrome')).toBe('Inbox');
  });

  it('still strips a bare browser suffix', () => {
    expect(cleanBrowserWindowTitle('Wikipedia - Google Chrome')).toBe('Wikipedia');
  });

  it('leaves a page title that merely mentions the words alone', () => {
    // Anchored patterns only: these appear mid-title, describing the page.
    const title = 'How to add 3 more pages to a Profile section';
    expect(cleanBrowserWindowTitle(title)).toBe(title);
  });
});

describe('buildTrackedContextName', () => {
  it('names a browser row from its URL rather than the window title', () => {
    /*
     * get-windows fills `url` on macOS only, so on Windows this fell through to
     * the title. That produced one Chrome row reading "Wikipedia" beside an Edge
     * row reading the full raw title — same run, same kind of visit, named two
     * different ways depending on whether a URL happened to resolve.
     */
    expect(buildTrackedContextName({
      app: 'Microsoft Edge',
      title: 'Fetch API - Web APIs | MDN and 1 more page - Profile 1 - Microsoft Edge',
      url: 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API',
    })).toBe('https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API');
  });

  it('falls back to a cleaned title when no URL resolved', () => {
    expect(buildTrackedContextName({
      app: 'Microsoft Edge',
      title: 'Fetch API - Web APIs | MDN and 1 more page - Profile 1 - Microsoft Edge',
      url: null,
    })).toBe('Fetch API - Web APIs | MDN');
  });
});

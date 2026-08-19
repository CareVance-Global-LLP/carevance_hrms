import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SETTINGS_TABS } from './settingsTabs';

/**
 * A settings tab lives in three places, and all three have to agree:
 *
 *   settingsTabs.ts            the rail entry
 *   useSettingsController.ts   the `allowed` set that decides who sees it
 *   Settings.tsx               the pane that renders when it is active
 *
 * Registering a tab in the first without the second produces a tab that
 * exists, compiles, type-checks and is invisible to every user — which is
 * exactly what happened when the Privacy tab was added, and is impossible to
 * spot by reading any one file.
 */
describe('settings tab wiring', () => {
  const read = (relativePath: string): string =>
    readFileSync(join(__dirname, relativePath), 'utf8');

  const controllerSource = read('./useSettingsController.ts');
  const settingsPageSource = readFileSync(
    join(__dirname, '..', '..', 'pages', 'Settings.tsx'),
    'utf8',
  );

  /**
   * Only the visibility block, not the whole file. Several tab ids appear
   * elsewhere in the controller for unrelated reasons, so scanning the file as
   * a whole would pass for a tab that is registered but never granted — the
   * precise bug this is here to catch.
   */
  const visibilityBlock = (() => {
    // Starts at `const allowed = ...`, deliberately AFTER any comment above
    // it. Slicing from the useMemo instead would let a tab id mentioned in a
    // comment satisfy the check — which it did, and which made this test pass
    // while the tab was still invisible.
    const start = controllerSource.indexOf('const allowed = new Set<SettingsTabId>(');
    const end = controllerSource.indexOf('return SETTINGS_TABS.filter', start);
    expect(start, 'the allow-list was renamed — this test needs updating').toBeGreaterThan(-1);
    expect(end, 'the allow-list shape changed — this test needs updating').toBeGreaterThan(start);
    return controllerSource.slice(start, end);
  })();

  it.each(SETTINGS_TABS.map((tab) => tab.id))(
    'tab "%s" is granted by some branch of the visibility allow-list',
    (id) => {
      expect(
        visibilityBlock.includes(`'${id}'`),
        `"${id}" is in SETTINGS_TABS but is never added to the allowed set in `
          + "useSettingsController's visibleTabs, so no user can ever see it.",
      ).toBe(true);
    },
  );

  it.each(SETTINGS_TABS.map((tab) => tab.id))(
    'tab "%s" renders a pane',
    (id) => {
      expect(
        settingsPageSource.includes(`activeTab === '${id}'`),
        `"${id}" is in SETTINGS_TABS but Settings.tsx renders nothing for it, `
          + 'so selecting it shows a blank screen.',
      ).toBe(true);
    },
  );

  it('every tab has a title and description', () => {
    for (const tab of SETTINGS_TABS) {
      expect(
        settingsPageSource.includes(`${tab.id.includes('-') ? `'${tab.id}'` : tab.id}: { title:`),
        `"${tab.id}" is missing from PANE_TITLES in Settings.tsx.`,
      ).toBe(true);
    }
  });

  it('privacy is available to every employee, not just administrators', () => {
    // The obligation to tell someone what is collected about them is owed to
    // that person. A disclosure behind an admin gate is not a disclosure.
    const baseSet = controllerSource.slice(
      controllerSource.indexOf('const allowed = new Set<SettingsTabId>('),
      controllerSource.indexOf('if (isStrictAdminUser)'),
    );

    expect(baseSet).toContain("'privacy'");
  });
});

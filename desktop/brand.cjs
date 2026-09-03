/**
 * The one place the desktop app is named at RUNTIME.
 *
 * Mirrors frontend/src/config/brand.ts, backend/config/brand.php and
 * mobile-app/src/constants/brand.ts. `docs/BRANDING.md` records that all four
 * have to be changed together.
 *
 * TO UN-BRAND: set `enabled` to false. Every string the running app shows — the
 * window title, the tray tooltip and menu, the OS application name, the offline
 * page, the load-error page and the default notification title — falls back to
 * neutral wording that still reads as a sentence.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE CANNOT CHANGE, and why that is deliberate
 *
 * `package.json` carries a second, different kind of name: the INSTALL
 * identity. `appId`, `productName`, `shortcutName`, `artifactName` and the
 * update `repo` are read by electron-builder at BUILD time, baked into the
 * installer, and used by Windows and macOS to decide whether an installed copy
 * is the same application.
 *
 * Change them and an installed app is no longer recognised as the same product:
 * the next build installs ALONGSIDE the old one instead of updating it, the
 * Start Menu gains a second entry, and auto-update stops reaching everybody who
 * already has it. That is a release decision with a migration attached, not a
 * rebrand, so it is left to a human and documented rather than wired to this
 * switch.
 *
 * The icons in `assets/` are the same kind of thing: `icon.ico`, `icon.png` and
 * `tray-icon.ico` are compiled into the installer. Un-branding them means
 * supplying replacement artwork, not toggling a flag.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const BRAND = {
  /** The master switch for every runtime string below. */
  enabled: false,

  /** The bare wordmark, as it appears mid-sentence. */
  name: 'CareVance',

  /** The application, as the OS and the window title name it. */
  appName: 'CareVance Tracker',

  /** How the app identifies itself to the web layer. */
  contextName: 'CareVance Desktop',
};

/** Mid-sentence: "X could not reach the server", "X is not running". */
const brandLabel = BRAND.enabled ? BRAND.name : 'The tracker';

/** The application's own name, for titles, the tray menu and the OS. */
const appLabel = BRAND.enabled ? BRAND.appName : 'Tracker';

/** What the app calls itself to the web layer. Not a display string. */
const contextLabel = BRAND.enabled ? BRAND.contextName : 'Desktop';

/**
 * The tray tooltip's leading word, with its separator.
 *
 * Un-branded this is empty, so the tooltip reads "Running 00:12" rather than
 * a dangling em dash with nothing before it.
 */
const trayPrefix = BRAND.enabled ? `${BRAND.name} — ` : '';

module.exports = { BRAND, brandLabel, appLabel, contextLabel, trayPrefix };

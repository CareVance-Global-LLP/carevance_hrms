const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '..', 'app-config.json');
const appUrl = (process.env.APP_URL || 'http://localhost:5173').trim();

/*
 * Packaging refuses to bake a loopback appUrl.
 *
 * The default exists for `npm start`, where the dev server really is on
 * localhost. Shipped, it produces an installer whose every launch — including
 * the one Windows fires at boot, before any dev server exists — points at a
 * machine-local address instead of the deployed app. That failure is silent and
 * only shows up on the user's machine, so it is caught here instead.
 */
const requireRemote = process.argv.includes('--require-remote');
if (requireRemote) {
  let host = '';
  try {
    host = new URL(appUrl).hostname.toLowerCase();
  } catch {
    host = '';
  }

  const isLoopback = !host || host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0';
  if (isLoopback) {
    console.error(
      `\nRefusing to package with APP_URL="${appUrl}".\n`
      + 'A packaged build must point at the deployed app, not at this machine.\n'
      + 'Set it for the build, e.g.:\n'
      + '  Windows (cmd):        set APP_URL=https://app.example.com && npm run dist:win\n'
      + '  Windows (PowerShell): $env:APP_URL="https://app.example.com"; npm run dist:win\n'
    );
    process.exit(1);
  }
}
const DEFAULT_UPDATE_PROVIDER = 'github';
const DEFAULT_UPDATE_OWNER = 'Igrisssssss';
const DEFAULT_UPDATE_REPO = 'carevance_hrms';
const updateProvider = (process.env.DESKTOP_UPDATE_PROVIDER || DEFAULT_UPDATE_PROVIDER).trim().toLowerCase();
const updateUrl = (process.env.DESKTOP_UPDATE_URL || '').trim();
const updateOwner = (process.env.DESKTOP_UPDATE_OWNER || DEFAULT_UPDATE_OWNER).trim();
const updateRepo = (process.env.DESKTOP_UPDATE_REPO || DEFAULT_UPDATE_REPO).trim();
const browserTrackingChromeStoreUrl = (process.env.BROWSER_TRACKING_CHROME_STORE_URL || '').trim();
const browserTrackingEdgeStoreUrl = (process.env.BROWSER_TRACKING_EDGE_STORE_URL || '').trim();
const browserTrackingChromeExtensionOrigin = (process.env.BROWSER_TRACKING_CHROME_EXTENSION_ORIGIN || 'chrome-extension://idokemlmnjpefdelnfiehbnbhjkneplp').trim();
const browserTrackingEdgeExtensionOrigin = (process.env.BROWSER_TRACKING_EDGE_EXTENSION_ORIGIN || '').trim();
const browserTrackingAllowedExtensionOrigins = (process.env.BROWSER_TRACKING_ALLOWED_EXTENSION_ORIGINS || 'chrome-extension://idokemlmnjpefdelnfiehbnbhjkneplp,chrome-extension://ipjfaolaendldffgooakhknllidaeohh')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const resolveUpdateConfig = () => {
  if (updateProvider === 'github' || (!updateProvider && updateOwner && updateRepo)) {
    if (!updateOwner || !updateRepo) {
      return null;
    }

    return {
      provider: 'github',
      owner: updateOwner,
      repo: updateRepo,
    };
  }

  if (updateProvider === 'generic' || (!updateProvider && updateUrl)) {
    if (!updateUrl) {
      return null;
    }

    return {
      provider: 'generic',
      url: updateUrl,
    };
  }

  return null;
};

const config = {
  appUrl,
  update: resolveUpdateConfig(),
  browserTracking: {
    chromeStoreUrl: browserTrackingChromeStoreUrl || null,
    edgeStoreUrl: browserTrackingEdgeStoreUrl || null,
    chromeExtensionOrigin: browserTrackingChromeExtensionOrigin || null,
    edgeExtensionOrigin: browserTrackingEdgeExtensionOrigin || null,
    allowedExtensionOrigins: Array.from(new Set([
      ...browserTrackingAllowedExtensionOrigins,
      browserTrackingChromeExtensionOrigin,
      browserTrackingEdgeExtensionOrigin,
    ].filter(Boolean))),
  },
};

fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
console.log(`Desktop app URL prepared: ${appUrl}`);
if (config.update) {
  console.log(`Desktop update feed prepared: ${config.update.provider}`);
} else {
  console.log('Desktop update feed not configured.');
}

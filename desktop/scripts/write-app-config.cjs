const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '..', 'app-config.json');
const appUrl = (process.env.APP_URL || 'http://localhost:5173').trim();
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
const browserTrackingAllowedExtensionOrigins = (process.env.BROWSER_TRACKING_ALLOWED_EXTENSION_ORIGINS || 'chrome-extension://idokemlmnjpefdelnfiehbnbhjkneplp')
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

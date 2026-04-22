const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SUPPORTED_BROWSER_TRACKING_BROWSERS = new Set(['chrome', 'edge', 'brave', 'opera', 'vivaldi']);
const BROWSER_EXTENSION_MANAGER_URLS = {
  chrome: 'chrome://extensions/',
  edge: 'edge://extensions/',
  brave: 'brave://extensions/',
  opera: 'opera://extensions/',
  vivaldi: 'vivaldi://extensions/',
};

const normalizeBrowserTrackingBrowserName = (value) => {
  const normalized = String(value || 'chrome').trim().toLowerCase();
  return SUPPORTED_BROWSER_TRACKING_BROWSERS.has(normalized) ? normalized : 'chrome';
};

const prepareManagedBrowserTrackingExtensionDir = ({
  sourceDir,
  userDataPath,
  browserName = 'chrome',
  appVersion = 'dev',
}) => {
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Browser tracking extension assets are missing at ${sourceDir}`);
  }

  const manifestPath = path.join(sourceDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Browser tracking manifest not found at ${manifestPath}`);
  }

  const manifestText = fs.readFileSync(manifestPath, 'utf8');
  const normalizedBrowserName = normalizeBrowserTrackingBrowserName(browserName);
  const destinationDir = path.join(
    userDataPath,
    'browser-extension',
    'managed',
    normalizedBrowserName
  );

  const nextManifestHash = crypto.createHash('sha256').update(manifestText).digest('hex');
  const manifestHashPath = path.join(destinationDir, '.manifest-hash');
  const previousManifestHash = fs.existsSync(manifestHashPath)
    ? fs.readFileSync(manifestHashPath, 'utf8').trim()
    : '';

  if (!fs.existsSync(destinationDir) || previousManifestHash !== nextManifestHash) {
    fs.rmSync(destinationDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(destinationDir), { recursive: true });
    fs.cpSync(sourceDir, destinationDir, { recursive: true });
    fs.writeFileSync(manifestHashPath, nextManifestHash, 'utf8');
  }

  return destinationDir;
};

const getBrowserTrackingManagerUrl = (browserName = 'chrome') => {
  const normalizedBrowserName = normalizeBrowserTrackingBrowserName(browserName);
  return BROWSER_EXTENSION_MANAGER_URLS[normalizedBrowserName] || BROWSER_EXTENSION_MANAGER_URLS.chrome;
};

const getBrowserTrackingOptionsUrl = (extensionOrigin) => {
  const normalizedOrigin = String(extensionOrigin || '').trim().replace(/\/+$/, '');
  if (!normalizedOrigin) {
    return null;
  }

  return `${normalizedOrigin}/options.html`;
};

module.exports = {
  getBrowserTrackingManagerUrl,
  getBrowserTrackingOptionsUrl,
  normalizeBrowserTrackingBrowserName,
  prepareManagedBrowserTrackingExtensionDir,
};

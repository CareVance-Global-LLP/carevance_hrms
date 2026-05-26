const { app, BrowserWindow, Notification, desktopCapturer, ipcMain, powerMonitor, screen, shell, safeStorage, Tray, Menu } = require('electron');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { NsisUpdater } = require('electron-updater');
const { createBrowserTrackingBridge } = require('./browser-tracking-bridge.cjs');
const { setupStrongAutoStart } = require('./auto-start.cjs');
const {
  getBrowserTrackingManagerUrl,
  getBrowserTrackingOptionsUrl,
  prepareManagedBrowserTrackingExtensionDir,
} = require('./browser-tracking-install-guide.cjs');
let activeWindowGetter = null;
let activeWindowModulePromise = null;
let retryAfterMsRef = { current: 0 };

const DEFAULT_APP_URL = 'http://localhost:5173';
const readConfiguredAppConfig = () => {
  try {
    const configPath = path.join(__dirname, 'app-config.json');
    if (!fs.existsSync(configPath)) {
      return {};
    }

    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};
const APP_CONFIG = readConfiguredAppConfig();
const APP_URL = process.env.APP_URL || (typeof APP_CONFIG.appUrl === 'string' ? APP_CONFIG.appUrl.trim() : '') || DEFAULT_APP_URL;
const IS_REMOTE_APP_URL = /^https?:\/\//i.test(APP_URL);
const isAllowedAppUrl = (value) => {
  const rawValue = String(value || '').trim();
  if (!rawValue) {
    return false;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(rawValue);
  } catch {
    return false;
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return false;
  }

  if (parsedUrl.protocol === 'https:') {
    return true;
  }

  const hostName = parsedUrl.hostname.toLowerCase();
  return ['localhost', '127.0.0.1'].includes(hostName);
};

const isAllowedExternalUrl = (value, options = {}) => {
  const rawValue = String(value || '').trim();
  if (!rawValue) {
    return false;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(rawValue);
  } catch {
    return false;
  }

  const allowedProtocols = new Set(['https:']);
  if (options.allowLocalHttp) {
    allowedProtocols.add('http:');
  }
  if (options.allowExtensionProtocol) {
    allowedProtocols.add('chrome-extension:');
    allowedProtocols.add('moz-extension:');
    allowedProtocols.add('safari-web-extension:');
  }

  if (!allowedProtocols.has(parsedUrl.protocol)) {
    return false;
  }

  if (parsedUrl.protocol === 'http:') {
    const hostName = parsedUrl.hostname.toLowerCase();
    return ['localhost', '127.0.0.1'].includes(hostName);
  }

  return true;
};

const openExternalUrl = async (value, options = {}) => {
  if (!isAllowedExternalUrl(value, options)) {
    throw new Error(`Refusing to open unsupported external URL: ${String(value || '')}`);
  }

  await shell.openExternal(String(value).trim());
};

if (!isAllowedAppUrl(APP_URL)) {
  throw new Error(`Refusing to load unsupported APP_URL: ${APP_URL}`);
}

const BROWSER_TRACKING_STORE_URLS = {
  chrome: typeof APP_CONFIG?.browserTracking?.chromeStoreUrl === 'string'
    ? APP_CONFIG.browserTracking.chromeStoreUrl.trim()
    : '',
  edge: typeof APP_CONFIG?.browserTracking?.edgeStoreUrl === 'string'
    ? APP_CONFIG.browserTracking.edgeStoreUrl.trim()
    : '',
};
const BROWSER_TRACKING_ALLOWED_EXTENSION_ORIGINS = Array.from(new Set(
  (Array.isArray(APP_CONFIG?.browserTracking?.allowedExtensionOrigins)
    ? APP_CONFIG.browserTracking.allowedExtensionOrigins
    : []
  )
    .map((origin) => String(origin || '').trim().toLowerCase().replace(/\/+$/, ''))
    .filter(Boolean)
));
const APP_ICON = process.platform === 'win32'
  ? path.join(__dirname, 'assets', 'icon.ico')
  : path.join(__dirname, 'assets', 'icon.png');
const APP_ID = 'com.carevance.tracker';
const DEFAULT_SCREENSHOT_MAX_WIDTH = 1920;
const DEFAULT_SCREENSHOT_MAX_HEIGHT = 1080;
const DEFAULT_SCREENSHOT_JPEG_QUALITY = 82;
const FOREGROUND_WINDOW_POLL_INTERVAL_MS = 1000;
const DEVICE_IDENTITY_FILENAME = 'desktop-device.json';
const BROWSER_TRACKING_STATE_FILENAME = 'browser-tracking-state.json';
let mainWindow = null;
let tray = null;
let allowWindowClose = false;
let closePreparationInProgress = false;
let closePreparationTimeout = null;
let autoUpdater = null;
let updateCheckInterval = null;
let foregroundWindowWatcherInterval = null;
let lastForegroundWindowSignature = null;
let systemLockedAt = null;
let updateState = {
  enabled: false,
  status: 'disabled',
  currentVersion: app.getVersion(),
  message: 'Automatic updates are not configured.',
  releaseNotes: '',
  releaseDate: null,
  availableVersion: null,
  downloadedVersion: null,
  progressPercent: 0,
};
let browserTrackingBridge = null;
let desktopDeviceIdentity = null;

app.disableHardwareAcceleration();

app.setName('CareVance Tracker');

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  revealMainWindow();
});

if (process.platform === 'win32') {
  app.setAppUserModelId(APP_ID);
}

const hasReadWriteAccess = (targetPath) => {
  try {
    fs.accessSync(targetPath, fs.constants.R_OK | fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
};

const ensureDirectory = (targetPath) => {
  fs.mkdirSync(targetPath, { recursive: true });
  return targetPath;
};

const resolveWritableUserDataPath = () => {
  const candidates = [];

  try {
    candidates.push(app.getPath('userData'));
  } catch {
    // Fall through to explicit candidates.
  }

  try {
    candidates.push(path.join(app.getPath('appData'), APP_ID));
  } catch {
    // Fall through to home-based candidate.
  }

  try {
    candidates.push(path.join(app.getPath('home'), `.${APP_ID}`));
  } catch {
    // No-op.
  }

  for (const candidate of candidates.filter(Boolean)) {
    try {
      ensureDirectory(candidate);
      if (hasReadWriteAccess(candidate)) {
        return candidate;
      }
    } catch {
      // Try the next candidate.
    }
  }

  return null;
};

const configureRuntimeStorage = () => {
  const userDataPath = resolveWritableUserDataPath();
  if (!userDataPath) {
    console.warn('[desktop-tracker] unable to resolve a writable userData path; Electron will use its default paths');
    return;
  }

  const sessionDataPath = ensureDirectory(path.join(userDataPath, 'SessionData'));
  const cachePath = ensureDirectory(path.join(sessionDataPath, 'Cache'));
  ensureDirectory(path.join(sessionDataPath, 'GPUCache'));
  ensureDirectory(path.join(sessionDataPath, 'Code Cache'));
  ensureDirectory(path.join(sessionDataPath, 'DawnCache'));

  app.setPath('userData', userDataPath);
  app.setPath('sessionData', sessionDataPath);
  app.commandLine.appendSwitch('disk-cache-dir', cachePath);
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
};

configureRuntimeStorage();

const loadActiveWindowGetter = async () => {
  if (activeWindowGetter) {
    return activeWindowGetter;
  }

  const now = Date.now();
  if (retryAfterMsRef.current === 0 || now >= retryAfterMsRef.current) {
    if (!activeWindowModulePromise) {
      activeWindowModulePromise = import('get-windows')
        .then((module) => {
          const getter = typeof module?.activeWindow === 'function' ? module.activeWindow : null;
          activeWindowGetter = getter;
          if (!getter) {
            console.warn('[Tracker] get-windows module loaded but no activeWindow function found');
          }
          return getter;
        })
        .catch((err) => {
          console.warn('[Tracker] get-windows import failed, will retry in 30s:', err?.message || err);
          activeWindowGetter = null;
          retryAfterMsRef.current = now + 30000;
          activeWindowModulePromise = null;
          return null;
        });
    }
  } else {
    // Still within retry cooldown period
    return null;
  }

  return activeWindowModulePromise;
};

const normalizeDeviceLabel = (value) => {
  const normalized = String(value || '').trim();
  if (normalized) {
    return normalized.slice(0, 255);
  }

  const hostName = String(process.env.COMPUTERNAME || os.hostname() || '').trim();
  if (hostName) {
    return hostName.slice(0, 255);
  }

  return 'CareVance Desktop';
};

const buildDesktopDeviceIdentity = () => {
  const identityPath = path.join(app.getPath('userData'), DEVICE_IDENTITY_FILENAME);
  let persistedIdentity = null;

  try {
    if (fs.existsSync(identityPath)) {
      const parsed = JSON.parse(fs.readFileSync(identityPath, 'utf8'));
      if (parsed && typeof parsed === 'object') {
        persistedIdentity = parsed;
      }
    }
  } catch {
    persistedIdentity = null;
  }

  const deviceId = String(persistedIdentity?.device_id || '').trim()
    || `desktop-${crypto.randomUUID()}`;
  const deviceLabel = normalizeDeviceLabel(persistedIdentity?.device_label);
  const identity = {
    device_id: deviceId.slice(0, 120),
    device_label: deviceLabel,
  };

  try {
    fs.writeFileSync(identityPath, JSON.stringify(identity, null, 2), 'utf8');
  } catch {
    // Best-effort persistence. We still return the generated identity for this session.
  }

  return identity;
};

const getDesktopDeviceIdentity = () => {
  if (desktopDeviceIdentity) {
    return desktopDeviceIdentity;
  }

  desktopDeviceIdentity = buildDesktopDeviceIdentity();
  return desktopDeviceIdentity;
};

const parseIntEnv = (key, fallback, min, max) => {
  const parsed = Number.parseInt(String(process.env[key] || ''), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
};

const SCREENSHOT_MAX_WIDTH = parseIntEnv('DESKTOP_SCREENSHOT_MAX_WIDTH', DEFAULT_SCREENSHOT_MAX_WIDTH, 640, 4096);
const SCREENSHOT_MAX_HEIGHT = parseIntEnv('DESKTOP_SCREENSHOT_MAX_HEIGHT', DEFAULT_SCREENSHOT_MAX_HEIGHT, 360, 2160);
const SCREENSHOT_JPEG_QUALITY = parseIntEnv('DESKTOP_SCREENSHOT_JPEG_QUALITY', DEFAULT_SCREENSHOT_JPEG_QUALITY, 60, 95);

const buildScreenshotCaptureAttempts = () => {
  const primaryDisplaySize = screen.getPrimaryDisplay()?.size || { width: SCREENSHOT_MAX_WIDTH, height: SCREENSHOT_MAX_HEIGHT };
  const cappedWidth = Math.max(640, Math.min(primaryDisplaySize.width, SCREENSHOT_MAX_WIDTH));
  const cappedHeight = Math.max(360, Math.min(primaryDisplaySize.height, SCREENSHOT_MAX_HEIGHT));
  const attempts = [
    { width: cappedWidth, height: cappedHeight },
    { width: Math.max(1280, Math.floor(cappedWidth * 0.85)), height: Math.max(720, Math.floor(cappedHeight * 0.85)) },
    { width: 1280, height: 720 },
  ];

  const uniqueBySize = new Map();
  for (const attempt of attempts) {
    uniqueBySize.set(`${attempt.width}x${attempt.height}`, attempt);
  }

  return Array.from(uniqueBySize.values());
};

const resolvePreferredDisplayId = () => {
  try {
    const cursorPoint = screen.getCursorScreenPoint();
    const nearestDisplay = screen.getDisplayNearestPoint(cursorPoint);
    if (nearestDisplay?.id !== undefined && nearestDisplay?.id !== null) {
      return String(nearestDisplay.id);
    }
  } catch {
    // Best-effort only.
  }

  try {
    const primaryDisplay = screen.getPrimaryDisplay();
    if (primaryDisplay?.id !== undefined && primaryDisplay?.id !== null) {
      return String(primaryDisplay.id);
    }
  } catch {
    // Best-effort only.
  }

  return null;
};

const pickBestScreenSource = (sources, preferredDisplayId) => {
  const nonEmptySources = sources.filter((source) => source?.thumbnail && !source.thumbnail.isEmpty());
  if (!nonEmptySources.length) {
    return null;
  }

  if (preferredDisplayId) {
    const preferredSource = nonEmptySources.find((source) => String(source.display_id || '') === preferredDisplayId);
    if (preferredSource) {
      return preferredSource;
    }
  }

  const primaryDisplayId = String(screen.getPrimaryDisplay()?.id ?? '');
  if (primaryDisplayId !== '') {
    const primarySource = nonEmptySources.find((source) => String(source.display_id || '') === primaryDisplayId);
    if (primarySource) {
      return primarySource;
    }
  }

  return nonEmptySources
    .slice()
    .sort((left, right) => {
      const leftSize = left.thumbnail.getSize();
      const rightSize = right.thumbnail.getSize();

      return (rightSize.width * rightSize.height) - (leftSize.width * leftSize.height);
    })[0];
};

const thumbnailToDataUrl = (thumbnail) => {
  if (!thumbnail || thumbnail.isEmpty()) {
    return null;
  }

  try {
    const jpegBuffer = thumbnail.toJPEG(SCREENSHOT_JPEG_QUALITY);
    if (jpegBuffer?.length) {
      return `data:image/jpeg;base64,${jpegBuffer.toString('base64')}`;
    }
  } catch {
    // Fall through to PNG encoding if JPEG conversion fails.
  }

  try {
    return thumbnail.toDataURL();
  } catch {
    return null;
  }
};

const resolveUpdateConfig = () => {
  const configuredUpdate = APP_CONFIG.update && typeof APP_CONFIG.update === 'object'
    ? APP_CONFIG.update
    : null;
  const provider = String(process.env.DESKTOP_UPDATE_PROVIDER || configuredUpdate?.provider || '').trim().toLowerCase();
  const owner = String(process.env.DESKTOP_UPDATE_OWNER || configuredUpdate?.owner || '').trim();
  const repo = String(process.env.DESKTOP_UPDATE_REPO || configuredUpdate?.repo || '').trim();
  const url = String(process.env.DESKTOP_UPDATE_URL || configuredUpdate?.url || '').trim();

  if ((provider === 'github' || (!provider && owner && repo)) && owner && repo) {
    return {
      provider: 'github',
      owner,
      repo,
    };
  }

  if ((provider === 'generic' || (!provider && url)) && url) {
    return {
      provider: 'generic',
      url,
    };
  }

  return null;
};

const normalizeReleaseNotes = (releaseNotes) => {
  if (!releaseNotes) {
    return '';
  }

  if (typeof releaseNotes === 'string') {
    return releaseNotes.trim();
  }

  if (Array.isArray(releaseNotes)) {
    return releaseNotes
      .map((note) => {
        if (!note) {
          return '';
        }

        const versionHeading = typeof note.version === 'string' && note.version.trim()
          ? `Version ${note.version.trim()}`
          : '';
        const noteBody = typeof note.note === 'string' ? note.note.trim() : '';
        return [versionHeading, noteBody].filter(Boolean).join('\n');
      })
      .filter(Boolean)
      .join('\n\n');
  }

  return '';
};

const broadcastUpdateState = () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send('desktop:update-state', updateState);
};

const broadcastBrowserTrackingState = () => {
  if (!mainWindow || mainWindow.isDestroyed() || !browserTrackingBridge) {
    return;
  }

  mainWindow.webContents.send('desktop:browser-tracking-state', browserTrackingBridge.getRendererState());
};

const currentSystemLockState = (state = null) => ({
  state: state || (systemLockedAt ? 'locked' : 'unlocked'),
  locked: Boolean(systemLockedAt),
  locked_at: systemLockedAt ? systemLockedAt.toISOString() : null,
  recorded_at: new Date().toISOString(),
});

const broadcastSystemLockState = (state) => {
  const payload = currentSystemLockState(state);

  if (!mainWindow || mainWindow.isDestroyed()) {
    return payload;
  }

  mainWindow.webContents.send('desktop:system-lock-state', payload);
  return payload;
};

const markSystemLocked = (state = 'locked') => {
  if (!systemLockedAt) {
    systemLockedAt = new Date();
  }

  broadcastSystemLockState(state);
};

const markSystemUnlocked = (state = 'unlocked') => {
  systemLockedAt = null;
  broadcastSystemLockState(state);
};

const setUpdateState = (patch) => {
  updateState = {
    ...updateState,
    ...patch,
    currentVersion: app.getVersion(),
  };
  broadcastUpdateState();
};

const proceedToCloseWindow = () => {
  if (closePreparationTimeout) {
    clearTimeout(closePreparationTimeout);
    closePreparationTimeout = null;
  }

  closePreparationInProgress = false;

  if (!mainWindow || mainWindow.isDestroyed()) {
    return false;
  }

  allowWindowClose = true;
  mainWindow.close();
  return true;
};

const stopForegroundWindowWatcher = () => {
  if (foregroundWindowWatcherInterval) {
    clearInterval(foregroundWindowWatcherInterval);
    foregroundWindowWatcherInterval = null;
  }
  lastForegroundWindowSignature = null;
};

// Cache for process metadata (description, product name) keyed by process name
const processMetadataCache = new Map();

const getProcessDescription = async (processName) => {
  const key = String(processName || '').trim().toLowerCase();
  if (!key) return null;
  if (processMetadataCache.has(key)) return processMetadataCache.get(key);

  try {
    const result = execSync(
      `powershell -NoProfile -NonInteractive -Command "& {Get-Process -Name '${key.replace(/'/g, "''")}' -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Description}"`,
      { timeout: 2000, encoding: 'utf8' }
    ).trim();
    if (result && result.length > 0 && result.length < 200) {
      processMetadataCache.set(key, result);
      return result;
    }
  } catch {
    // PowerShell failed, fall through
  }
  processMetadataCache.set(key, null);
  return null;
};

const getAllProcessesWithWindows = async () => {
  try {
    // Simple fallback: get all running processes with window titles
    const result = execSync(
      `powershell -NoProfile -NonInteractive -Command "& {Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object Name, Description, Product, Company, MainWindowTitle, Id | ConvertTo-Json -Compress}"`,
      { timeout: 5000, encoding: 'utf8' }
    ).trim();
    if (result && result.startsWith('[') || result.startsWith('{')) {
      return JSON.parse(result);
    }
  } catch {
    // Not critical
  }
  return [];
};

const getForegroundWindowPayload = async () => {
  const getActiveWindow = await loadActiveWindowGetter();
  if (!getActiveWindow) {
    return null;
  }

  try {
    const context = await getActiveWindow();
    const app = context?.owner?.name || null;
    // Lookup process description asynchronously (non-blocking)
    const description = app ? await getProcessDescription(app) : null;
    return {
      app: app,
      title: context?.title || null,
      url: context?.url || null,
      description: description,
      captured_at: new Date().toISOString(),
    };
  } catch {
    return {
      app: null,
      title: null,
      url: null,
      description: null,
      captured_at: new Date().toISOString(),
    };
  }
};

const emitForegroundWindowChange = async () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const payload = await getForegroundWindowPayload();
  if (!payload) {
    return;
  }

  const signature = JSON.stringify({
    app: payload.app || null,
    title: payload.title || null,
    url: payload.url || null,
    description: payload.description || null,
  });

  if (signature === lastForegroundWindowSignature) {
    return;
  }

  lastForegroundWindowSignature = signature;
  mainWindow.webContents.send('desktop:foreground-window-changed', payload);
};

const startForegroundWindowWatcher = () => {
  stopForegroundWindowWatcher();

  foregroundWindowWatcherInterval = setInterval(() => {
    void emitForegroundWindowChange();
  }, FOREGROUND_WINDOW_POLL_INTERVAL_MS);

  void emitForegroundWindowChange();
};

const ensureBrowserTrackingBridge = () => {
  if (browserTrackingBridge) {
    return browserTrackingBridge;
  }

  const encryptBrowserTrackingState = (plaintext) => {
    const value = String(plaintext || '');
    if (!value) {
      return null;
    }

    if (!safeStorage?.isEncryptionAvailable?.()) {
      return null;
    }

    try {
      return safeStorage.encryptString(value);
    } catch {
      return null;
    }
  };

  const decryptBrowserTrackingState = (payload) => {
    if (!payload || !safeStorage?.isEncryptionAvailable?.()) {
      return null;
    }

    try {
      return safeStorage.decryptString(Buffer.from(payload));
    } catch {
      return null;
    }
  };

  browserTrackingBridge = createBrowserTrackingBridge({
    stateFilePath: path.join(app.getPath('userData'), BROWSER_TRACKING_STATE_FILENAME),
    encryptState: encryptBrowserTrackingState,
    decryptState: decryptBrowserTrackingState,
    allowedExtensionOrigins: BROWSER_TRACKING_ALLOWED_EXTENSION_ORIGINS,
    onBrowserEvent: async (event) => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        return;
      }

      mainWindow.webContents.send('desktop:browser-tracking-event', event);
      broadcastBrowserTrackingState();
    },
    onStateChanged: () => {
      broadcastBrowserTrackingState();
    },
  });

  return browserTrackingBridge;
};

const ensureBrowserTrackingBridgeReady = async () => {
  const bridge = ensureBrowserTrackingBridge();
  const state = bridge.getRendererState();
  if (state?.ready) {
    return state;
  }

  return bridge.start();
};

const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const buildRendererLoadErrorDataUrl = ({
  appUrl,
  errorCode,
  errorDescription,
  failedUrl,
}) => {
  const diagnostics = [
    `Configured app URL: ${appUrl}`,
    failedUrl ? `Failed URL: ${failedUrl}` : '',
    typeof errorCode === 'number' ? `Error code: ${errorCode}` : '',
    errorDescription ? `Error: ${errorDescription}` : '',
  ].filter(Boolean);

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>CareVance desktop load error</title>
    <style>
      body { margin: 0; font-family: Segoe UI, Arial, sans-serif; background: #f8fafc; color: #0f172a; }
      .wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
      .card { width: min(760px, 100%); background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; box-shadow: 0 14px 35px rgba(15,23,42,0.08); }
      h1 { margin: 0 0 10px; font-size: 20px; }
      p { margin: 0 0 12px; line-height: 1.5; }
      ul { margin: 8px 0 0; padding-left: 18px; }
      code { font-family: Consolas, monospace; background: #f1f5f9; border-radius: 4px; padding: 2px 6px; }
      .actions { margin-top: 18px; display: flex; gap: 10px; }
      button { border: none; border-radius: 8px; padding: 10px 14px; font-weight: 600; cursor: pointer; }
      .primary { background: #0ea5e9; color: #ffffff; }
      .secondary { background: #e2e8f0; color: #0f172a; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <h1>Desktop app could not load the web workspace</h1>
        <p>CareVance desktop opened, but the configured web URL is not reachable from this machine.</p>
        <p>Set a reachable <code>APP_URL</code> when packaging/running the desktop app (for production this should be your deployed HTTPS app URL).</p>
        <ul>${diagnostics.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
        <div class="actions">
          <button class="primary" onclick="location.reload()">Retry</button>
          <button class="secondary" onclick="window.location.href='${escapeHtml(appUrl)}'">Open APP_URL</button>
        </div>
      </div>
    </div>
  </body>
</html>`;

  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
};

const renderRendererLoadError = async (details) => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  try {
    await mainWindow.loadURL(buildRendererLoadErrorDataUrl(details));
  } catch {
    // Last-resort fallback: keep app alive even if fallback screen fails.
  }
};

let showMainWindowTimeout = null;

const showMainWindow = () => {
  if (showMainWindowTimeout) {
    clearTimeout(showMainWindowTimeout);
    showMainWindowTimeout = null;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
  }
};

const createWindow = async () => {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 860,
    minWidth: 1024,
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f8fafc',
    title: 'CareVance Tracker',
    icon: APP_ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  let failRetryCount = 0;
  const MAX_FAIL_RETRIES = 5;
  const FAIL_RETRY_DELAY = 3000;

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || String(validatedURL || '').startsWith('data:text/html')) {
      return;
    }

    console.error('[desktop] failed to load renderer', {
      appUrl: APP_URL,
      failedUrl: validatedURL,
      errorCode,
      errorDescription,
    });

    // ERR_ABORTED (-3) is caused by SPA client-side routing (pushState/replaceState)
    // during initial page load. The page still loads fine — don't retry or error.
    if (errorCode === -3) {
      return;
    }

    if (failRetryCount < MAX_FAIL_RETRIES) {
      failRetryCount++;
      console.log(`[desktop] retrying load (${failRetryCount}/${MAX_FAIL_RETRIES}) in ${FAIL_RETRY_DELAY}ms...`);
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.loadURL(APP_URL).catch(() => {});
        }
      }, FAIL_RETRY_DELAY);
      return;
    }

    void renderRendererLoadError({
      appUrl: APP_URL,
      errorCode,
      errorDescription,
      failedUrl: validatedURL,
    });
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[desktop] renderer process exited', {
      appUrl: APP_URL,
      reason: details?.reason || 'unknown',
      exitCode: typeof details?.exitCode === 'number' ? details.exitCode : null,
    });

    void renderRendererLoadError({
      appUrl: APP_URL,
      errorDescription: `Renderer process exited (${details?.reason || 'unknown'})`,
      failedUrl: String(mainWindow?.webContents?.getURL() || APP_URL),
    });
  });

  if (app.isPackaged && IS_REMOTE_APP_URL) {
    try {
      await mainWindow.webContents.session.clearCache();
    } catch {
      // Best-effort cache clearing to avoid stale chunk files after web deployments.
    }
  }

  try {
    await mainWindow.loadURL(APP_URL);
  } catch (error) {
    const errMsg = (error?.message || '').toLowerCase();
    const isAborted = errMsg.includes('err_aborted') || error?.errno === -3;

    if (!isAborted) {
      const errorDescription = error?.message || 'Unknown renderer load error';
      console.error('[desktop] initial renderer load failed', {
        appUrl: APP_URL,
        errorDescription,
      });
      await renderRendererLoadError({
        appUrl: APP_URL,
        errorDescription,
        failedUrl: APP_URL,
      });
    } else {
      console.warn('[desktop] initial loadURL aborted by SPA routing — waiting for did-finish-load...');
    }
  }

  showMainWindowTimeout = setTimeout(() => {
    showMainWindow();
  }, 5000);

  mainWindow.webContents.on('did-finish-load', () => {
    const loadedUrl = String(mainWindow?.webContents?.getURL() || '');
    if (!/^https?:\/\//i.test(loadedUrl)) {
      return;
    }

    showMainWindow();
    broadcastUpdateState();
    broadcastBrowserTrackingState();
    startForegroundWindowWatcher();

    if (!tray && process.platform === 'win32') {
      createTray();
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url, { allowLocalHttp: true })) {
      void openExternalUrl(url, { allowLocalHttp: true }).catch(() => {
        // Ignore unsupported or failed external launches initiated by web content.
      });
    }
    return { action: 'deny' };
  });

  mainWindow.on('close', (event) => {
    if (allowWindowClose) {
      return;
    }

    event.preventDefault();

    if (closePreparationInProgress) {
      // Second click — force close immediately
      allowWindowClose = true;
      mainWindow.close();
      return;
    }

    closePreparationInProgress = true;

    try {
      mainWindow.webContents.send('desktop:prepare-close');
    } catch {
      proceedToCloseWindow();
      return;
    }

    closePreparationTimeout = setTimeout(() => {
      proceedToCloseWindow();
    }, 3000);
  });

  mainWindow.on('closed', () => {
    if (closePreparationTimeout) {
      clearTimeout(closePreparationTimeout);
      closePreparationTimeout = null;
    }
    stopForegroundWindowWatcher();
    allowWindowClose = false;
    closePreparationInProgress = false;
    mainWindow = null;
  });
};

const revealMainWindow = () => {
  const targetWindow = mainWindow && !mainWindow.isDestroyed()
    ? mainWindow
    : BrowserWindow.getAllWindows()[0];

  if (!targetWindow) {
    return false;
  }

  if (targetWindow.isMinimized()) {
    targetWindow.restore();
  }

  if (targetWindow.isFullScreen()) {
    targetWindow.setFullScreen(false);
  }

  if (!targetWindow.isMaximized()) {
    targetWindow.maximize();
  }

  if (!targetWindow.isVisible()) {
    targetWindow.show();
  }

  targetWindow.setSkipTaskbar(false);
  targetWindow.setFocusable(true);
  targetWindow.setAlwaysOnTop(true, 'screen-saver', 1);
  targetWindow.flashFrame(true);

  const bringToFront = () => {
    if (targetWindow.isDestroyed()) {
      return;
    }

    app.focus();
    targetWindow.show();
    if (typeof targetWindow.moveTop === 'function') {
      targetWindow.moveTop();
    }
    targetWindow.focus();
    targetWindow.webContents.focus();
  };

  bringToFront();
  setTimeout(bringToFront, 150);
  setTimeout(bringToFront, 500);

  setTimeout(() => {
    if (!targetWindow.isDestroyed()) {
      targetWindow.setAlwaysOnTop(false);
      targetWindow.flashFrame(false);
    }
  }, 3000);

  return true;
};

const createTray = () => {
  if (process.platform !== 'win32') return;

  const trayIconPath = path.join(__dirname, 'tray-icon.ico');
  const iconPath = fs.existsSync(trayIconPath) ? trayIconPath : APP_ICON;

  tray = new Tray(iconPath);
  tray.setToolTip('CareVance Tracker');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open CareVance Tracker',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.setSkipTaskbar(false);
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Exit',
      click: () => {
        allowWindowClose = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.setSkipTaskbar(false);
      mainWindow.focus();
    }
  });

  console.log('[desktop] System tray created');
};

const checkForDesktopUpdates = async () => {
  if (!autoUpdater) {
    return null;
  }

  return autoUpdater.checkForUpdates();
};

const initializeAutoUpdater = () => {
  const updaterConfig = resolveUpdateConfig();

  if (!app.isPackaged) {
    setUpdateState({
      enabled: false,
      status: 'disabled',
      message: 'Automatic updates are disabled in development builds.',
    });
    return;
  }

  if (process.platform !== 'win32') {
    setUpdateState({
      enabled: false,
      status: 'disabled',
      message: 'Automatic updates are currently enabled only for Windows desktop builds.',
    });
    return;
  }

  if (!updaterConfig) {
    setUpdateState({
      enabled: false,
      status: 'disabled',
      message: 'Automatic updates are not configured for this desktop build.',
    });
    return;
  }

  autoUpdater = new NsisUpdater(updaterConfig);
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.fullChangelog = true;

  setUpdateState({
    enabled: true,
    status: 'idle',
    message: 'Updates are ready to check.',
  });

  autoUpdater.on('checking-for-update', () => {
    setUpdateState({
      status: 'checking',
      message: 'Checking for desktop updates...',
      progressPercent: 0,
    });
  });

  autoUpdater.on('update-available', (info) => {
    setUpdateState({
      status: 'available',
      message: `Version ${info.version} is available.`,
      availableVersion: info.version || null,
      downloadedVersion: null,
      releaseDate: info.releaseDate || null,
      releaseNotes: normalizeReleaseNotes(info.releaseNotes),
      progressPercent: 0,
    });
  });

  autoUpdater.on('update-not-available', () => {
    setUpdateState({
      status: 'current',
      message: 'You are already on the latest desktop version.',
      availableVersion: null,
      downloadedVersion: null,
      releaseDate: null,
      releaseNotes: '',
      progressPercent: 0,
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    setUpdateState({
      status: 'downloading',
      message: `Downloading update ${Math.round(progress.percent || 0)}%`,
      progressPercent: Number(progress.percent || 0),
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    setUpdateState({
      status: 'downloaded',
      message: `Version ${info.version} is ready to install.`,
      availableVersion: info.version || null,
      downloadedVersion: info.version || null,
      releaseDate: info.releaseDate || null,
      releaseNotes: normalizeReleaseNotes(info.releaseNotes),
      progressPercent: 100,
    });
  });

  autoUpdater.on('error', (error) => {
    setUpdateState({
      status: 'error',
      message: error?.message || 'Unable to check for desktop updates.',
      progressPercent: 0,
    });
  });

  setTimeout(() => {
    void checkForDesktopUpdates();
  }, 3000);

  updateCheckInterval = setInterval(() => {
    void checkForDesktopUpdates();
  }, 30 * 60 * 1000);
};

ipcMain.handle('desktop:capture-screenshot', async () => {
  const preferredDisplayId = resolvePreferredDisplayId();
  const attempts = buildScreenshotCaptureAttempts();

  for (const attempt of attempts) {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: attempt.width, height: attempt.height },
    });

    if (!sources.length) {
      continue;
    }

    const bestSource = pickBestScreenSource(sources, preferredDisplayId);
    const dataUrl = thumbnailToDataUrl(bestSource?.thumbnail || null);
    if (dataUrl) {
      return dataUrl;
    }
  }

  console.warn('[desktop-tracker] screenshot capture returned no usable source', {
    preferredDisplayId,
    attempts,
  });

  return null;
});

ipcMain.handle('desktop:get-system-idle-seconds', async () => {
  return powerMonitor.getSystemIdleTime();
});

ipcMain.handle('desktop:get-system-lock-state', async () => currentSystemLockState());

ipcMain.handle('desktop:get-active-window-context', async () => {
  const getActiveWindow = await loadActiveWindowGetter();
  if (!getActiveWindow) {
    return null;
  }

  try {
    const context = await getActiveWindow();
    if (!context) return null;

    const app = context.owner?.name || null;
    const description = app ? await getProcessDescription(app) : null;

    return {
      app: app,
      title: context.title || null,
      url: context.url || null,
      description: description,
      captured_at: new Date().toISOString(),
    };
  } catch {
    return null;
  }
});

ipcMain.handle('desktop:get-all-window-contexts', async () => {
  const processes = await getAllProcessesWithWindows();
  return processes;
});

ipcMain.handle('desktop:reveal-window', async () => {
  return revealMainWindow();
});

ipcMain.handle('desktop:show-notification', async (_event, payload = {}) => {
  if (!Notification.isSupported()) {
    return false;
  }

  const title = String(payload.title || 'CareVance').trim() || 'CareVance';
  const body = String(payload.body || '').trim();
  const id = Number(payload.id || 0);
  const route = String(payload.route || '').trim();
  const type = String(payload.type || '').trim();

  const notification = new Notification({
    title,
    body,
    silent: false,
  });

  notification.on('click', () => {
    revealMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('desktop:notification-clicked', {
        id,
        route,
        type,
      });
    }
  });

  notification.show();
  return true;
});

ipcMain.handle('desktop:confirm-close-ready', async () => {
  return proceedToCloseWindow();
});

ipcMain.handle('desktop:get-device-identity', async () => {
  return getDesktopDeviceIdentity();
});

ipcMain.handle('desktop:get-browser-tracking-state', async () => {
  return ensureBrowserTrackingBridge().getRendererState();
});

ipcMain.handle('desktop:open-browser-tracking-guide', async (_event, payload) => {
  const extensionDir = prepareManagedBrowserTrackingExtensionDir({
    sourceDir: path.join(__dirname, 'assets', 'browser-extension', 'chromium'),
    userDataPath: app.getPath('userData'),
    browserName: payload?.browser_name || 'chrome',
    appVersion: app.getVersion(),
  });
  const openError = await shell.openPath(extensionDir);

  if (openError) {
    throw new Error(openError);
  }

  return true;
});

ipcMain.handle('desktop:open-browser-tracking-install', async (_event, payload) => {
  const browserName = String(payload?.browser_name || 'chrome').trim().toLowerCase() || 'chrome';
  const storeUrl = BROWSER_TRACKING_STORE_URLS[browserName]
    || (browserName !== 'edge' ? BROWSER_TRACKING_STORE_URLS.chrome : '');

  if (storeUrl) {
    await openExternalUrl(storeUrl);
    return true;
  }

  await openExternalUrl(getBrowserTrackingManagerUrl(browserName));
  return true;
});

ipcMain.handle('desktop:open-browser-tracking-options', async (_event, payload) => {
  const optionsUrl = getBrowserTrackingOptionsUrl(payload?.extension_origin);
  if (!optionsUrl) {
    throw new Error('The browser extension options page is not available yet. Install and pair the extension first.');
  }

  await openExternalUrl(optionsUrl, { allowExtensionProtocol: true });
  return true;
});

ipcMain.handle('desktop:create-browser-tracking-pairing-code', async (_event, payload) => {
  const requestedUserId = Number(payload?.user_id);
  if (!Number.isFinite(requestedUserId)) {
    throw new Error('A signed-in user id is required to create a browser tracking pairing code.');
  }

  const bridgeState = await ensureBrowserTrackingBridgeReady();
  if (!bridgeState?.ready) {
    throw new Error(`Browser tracking bridge is unavailable: ${bridgeState?.last_error || 'Unable to listen on the local pairing port.'}`);
  }

  const pairing = ensureBrowserTrackingBridge().issuePairingCode({
    browserName: payload?.browser_name || 'chrome',
    userId: requestedUserId,
  });

  broadcastBrowserTrackingState();
  return pairing;
});

ipcMain.handle('desktop:get-update-state', async () => {
  return updateState;
});

ipcMain.handle('desktop:check-for-updates', async () => {
  await checkForDesktopUpdates();
  return updateState;
});

ipcMain.handle('desktop:download-update', async () => {
  if (!autoUpdater) {
    throw new Error('Automatic updates are not configured.');
  }

  await autoUpdater.downloadUpdate();
  return updateState;
});

ipcMain.handle('desktop:install-update', async () => {
  if (!autoUpdater) {
    throw new Error('Automatic updates are not configured.');
  }

  setImmediate(() => {
    autoUpdater.quitAndInstall(false, true);
  });

  return true;
});

if (hasSingleInstanceLock) {
app.whenReady().then(async () => {
  setupStrongAutoStart();

  powerMonitor.on('lock-screen', () => {
    markSystemLocked('locked');
  });
  powerMonitor.on('unlock-screen', () => {
    markSystemUnlocked('unlocked');
  });
  powerMonitor.on('suspend', () => {
    markSystemLocked('suspended');
  });
  powerMonitor.on('resume', () => {
    markSystemUnlocked('resumed');
  });

  const browserTrackingState = await ensureBrowserTrackingBridge().start();
  if (!browserTrackingState?.ready) {
    console.warn('[desktop-tracker] browser tracking bridge unavailable', browserTrackingState?.last_error || '');
  }

  void createWindow();
  initializeAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform === 'win32' && tray) {
    return;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (updateCheckInterval) {
    clearInterval(updateCheckInterval);
    updateCheckInterval = null;
  }
  stopForegroundWindowWatcher();
  if (browserTrackingBridge) {
    void browserTrackingBridge.stop().catch(() => {
      // Best-effort shutdown.
    });
  }
});
}

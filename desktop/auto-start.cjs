const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const APP_NAME = 'CareVance Tracker';
const REGISTRY_RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const REGISTRY_RUN_VALUE = 'CareVanceTracker';
const TASK_NAME = 'CareVanceTrackerAutoStart';

/**
 * Build the correct command to launch the app from auto-start.
 * - Packaged: the .exe IS the app, so use it directly.
 * - Development: electron.exe needs the app directory argument,
 *   so we write a tiny wrapper .cmd and point the registry to it.
 */
const resolveLaunchCommand = () => {
  const appDir = path.resolve(__dirname);

  if (app.isPackaged) {
    // Packaged builds: process.execPath is the actual CareVance Tracker.exe
    return `"${process.execPath}"`;
  }

  // Development builds: create a wrapper so Windows knows where the app lives
  const wrapperDir = path.join(app.getPath('userData'), 'auto-start');
  fs.mkdirSync(wrapperDir, { recursive: true });

  const wrapperPath = path.join(wrapperDir, 'carevance-startup.cmd');
  const electronExe = path.join(appDir, 'node_modules', 'electron', 'dist', 'electron.exe');

  const runCommand = fs.existsSync(electronExe)
    ? `"${electronExe}" "${appDir}"`
    : `cd /d "${appDir}" && npm run start`;

  const wrapperContent = `@echo off\r\n${runCommand}\r\n`;
  fs.writeFileSync(wrapperPath, wrapperContent, 'utf8');

  return `"${wrapperPath}"`;
};

/**
 * Clean up legacy redundant auto-start entries that may have been created
 * by previous versions (startup folder batch, task scheduler).
 * This prevents duplicate popups on boot.
 */
const cleanupLegacyAutoStart = () => {
  if (process.platform !== 'win32') return;

  const startupFolder = path.join(
    process.env.APPDATA || path.join(process.env.USERPROFILE, 'AppData', 'Roaming'),
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'Startup'
  );

  // Remove old startup batch file
  try {
    const batchPath = path.join(startupFolder, `${APP_NAME}.bat`);
    if (fs.existsSync(batchPath)) {
      fs.unlinkSync(batchPath);
      console.log('[auto-start] Removed legacy startup batch file');
    }
  } catch {}

  // Remove old task scheduler task
  try {
    execSync(`schtasks /delete /tn "${TASK_NAME}" /f`, { stdio: 'ignore' });
    console.log('[auto-start] Removed legacy Task Scheduler task');
  } catch {}

  // Remove Electron login item (we now use Registry exclusively on Windows)
  try {
    app.setLoginItemSettings({ openAtLogin: false });
  } catch {}
};

/**
 * Single, reliable auto-start implementation for Windows.
 * Uses the Registry Run key with the correct command.
 * Cleans up any legacy redundant entries first.
 */
const setupStrongAutoStart = () => {
  if (process.platform !== 'win32') return;

  // Remove old duplicate mechanisms first so we don't get 3 popups
  cleanupLegacyAutoStart();

  const launchCommand = resolveLaunchCommand();

  // Single method: Windows Registry Run key
  try {
    const registryCommand = `reg add "${REGISTRY_RUN_KEY}" /v "${REGISTRY_RUN_VALUE}" /t REG_SZ /d "${launchCommand}" /f`;
    execSync(registryCommand, { stdio: 'ignore' });
    console.log('[auto-start] Registry Run key set successfully');
  } catch (error) {
    console.warn('[auto-start] Failed to set Registry Run key:', error.message);
  }

  console.log('[auto-start] Auto-start setup complete');
};

/**
 * Check if auto-start is enabled
 */
const isAutoStartEnabled = () => {
  if (process.platform !== 'win32') return false;

  try {
    const registryCheck = execSync(
      `reg query "${REGISTRY_RUN_KEY}" /v "${REGISTRY_RUN_VALUE}"`,
      { stdio: 'pipe' }
    ).toString();
    return registryCheck.includes(REGISTRY_RUN_VALUE);
  } catch {
    return false;
  }
};

/**
 * Disable auto-start and clean up all traces
 */
const disableAutoStart = () => {
  if (process.platform !== 'win32') return;

  // Remove Registry key
  try {
    execSync(`reg delete "${REGISTRY_RUN_KEY}" /v "${REGISTRY_RUN_VALUE}" /f`, { stdio: 'ignore' });
  } catch {}

  cleanupLegacyAutoStart();

  console.log('[auto-start] Auto-start disabled');
};

module.exports = {
  setupStrongAutoStart,
  isAutoStartEnabled,
  disableAutoStart,
};

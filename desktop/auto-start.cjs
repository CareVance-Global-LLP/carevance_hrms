const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const APP_NAME = 'CareVance Tracker';
const REGISTRY_RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const REGISTRY_RUN_VALUE = 'CareVanceTracker';

/**
 * Strong auto-start implementation for Windows
 * Uses multiple fallback mechanisms:
 * 1. Windows Registry Run key (primary)
 * 2. Startup folder shortcut (fallback)
 * 3. Task Scheduler (backup)
 */
const setupStrongAutoStart = () => {
  if (process.platform !== 'win32') return;

  const exePath = process.execPath;
  const appPath = path.dirname(exePath);
  const appName = path.basename(exePath);
  const startupFolder = path.join(
    process.env.APPDATA || path.join(process.env.USERPROFILE, 'AppData', 'Roaming'),
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'Startup'
  );
  const shortcutPath = path.join(startupFolder, `${APP_NAME}.lnk`);

  // Method 1: Windows Registry Run key (most reliable)
  try {
    const registryCommand = `reg add "${REGISTRY_RUN_KEY}" /v "${REGISTRY_RUN_VALUE}" /t REG_SZ /d "\"${exePath}\"" /f`;
    execSync(registryCommand, { stdio: 'ignore' });
    console.log('[auto-start] Registry Run key set successfully');
  } catch (error) {
    console.warn('[auto-start] Failed to set Registry Run key:', error.message);
  }

  // Method 2: Startup folder shortcut
  try {
    if (!fs.existsSync(startupFolder)) {
      fs.mkdirSync(startupFolder, { recursive: true });
    }

    const batchContent = `@echo off
start "" "${exePath}"
`;
    const batchPath = path.join(startupFolder, `${APP_NAME}.bat`);
    fs.writeFileSync(batchPath, batchContent, 'utf8');
    console.log('[auto-start] Startup batch file created');
  } catch (error) {
    console.warn('[auto-start] Failed to create startup shortcut:', error.message);
  }

  // Method 3: Task Scheduler (backup for persistence)
  try {
    const taskName = 'CareVanceTrackerAutoStart';
    const taskXml = `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Auto-start CareVance Tracker on user login</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>true</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>"${exePath}"</Command>
    </Exec>
  </Actions>
</Task>`;

    const taskXmlPath = path.join(appPath, 'auto-start-task.xml');
    fs.writeFileSync(taskXmlPath, taskXml, 'utf8');

    // Delete existing task if any
    execSync(`schtasks /delete /tn "${taskName}" /f`, { stdio: 'ignore' });

    // Create new task
    execSync(`schtasks /create /tn "${taskName}" /xml "${taskXmlPath}" /f`, { stdio: 'ignore' });

    // Clean up temp file
    fs.unlinkSync(taskXmlPath);

    console.log('[auto-start] Task Scheduler task created');
  } catch (error) {
    console.warn('[auto-start] Failed to create Task Scheduler task:', error.message);
  }

  // Also use Electron's built-in method as additional layer
  try {
    app.setLoginItemSettings({
      openAtLogin: true,
      openAsHidden: false,
    });
    console.log('[auto-start] Electron login item settings set');
  } catch (error) {
    console.warn('[auto-start] Failed to set Electron login item:', error.message);
  }

  console.log('[auto-start] Strong auto-start setup complete');
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
 * Disable auto-start (remove all methods)
 */
const disableAutoStart = () => {
  if (process.platform !== 'win32') return;

  // Remove Registry key
  try {
    execSync(`reg delete "${REGISTRY_RUN_KEY}" /v "${REGISTRY_RUN_VALUE}" /f`, { stdio: 'ignore' });
  } catch {}

  // Remove startup batch file
  try {
    const startupFolder = path.join(
      process.env.APPDATA || path.join(process.env.USERPROFILE, 'AppData', 'Roaming'),
      'Microsoft',
      'Windows',
      'Start Menu',
      'Programs',
      'Startup'
    );
    const batchPath = path.join(startupFolder, `${APP_NAME}.bat`);
    if (fs.existsSync(batchPath)) {
      fs.unlinkSync(batchPath);
    }
  } catch {}

  // Remove Task Scheduler task
  try {
    execSync('schtasks /delete /tn "CareVanceTrackerAutoStart" /f', { stdio: 'ignore' });
  } catch {}

  // Remove Electron login item
  try {
    app.setLoginItemSettings({ openAtLogin: false });
  } catch {}

  console.log('[auto-start] Auto-start disabled');
};

module.exports = {
  setupStrongAutoStart,
  isAutoStartEnabled,
  disableAutoStart,
};

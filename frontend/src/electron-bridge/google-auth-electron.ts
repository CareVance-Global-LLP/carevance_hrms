// This file should be added to your Electron desktop app main process
// File: electron-main/google-auth.ts or similar

import { BrowserWindow, ipcMain, BrowserWindowConstructorOptions } from 'electron';

interface GoogleAuthResult {
  credential: string;
}

// Store the main window reference
let mainWindow: BrowserWindow | null = null;

export function setupGoogleAuthHandlers(mainWin: BrowserWindow) {
  mainWindow = mainWin;

  // Handle start Google OAuth
  ipcMain.handle('startGoogleAuth', async () => {
    return new Promise<GoogleAuthResult | null>((resolve) => {
      // Get screen dimensions
      const { width, height } = require('electron').screen.getPrimaryDisplay().workAreaSize;
      
      // Create auth window
      const authWindow = new BrowserWindow({
        width: 500,
        height: 600,
        x: Math.round((width - 500) / 2),
        y: Math.round((height - 600) / 2),
        parent: mainWindow || undefined,
        modal: true,
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          partition: 'persist:google-auth',
        },
        title: 'Sign in with Google',
        autoHideMenuBar: true,
        backgroundColor: '#ffffff',
      });

      // Remove menu bar
      authWindow.setMenuBarVisibility(false);

      // Load Google OAuth URL
      const clientId = process.env.VITE_GOOGLE_CLIENT_ID;
      const redirectUri = 'http://localhost/callback'; // Your redirect URI
      const scope = 'openid email profile';
      
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
        `client_id=${clientId}&` +
        `redirect_uri=${encodeURIComponent(redirectUri)}&` +
        `response_type=id_token token&` +
        `scope=${encodeURIComponent(scope)}&` +
        `nonce=${Math.random().toString(36).substring(2)}`;

      authWindow.loadURL(authUrl);

      // Handle navigation events
      authWindow.webContents.on('will-redirect', (event, url) => {
        handleAuthRedirect(url, authWindow, resolve);
      });

      // Also handle navigation
      authWindow.webContents.on('did-navigate', (event, url) => {
        handleAuthRedirect(url, authWindow, resolve);
      });

      // Handle window closed
      authWindow.on('closed', () => {
        resolve(null);
      });

      // Show window when ready
      authWindow.once('ready-to-show', () => {
        authWindow.show();
      });

      // Handle new window requests (popups)
      authWindow.webContents.setWindowOpenHandler(({ url }) => {
        // Allow only Google domains
        if (url.startsWith('https://accounts.google.com') || 
            url.startsWith('https://myaccount.google.com') ||
            url.startsWith('https://accounts.youtube.com')) {
          return { action: 'allow' };
        }
        return { action: 'deny' };
      });
    });
  });
}

function handleAuthRedirect(
  url: string, 
  authWindow: BrowserWindow, 
  resolve: (result: GoogleAuthResult | null) => void
) {
  // Check if this is the redirect URL
  if (url.startsWith('http://localhost/callback') || url.includes('id_token=')) {
    try {
      // Extract id_token from URL fragment
      const urlObj = new URL(url);
      const hash = urlObj.hash || '';
      const params = new URLSearchParams(hash.substring(1));
      const idToken = params.get('id_token');

      if (idToken) {
        // Close auth window
        authWindow.close();
        // Resolve with credential
        resolve({ credential: idToken });
      }
    } catch (error) {
      console.error('Error parsing auth redirect:', error);
    }
  }
}

// Alternative: Use Google Identity Services popup approach
export function setupGoogleAuthPopupHandler() {
  ipcMain.handle('startGoogleAuthPopup', async () => {
    return new Promise<GoogleAuthResult | null>((resolve) => {
      const { width, height } = require('electron').screen.getPrimaryDisplay().workAreaSize;
      
      const authWindow = new BrowserWindow({
        width: 480,
        height: 600,
        x: Math.round((width - 480) / 2),
        y: Math.round((height - 600) / 2),
        parent: mainWindow || undefined,
        modal: true,
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          preload: require('path').join(__dirname, 'preload.js'),
        },
        title: 'Google Sign In',
        autoHideMenuBar: true,
      });

      // Load a local HTML file that uses Google Identity Services
      authWindow.loadFile(require('path').join(__dirname, 'google-auth.html'));

      authWindow.once('ready-to-show', () => {
        authWindow.show();
      });

      // Handle credential from renderer
      ipcMain.once('google-auth-credential', (event, credential: string) => {
        authWindow.close();
        resolve({ credential });
      });

      // Handle cancellation
      authWindow.on('closed', () => {
        resolve(null);
      });
    });
  });
}

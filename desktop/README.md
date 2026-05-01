# CareVance Tracker Desktop

The desktop app is an Electron shell around the CareVance web frontend. It provides production tracking capabilities that the browser cannot provide on its own:

- screenshot capture through Electron
- system idle detection
- active window and foreground app context
- a localhost bridge for the Chromium browser extension
- desktop update checks and release notes

The tracker must always point at the real CareVance web frontend and API. Do not replace the capture, activity, or upload paths with mock tracking in production.

## Local Run

Start the backend API and frontend app first, then run:

```powershell
cd desktop
npm install
npm start
```

By default, the desktop shell opens:

```text
http://localhost:5173
```

## App URL

`main.cjs` resolves the frontend URL from:

1. the `APP_URL` environment variable
2. `app-config.json`
3. fallback `http://localhost:5173`

Allowed values are intentionally restricted:

- `https://...` for deployed environments
- `http://localhost...` for local development
- `http://127.0.0.1...` for local development

Example:

```powershell
$env:APP_URL="https://app.yourdomain.com"
npm start
```

Set `APP_URL` before packaging so the installed desktop app opens the deployed frontend:

```powershell
$env:APP_URL="https://app.yourdomain.com"
npm run dist:win
```

## Screenshot Capture

Optional capture tuning:

```powershell
$env:DESKTOP_SCREENSHOT_MAX_WIDTH="1920"
$env:DESKTOP_SCREENSHOT_MAX_HEIGHT="1080"
$env:DESKTOP_SCREENSHOT_JPEG_QUALITY="82"
```

Defaults:

- max width: `1920`
- max height: `1080`
- JPEG quality: `82`

## Browser Tracking

The browser tracking flow uses the desktop app and Chromium extension together:

- the desktop app exposes a localhost bridge
- the browser extension pairs to that bridge with a short-lived pairing code
- paired tokens are scoped to the browser profile and extension origin
- trusted extension origins should be allowlisted in production config

Production rules:

- do not use wildcard extension origins
- keep desktop and extension versions aligned
- configure Chrome and Edge extension origins explicitly after publishing
- keep the loopback bridge bound to localhost only

## Updates

Build-time update feed variables:

```powershell
$env:DESKTOP_UPDATE_PROVIDER="github"
$env:DESKTOP_UPDATE_OWNER="YOUR_GITHUB_OWNER"
$env:DESKTOP_UPDATE_REPO="YOUR_GITHUB_REPO"
```

Generic feed alternative:

```powershell
$env:DESKTOP_UPDATE_PROVIDER="generic"
$env:DESKTOP_UPDATE_URL="https://downloads.yourdomain.com/desktop-updates"
```

## Build

Directory package:

```powershell
npm run pack
```

Windows installer:

```powershell
npm run dist:win
```

Portable build:

```powershell
npm run dist:portable
```

## Packaging Troubleshooting

If `electron-builder` cannot spawn `app-builder.exe`, refresh local dependencies and unblock downloaded binaries:

```powershell
Remove-Item -Recurse -Force node_modules
npm install
Get-ChildItem node_modules\app-builder-bin\win\x64\app-builder.exe | Unblock-File
npm run pack
```

If it still fails, clear Electron Builder cache:

```powershell
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\electron-builder\Cache"
npm run pack
```

If `winCodeSign` extraction fails with `A required privilege is not held by the client`, enable Windows Developer Mode or run the packaging terminal as Administrator. Electron Builder extracts symlinks from its signing helper archive even for local directory packages.

Also check Windows Defender or antivirus quarantine history for `app-builder.exe`.

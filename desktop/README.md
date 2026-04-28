# CareVance Tracker Desktop

The desktop app is an Electron 33 shell around the web frontend. It exposes desktop-only APIs for:

- screenshot capture
- system idle time
- active window context
- in-app desktop update checks with patch notes

## Run

1. Start the backend API.
2. Start the frontend app.
3. Start the desktop shell:

```powershell
cd desktop
npm install
npm start
```

## URL Selection

`desktop/main.cjs` reads the frontend URL from:

1. the `APP_URL` process environment variable
2. `desktop/app-config.json`
3. fallback `http://localhost:5173`

Default:

```text
http://localhost:5173
```

Override for another local or deployed frontend:

```powershell
$env:APP_URL="https://your-frontend-domain.com"
npm start
```

## Screenshot Capture Notes

The desktop app captures the active display and now auto-falls back when the first screen source is empty (which can happen on some Windows maximize/fullscreen states).

Optional capture tuning environment variables:

```powershell
$env:DESKTOP_SCREENSHOT_MAX_WIDTH="1920"
$env:DESKTOP_SCREENSHOT_MAX_HEIGHT="1080"
$env:DESKTOP_SCREENSHOT_JPEG_QUALITY="82"
```

If unset, these defaults are used:

- max width: `1920`
- max height: `1080`
- JPEG quality: `82`

When building the installer, set `APP_URL` before the build command so the packaged app opens your deployed frontend by default:

```powershell
$env:APP_URL="https://your-frontend-domain.com"
npm run dist:win
```

## Desktop Update Feed

The packaged desktop app can show an update panel, check for new releases, download them, and restart to install.

Build-time environment variables:

```powershell
$env:DESKTOP_UPDATE_PROVIDER="github"
$env:DESKTOP_UPDATE_OWNER="YOUR_GITHUB_OWNER"
$env:DESKTOP_UPDATE_REPO="YOUR_GITHUB_REPO"
```

Or for a generic feed:

```powershell
$env:DESKTOP_UPDATE_PROVIDER="generic"
$env:DESKTOP_UPDATE_URL="https://downloads.yourdomain.com/desktop-updates"
```

Notes:

- GitHub-based auto-update works best with public GitHub Releases.
- Release notes shown in the desktop app come from the release notes/body of the published release.
- Existing users need one new desktop installer that includes this updater. After that, future releases can update inside the app.

## Build Windows Artifacts

```powershell
cd desktop
npm install
$env:DESKTOP_UPDATE_PROVIDER="github"
$env:DESKTOP_UPDATE_OWNER="YOUR_GITHUB_OWNER"
$env:DESKTOP_UPDATE_REPO="YOUR_GITHUB_REPO"
npm run dist:win
npm run dist:portable
```

Outputs are written to `desktop/release-v<version>/`.

Typical files:

- `CareVance-Tracker-<version>-x64.exe`
- `latest.yml`

## Download Link Flow

- Upload the installer to a public URL such as GitHub Releases.
- Put that URL in backend `DESKTOP_WINDOWS_DOWNLOAD_URL`.
- The frontend can then use the backend endpoint `/api/downloads/desktop/windows`.
- Publish release notes in the GitHub Release body so the in-app update panel can show patch notes.

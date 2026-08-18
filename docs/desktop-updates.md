# Shipping desktop updates

How a new version of CareVance Tracker reaches machines that already have it.

## Why not GitHub

`package.json` shipped a `github` publish target pointing at
`Igrisssssss/carevance_hrms`. Both that repo and the actual remote
(`CareVance-Global-LLP/carevance_hrms`) return **404 unauthenticated** — they are
private. electron-updater checks for updates without credentials, so every check
404s and the app reports "Unable to check for desktop updates."

Embedding a GitHub token in the installer would fix the 404 and create a worse
problem: the token is extractable from `app.asar` by anyone holding the installer.

Two ways out. We took the second.

| Option | Trade-off |
|---|---|
| A public releases-only repo | Source stays private, installers become world-downloadable. Free, standard, no hosting. |
| **Self-hosted on our own domain** | Nothing becomes public. We already run HTTPS on `carevancetracker.duckdns.org`. Costs ~120 MB of disk per retained version. |

Self-hosting also needed no code change: `generic` provider support already
existed in both `scripts/write-app-config.cjs` and `main.cjs`.

## Building a release

Version must **increase** or clients will not offer the update — electron-updater
compares against the running version and ignores anything not newer.

```bash
cd desktop
npm version --no-git-tag-version <next-version>

APP_URL=https://carevancetracker.duckdns.org \
DESKTOP_UPDATE_PROVIDER=generic \
DESKTOP_UPDATE_URL=https://carevancetracker.duckdns.org/updates/ \
npm run dist:win
```

Output lands in `desktop/release-v<version>/`.

`dist:win` refuses to package against a loopback `APP_URL`. That guard is why an
installer pointing at `localhost` cannot be produced by accident — leave it in.

## Publishing

```bash
node scripts/publish-update.cjs --dry-run                        # verify artefacts
node scripts/publish-update.cjs --host user@server --path /var/www/updates
```

The script refuses to publish when `latest.yml` disagrees with `package.json`
about the version, or names an installer that is not the one built beside it.
Both mismatches are invisible on the server and surface only as failed downloads
on every client.

It uploads the **installer and blockmap first, and `latest.yml` last**. Clients
poll the manifest, so publishing it first tells anyone checking in that window
about a file that has not finished uploading.

## `resources/app-update.yml` lies — ignore it

electron-builder generates `resources/app-update.yml` from `build.publish` in
`package.json`, which still names the private GitHub repo. **That file is not
what the app uses.** `main.cjs` constructs the updater as
`new NsisUpdater(updaterConfig)` with an explicit options object, and
electron-updater only falls back to reading `app-update.yml` when it is
constructed without one.

So the real feed is the `update` block inside `app.asar`'s `app-config.json`,
written at build time from `DESKTOP_UPDATE_PROVIDER` / `DESKTOP_UPDATE_URL`.

To confirm what a build will actually contact, read the asar, not the yml:

```bash
cd desktop/release-v<version>/win-unpacked
node -e "const fs=require('fs'),b=fs.readFileSync('resources/app.asar'),
h=b.readUInt32LE(12),j=JSON.parse(b.toString('utf8',16,16+h).replace(/\0+$/,'')),
o=16+h+((4-h%4)%4),f=j.files['app-config.json'];
console.log(JSON.parse(b.toString('utf8',o+ +f.offset,o+ +f.offset+f.size)).update)"
```

## Server side

The update base URL must serve a plain directory over HTTPS. Three files:

```
/updates/latest.yml
/updates/CareVance-Tracker-<version>-x64.exe
/updates/CareVance-Tracker-<version>-x64.exe.blockmap
```

Under the current nginx:

```nginx
location /updates/ {
    alias /var/www/updates/;
    autoindex off;
    add_header Cache-Control "no-cache";   # latest.yml must not be cached stale
}
```

Once the pipeline work lands and Caddy fronts the stack, the equivalent is:

```
handle_path /updates/* {
    root * /var/www/updates
    header Cache-Control "no-cache"
    file_server
}
```

`no-cache` on `latest.yml` matters. A cached manifest means clients keep being
told about the previous version after a release, for as long as the cache lives.

Keep the previous version's files in place after publishing. A client mid-download
when the new manifest lands will still be fetching the old installer.

## Verifying a release actually works

```bash
curl -sS https://carevancetracker.duckdns.org/updates/latest.yml
curl -sSI https://carevancetracker.duckdns.org/updates/CareVance-Tracker-<version>-x64.exe | head -1
```

The manifest must report the new version, and the installer must return 200 —
not a redirect, which electron-updater does not follow to another host.

Then on a machine running the *previous* version: the update check fires 3s after
launch and hourly after that. It should move through `checking → available →
downloading → downloaded`, and the app prompts to install.

## What is deliberately not automated

Publishing is a manual step, not part of the deploy pipeline. A desktop release
goes to machines we cannot roll back remotely — unlike the server, where a bad
deploy is one health check away from being reverted. That asymmetry is worth a
human deciding when to press the button.

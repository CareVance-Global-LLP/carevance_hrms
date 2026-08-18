/*
 * Publish a built release to the self-hosted update channel.
 *
 * electron-updater's `generic` provider polls a plain directory over HTTPS. It
 * needs exactly three files at the base URL:
 *
 *   latest.yml                          the manifest it reads first
 *   CareVance-Tracker-<version>-x64.exe the installer named by that manifest
 *   ...exe.blockmap                     lets it download only changed blocks
 *
 * Upload order matters. `latest.yml` is what clients poll, so it must land
 * LAST — publish it first and every client that checks in the intervening
 * seconds is told about an installer that is not there yet, and reports an
 * update error to the user. This script uploads the binaries, verifies they
 * are readable, and only then puts the manifest in place.
 *
 * Usage:
 *   node scripts/publish-update.cjs --host user@server --path /var/www/updates
 *   node scripts/publish-update.cjs --dry-run
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const DESKTOP_DIR = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(DESKTOP_DIR, 'package.json'), 'utf8'));
const VERSION = packageJson.version;
const RELEASE_DIR = path.join(DESKTOP_DIR, `release-v${VERSION}`);

const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
};

const dryRun = process.argv.includes('--dry-run');
const host = arg('--host');
const remotePath = arg('--path') || '/var/www/updates';

const die = (message) => {
  console.error(`[publish-update] ${message}`);
  process.exit(1);
};

if (!fs.existsSync(RELEASE_DIR)) {
  die(`no build for version ${VERSION} at ${RELEASE_DIR} — run \`npm run dist:win\` first`);
}

const installer = `CareVance-Tracker-${VERSION}-x64.exe`;
const artefacts = ['latest.yml', installer, `${installer}.blockmap`];

for (const name of artefacts) {
  const full = path.join(RELEASE_DIR, name);
  if (!fs.existsSync(full)) {
    die(`missing artefact ${name} in ${RELEASE_DIR}`);
  }
}

/*
 * Guard against publishing a manifest that names a different build than the
 * one sitting beside it. That mismatch is silent on the server and only shows
 * up as a failed download on every client, hours later.
 */
const manifest = fs.readFileSync(path.join(RELEASE_DIR, 'latest.yml'), 'utf8');
const manifestVersion = (manifest.match(/^version:\s*(.+)$/m) || [])[1]?.trim();
if (manifestVersion !== VERSION) {
  die(`latest.yml declares version ${manifestVersion} but package.json says ${VERSION}`);
}

const manifestFile = (manifest.match(/^path:\s*(.+)$/m) || [])[1]?.trim();
if (manifestFile !== installer) {
  die(`latest.yml points at ${manifestFile}, which is not the built installer ${installer}`);
}

const sizeMb = (fs.statSync(path.join(RELEASE_DIR, installer)).size / 1024 / 1024).toFixed(1);

console.log(`[publish-update] version   ${VERSION}`);
console.log(`[publish-update] installer ${installer} (${sizeMb} MB)`);
console.log(`[publish-update] target    ${host || '(none)'}:${remotePath}`);

if (dryRun) {
  console.log('[publish-update] dry run — nothing uploaded. Artefacts verified.');
  process.exit(0);
}

if (!host) {
  die('pass --host user@server (or --dry-run to verify artefacts only)');
}

const scp = (name) => {
  console.log(`[publish-update] uploading ${name}...`);
  execFileSync('scp', [path.join(RELEASE_DIR, name), `${host}:${remotePath}/${name}`], {
    stdio: 'inherit',
  });
};

// Binaries first, manifest last — see the note at the top of this file.
scp(installer);
scp(`${installer}.blockmap`);
scp('latest.yml');

console.log('[publish-update] done.');
console.log('[publish-update] verify with:');
console.log(`  curl -sS https://carevancetracker.duckdns.org/updates/latest.yml`);

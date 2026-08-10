const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

/*
 * Build the web UI and copy it into desktop/renderer.
 *
 * This bundle is what the shell serves when the deployed app is unreachable,
 * so a machine that boots before the network is up still gets the real app
 * instead of a static notice. It is a build artefact, not source: gitignored,
 * regenerated on every package.
 */

const DESKTOP_DIR = path.resolve(__dirname, '..');
const FRONTEND_DIR = path.resolve(DESKTOP_DIR, '..', 'frontend');
const SOURCE_DIR = path.join(FRONTEND_DIR, 'dist');
const TARGET_DIR = path.join(DESKTOP_DIR, 'renderer');

const isOptional = process.argv.includes('--optional');
const skipBuild = process.argv.includes('--skip-build');

const fail = (message) => {
  if (isOptional) {
    console.warn(`[prepare-renderer] ${message}`);
    console.warn('[prepare-renderer] continuing without a bundled offline UI');
    process.exit(0);
  }
  console.error(`[prepare-renderer] ${message}`);
  process.exit(1);
};

if (!fs.existsSync(FRONTEND_DIR)) {
  fail(`frontend directory not found at ${FRONTEND_DIR}`);
}

if (!skipBuild) {
  console.log('[prepare-renderer] building the web UI...');
  try {
    // npm is a .cmd shim on Windows, and since Node 18.20 spawning one without
    // a shell fails with EINVAL. The arguments here are fixed literals, so
    // shell: true introduces nothing to inject into.
    const isWindows = process.platform === 'win32';
    execFileSync(isWindows ? 'npm.cmd' : 'npm', ['run', 'build'], {
      cwd: FRONTEND_DIR,
      stdio: 'inherit',
      env: process.env,
      shell: isWindows,
    });
  } catch (err) {
    fail(`web UI build failed: ${err.message}`);
  }
}

if (!fs.existsSync(path.join(SOURCE_DIR, 'index.html'))) {
  fail(`no built UI at ${SOURCE_DIR} (expected index.html)`);
}

fs.rmSync(TARGET_DIR, { recursive: true, force: true });
fs.mkdirSync(TARGET_DIR, { recursive: true });
fs.cpSync(SOURCE_DIR, TARGET_DIR, { recursive: true });

const fileCount = (function count(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).reduce((total, entry) => (
    entry.isDirectory() ? total + count(path.join(dir, entry.name)) : total + 1
  ), 0);
}(TARGET_DIR));

console.log(`[prepare-renderer] bundled offline UI ready: ${fileCount} file(s) in ${TARGET_DIR}`);

const fs = require('node:fs');
const path = require('node:path');

const sourceDir = path.resolve(__dirname, '..', '..', 'browser-extension', 'chromium');
const destinationDir = path.resolve(__dirname, '..', 'assets', 'browser-extension', 'chromium');

if (!fs.existsSync(sourceDir)) {
  throw new Error(`Browser extension source directory not found: ${sourceDir}`);
}

fs.rmSync(destinationDir, { recursive: true, force: true });
fs.mkdirSync(path.dirname(destinationDir), { recursive: true });
fs.cpSync(sourceDir, destinationDir, { recursive: true });

process.stdout.write(`Synced browser extension assets to ${destinationDir}\n`);

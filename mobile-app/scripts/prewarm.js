// Pre-warms the iOS bundle in Metro's cache so the iPhone loads instantly.
// Polls Metro until ready, then fetches the bundle once to compile + cache it.

const http = require('http');

const HOST = '127.0.0.1';
const PORT = 8081;
const BUNDLE_URL = `http://${HOST}:${PORT}/node_modules/expo-router/entry.bundle?platform=ios&dev=true&minify=false`;

function fetch(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', reject);
  });
}

async function waitForMetro(attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`http://${HOST}:${PORT}/status`);
      if (res.status === 200 && res.body.includes('packager-status:running')) {
        return true;
      }
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function prewarm() {
  process.stdout.write('Waiting for Metro on port 8081... ');
  const ready = await waitForMetro();
  if (!ready) {
    console.log('TIMEOUT');
    console.error('Metro did not start within 60s. Run `npm start` in another terminal first.');
    process.exit(1);
  }
  console.log('READY');

  process.stdout.write('Pre-warming iOS bundle... ');
  const start = Date.now();
  try {
    const res = await fetch(BUNDLE_URL);
    const ms = Date.now() - start;
    const sizeKB = Math.round(res.body.length / 1024);
    if (res.status === 200) {
      console.log(`OK (${ms}ms, ${sizeKB}KB)`);
      console.log('\nBundle is cached. Scan the QR code now — should load in 3-5s.');
    } else {
      console.log(`FAILED (HTTP ${res.status})`);
      process.exit(1);
    }
  } catch (e) {
    console.log('FAILED');
    console.error(e.message);
    process.exit(1);
  }
}

prewarm();

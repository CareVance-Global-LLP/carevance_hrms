'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const { normalizeCapturedUrl } = require('./normalize-captured-url.cjs');

/**
 * Owns the long-lived PowerShell helper that reads the foreground browser's URL.
 *
 * Long-lived on purpose. Loading the UI Automation assemblies costs ~150-200ms
 * while a read costs ~7-12ms once they are up, so a per-poll `execSync` would
 * be both slow and — as the existing process-description lookups in main.cjs
 * already demonstrate — a way to block the Electron main process and delay
 * foreground detection outright.
 *
 * Windows only. On any other platform this is inert and `read()` resolves to
 * null, which is the same answer the tracker has always had there.
 */

/*
 * Resolved to the UNPACKED copy, because powershell.exe is a separate process.
 *
 * In a packaged build __dirname points inside app.asar, which is one archive
 * file. Node's patched fs can read a virtual path inside it; PowerShell cannot
 * — it is handed a path that does not exist on disk, the helper never starts,
 * and read() returns null forever.
 *
 * Nothing surfaced that. `read()` resolving null is indistinguishable from "not
 * on a browser", so every packaged install silently had NO url for any tab: the
 * tracker fell back to keying sessions on the window title, which churns, so a
 * single visit was stored as a row per title flicker and each row was named
 * after the browser instead of the site. Both of those were reported as bugs in
 * their own right; this was underneath them. It reproduced on every installed
 * build and on no development machine, because `npm start` runs unpacked.
 *
 * Paired with asarUnpack in package.json — the rewrite below only finds a file
 * if the packer was told to leave one there.
 */
const HELPER_SCRIPT = path
  .join(__dirname, 'read-foreground-url.ps1')
  .replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

/** A read is abandoned past this; the tracker polls again shortly anyway. */
const READ_TIMEOUT_MS = 1500;

/** Restart backoff, so a helper that cannot start does not spin. */
const RESTART_DELAY_MS = 30 * 1000;

class BrowserUrlReader {
  constructor({ onError } = {}) {
    this.child = null;
    this.ready = false;
    this.pending = null;
    this.buffer = '';
    this.disposed = false;
    this.restartTimer = null;
    this.onError = typeof onError === 'function' ? onError : () => {};
  }

  get supported() {
    return process.platform === 'win32';
  }

  start() {
    if (!this.supported || this.disposed || this.child) return;

    try {
      this.child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', HELPER_SCRIPT],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
      );
    } catch (error) {
      this.onError(error);
      this.scheduleRestart();
      return;
    }

    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => this.consume(chunk));

    // Drained so a helper writing to stderr cannot fill its pipe and wedge.
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', () => {});

    this.child.on('error', (error) => {
      this.onError(error);
      this.teardown();
      this.scheduleRestart();
    });

    this.child.on('exit', () => {
      this.teardown();
      this.scheduleRestart();
    });
  }

  consume(chunk) {
    this.buffer += chunk;

    let newline = this.buffer.indexOf('\n');
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) this.handleLine(line);
      newline = this.buffer.indexOf('\n');
    }
  }

  handleLine(line) {
    let payload;
    try {
      payload = JSON.parse(line);
    } catch {
      // A stray line is not worth failing a read over; the helper only ever
      // emits JSON, so this means something else wrote to stdout.
      return;
    }

    if (payload && payload.ready) {
      this.ready = true;
      return;
    }

    this.settle(payload);
  }

  settle(payload) {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    clearTimeout(pending.timer);
    pending.resolve(payload ?? null);
  }

  teardown() {
    if (this.child) {
      this.child.removeAllListeners();
      try { this.child.kill(); } catch { /* already gone */ }
    }
    this.child = null;
    this.ready = false;
    this.buffer = '';
    // A read waiting on a helper that just died resolves null rather than
    // hanging until its own timeout.
    this.settle(null);
  }

  scheduleRestart() {
    if (this.disposed || this.restartTimer) return;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.start();
    }, RESTART_DELAY_MS);
    if (typeof this.restartTimer.unref === 'function') this.restartTimer.unref();
  }

  /**
   * The foreground browser's URL, already graded, or null.
   *
   * Never rejects and never throws: this sits on the tracker's hot path, and a
   * missing URL is a normal answer — the foreground window is usually not a
   * browser at all.
   *
   * @returns {Promise<{url: string, confidence: number, source: string}|null>}
   */
  async read() {
    if (!this.supported || this.disposed) return null;
    if (!this.child) {
      this.start();
      return null;                 // first call only primes the helper
    }
    if (!this.ready) return null;

    /*
     * Join a read already in flight rather than giving up on it.
     *
     * main.cjs reads from two places on the same one-second cadence — the
     * foreground watcher, and the get-active-window-context IPC that the
     * renderer's tick calls — so their reads overlap constantly. Returning
     * null to whichever arrived second wrote a URL-less row for a page whose
     * URL had just been read successfully, which appeared in the timeline as
     * alternating url/NULL rows for one page. Both callers want the same
     * thing: what is in front right now.
     */
    const raw = this.pending ? await this.pending.promise : await this.requestRead();

    if (!raw || raw.ok === false || !raw.source) return null;

    const normalized = normalizeCapturedUrl({ source: raw.source, value: raw.value });
    if (!normalized.url) return null;

    return { url: normalized.url, confidence: normalized.confidence, source: raw.source };
  }

  /** Ask the helper once, exposing the in-flight promise for others to join. */
  requestRead() {
    const promise = new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending && this.pending.timer === timer) {
          this.pending = null;
          resolve(null);
        }
      }, READ_TIMEOUT_MS);
      if (typeof timer.unref === 'function') timer.unref();

      this.pending = { resolve, timer, promise: null };

      try {
        this.child.stdin.write('read\n');
      } catch (error) {
        this.pending = null;
        clearTimeout(timer);
        this.onError(error);
        resolve(null);
      }
    });

    // Assigned after construction, so a synchronous write failure above — which
    // clears `pending` — cannot leave a stale promise for a later caller to
    // join.
    if (this.pending) this.pending.promise = promise;

    return promise;
  }

  dispose() {
    this.disposed = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.child) {
      try { this.child.stdin.write('quit\n'); } catch { /* already gone */ }
    }
    this.teardown();
  }
}

module.exports = { BrowserUrlReader, READ_TIMEOUT_MS, RESTART_DELAY_MS };

const fs = require('node:fs');
const path = require('node:path');

/**
 * A small, dependency-free log file for the packaged app.
 *
 * The shell previously had no diagnostics that outlived the process: every
 * `console` call went to a console that is not attached in a packaged build.
 * When the shift countdown misbehaved on 19 Aug 2026, the only evidence
 * available was a photograph of the screen.
 *
 * Written here rather than pulled from npm for one reason: the scrubbing is the
 * security-critical half, and it needs to be ours. This is a file we will ask
 * people to send us, and the process writing it is holding a live API token.
 * A general-purpose logger would have to be wrapped for that anyway.
 *
 * Two rules, both asserted in tests/diagnosticsLog.test.cjs:
 *
 *   1. No credential reaches the file.
 *   2. Nothing here can throw into a caller. A tracker that dies because it
 *      could not write a log line is worse than one that logs nothing at all.
 */

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_FILES = 3;
const BASENAME = 'tracker';

/** Field names whose VALUE is a secret, whatever it looks like. */
const SECRET_KEY = /^(.*_)?(token|password|secret|api[_-]?key|authorization|auth|credential|cookie|session)s?$/i;

/**
 * Secret shapes in free text, for the many places a token arrives already
 * baked into a string rather than as a field.
 */
const SECRET_TEXT = [
  /\b(bearer\s+)[A-Za-z0-9._~+/-]{8,}=*/gi,
  /\b(tok|sk|pk|ghp|gho|xox[baprs])[_-][A-Za-z0-9._-]{6,}/gi,
  /("|')?(token|password|secret|api[_-]?key|authorization)("|')?\s*[:=]\s*("|')?[^\s"',}]{6,}/gi,
];

const REDACTED = '[redacted]';

const scrubText = (value) => {
  let out = String(value);
  out = out.replace(SECRET_TEXT[0], (_m, prefix) => `${prefix}${REDACTED}`);
  out = out.replace(SECRET_TEXT[1], REDACTED);
  out = out.replace(SECRET_TEXT[2], (match) => {
    const separator = match.includes(':') ? ':' : '=';
    return `${match.slice(0, match.indexOf(separator) + 1)} ${REDACTED}`;
  });
  return out;
};

/**
 * Deep-copy `value`, replacing anything that looks like a credential.
 *
 * Cycle-safe on purpose: Electron event payloads and Error objects are
 * routinely self-referential, and a logger that throws on one is a logger that
 * cannot be trusted at the moment it is needed.
 */
const scrubSecrets = (value, seen = new WeakSet()) => {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') return scrubText(value);
  if (typeof value !== 'object') return value;

  if (seen.has(value)) return '[circular]';
  seen.add(value);

  if (value instanceof Error) {
    return { name: value.name, message: scrubText(value.message), stack: scrubText(value.stack || '') };
  }

  if (Array.isArray(value)) {
    return value.map((entry) => scrubSecrets(entry, seen));
  }

  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    out[key] = SECRET_KEY.test(key) ? REDACTED : scrubSecrets(entry, seen);
  }
  return out;
};

const formatArg = (arg) => {
  if (typeof arg === 'string') return scrubText(arg);
  if (arg instanceof Error) return `${arg.name}: ${scrubText(arg.message)}\n${scrubText(arg.stack || '')}`;
  try {
    return JSON.stringify(scrubSecrets(arg));
  } catch {
    return '[unserialisable]';
  }
};

const createLogger = ({
  dir,
  maxBytes = DEFAULT_MAX_BYTES,
  maxFiles = DEFAULT_MAX_FILES,
  mirrorToConsole = true,
} = {}) => {
  const filePath = path.join(dir, `${BASENAME}.log`);

  /*
   * Never buffer more than one file's worth. Writes are batched so a chatty
   * second is not a thousand syscalls, but a batch larger than `maxBytes`
   * lands in a single append that the rotation check — which runs BEFORE the
   * append — cannot break up. The file then blows straight past its cap.
   */
  const flushAt = Math.max(1024, Math.min(8 * 1024, maxBytes));

  let buffer = [];
  let bufferedBytes = 0;
  let disabled = false;

  const rotate = () => {
    // Oldest first, so each file shifts up one slot and the last falls off.
    for (let index = maxFiles - 1; index >= 1; index--) {
      const from = index === 1 ? filePath : path.join(dir, `${BASENAME}.${index - 1}.log`);
      const to = path.join(dir, `${BASENAME}.${index}.log`);
      try {
        if (fs.existsSync(from)) fs.renameSync(from, to);
      } catch { /* a locked file just means one lost rotation */ }
    }
  };

  const flush = () => {
    if (disabled || buffer.length === 0) return;

    const payload = buffer.join('');
    buffer = [];
    bufferedBytes = 0;

    try {
      fs.mkdirSync(dir, { recursive: true });

      let size = 0;
      try { size = fs.statSync(filePath).size; } catch { size = 0; }
      if (size + payload.length > maxBytes) rotate();

      fs.appendFileSync(filePath, payload, 'utf8');
    } catch {
      // Read-only profile, full disk, antivirus lock. Stop trying rather than
      // burning a syscall on every future line — and never surface it.
      disabled = true;
    }
  };

  const write = (level, args) => {
    try {
      const line = `${new Date().toISOString()} ${level.padEnd(5)} ${args.map(formatArg).join(' ')}\n`;
      buffer.push(line);
      bufferedBytes += line.length;
      if (bufferedBytes >= flushAt) flush();
    } catch { /* logging must never throw into a caller */ }
  };

  const logger = {
    filePath,
    dir,
    info: (...args) => write('INFO', args),
    warn: (...args) => write('WARN', args),
    error: (...args) => write('ERROR', args),
    debug: (...args) => write('DEBUG', args),
    flush,

    /**
     * Tee an existing console into the log. Additive — the original methods
     * still run, so nothing that works today stops working, and the 34 existing
     * `console` calls in main.cjs become a file without being rewritten.
     *
     * @returns {() => void} restores the console.
     */
    captureConsole: (target = console) => {
      const original = { log: target.log, warn: target.warn, error: target.error };
      const levels = { log: 'INFO', warn: 'WARN', error: 'ERROR' };

      for (const method of Object.keys(levels)) {
        target[method] = (...args) => {
          write(levels[method], args);
          try { original[method].apply(target, args); } catch { /* detached stdio */ }
        };
      }

      return () => {
        for (const method of Object.keys(levels)) target[method] = original[method];
      };
    },
  };

  if (mirrorToConsole) {
    logger.captureConsole(console);
  }

  return logger;
};

module.exports = { createLogger, scrubSecrets, scrubText };

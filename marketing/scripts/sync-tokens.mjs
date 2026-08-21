/**
 * Regenerates app/tokens.css from the product's theme.css.
 *
 * The brand lives in ONE place: frontend/src/styles/theme.css. This script
 * lifts the custom-property declarations out of it so the marketing site can
 * never drift from the app it is selling. Run it, commit the output.
 *
 *   node scripts/sync-tokens.mjs          # write
 *   node scripts/sync-tokens.mjs --check  # fail if stale (CI)
 *
 * Two deliberate transforms happen on the way through:
 *
 * 1. Only variables declared in the light `:root` block survive. theme.css's
 *    dark block also carries pre-token legacy hexes (--sidebar-*, --contrast-*)
 *    that exist nowhere in light; emitting a variable in one theme and not the
 *    other is how a site ends up white-on-white in exactly one mode.
 *
 * 2. The product resolves theme from a `data-theme` attribute alone, because it
 *    ships an in-app toggle over an authenticated session. A public page also
 *    has to answer to `prefers-color-scheme` for the visitor who never clicks
 *    anything, so the dark values are emitted TWICE — once behind the media
 *    query (guarded so an explicit light choice still wins) and once behind the
 *    attribute (so the toggle wins in both directions).
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(here, '../../frontend/src/styles/theme.css');
const TARGET = resolve(here, '../app/tokens.css');

if (!existsSync(SOURCE)) {
  console.error(`sync-tokens: cannot find the product theme at ${SOURCE}`);
  console.error('If the marketing site has been split into its own repo, vendor');
  console.error('tokens.css by hand and delete this script — but say so in a header.');
  process.exit(1);
}

const css = readFileSync(SOURCE, 'utf8');

/** Body of every rule whose selector matches, in source order. */
function blocks(selector) {
  const out = [];
  let cursor = 0;

  for (;;) {
    const start = css.indexOf(selector, cursor);
    if (start === -1) break;

    // Guard against `:root` matching inside `:root[data-theme="dark"]`, and
    // against either matching inside a descendant selector like
    // `:root[data-theme="dark"] .bg-white`.
    const brace = css.indexOf('{', start);
    if (brace === -1) break;
    const between = css.slice(start + selector.length, brace).trim();
    if (between !== '') {
      cursor = start + selector.length;
      continue;
    }

    let depth = 0;
    let i = brace;
    for (; i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') {
        depth--;
        if (depth === 0) break;
      }
    }

    out.push(css.slice(brace + 1, i));
    cursor = i;
  }

  return out;
}

/** `--name: value;` pairs, later declarations winning. */
function declarations(body) {
  const found = new Map();
  const re = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi;
  let m;
  while ((m = re.exec(body)) !== null) {
    found.set(m[1], m[2].trim());
  }
  return found;
}

const lightBody = blocks(':root')[0];
if (!lightBody) {
  console.error('sync-tokens: no `:root { … }` block found in theme.css');
  process.exit(1);
}

const light = declarations(lightBody);

const dark = new Map();
for (const body of blocks(':root[data-theme="dark"]')) {
  for (const [name, value] of declarations(body)) dark.set(name, value);
}

if (light.size === 0 || dark.size === 0) {
  console.error('sync-tokens: parsed 0 declarations — theme.css shape changed?');
  process.exit(1);
}

// Symmetry: a token the marketing site can use is one that has BOTH values.
const names = [...light.keys()].filter((n) => dark.has(n));
const lightOnly = [...light.keys()].filter((n) => !dark.has(n));

const render = (indent, pick) =>
  names.map((n) => `${indent}${n}: ${pick(n)};`).join('\n');

const out = `/*
 * GENERATED FILE — DO NOT EDIT.
 *
 * Source of truth: frontend/src/styles/theme.css (the CareVance product).
 * Regenerate with:  node scripts/sync-tokens.mjs
 *
 * ${names.length} tokens, each with a light and a dark value.
 * ${lightOnly.length} light-only token(s) were dropped for having no dark counterpart${
   lightOnly.length ? `: ${lightOnly.join(', ')}` : ''
 }.
 *
 * Channels are space-separated RGB, not hex, so Tailwind's alpha modifiers can
 * compose with them — see app/globals.css where they become @theme colours.
 */

:root {
  color-scheme: light;
${render('  ', (n) => light.get(n))}
}

/*
 * The visitor who never touches the toggle. Guarded on :not([data-theme="light"])
 * so an explicit light choice is not overridden by a dark OS preference.
 */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
${render('    ', (n) => dark.get(n))}
  }
}

/* The visitor who did touch the toggle. Wins in both directions. */
:root[data-theme="dark"] {
  color-scheme: dark;
${render('  ', (n) => dark.get(n))}
}

:root[data-theme="light"] {
  color-scheme: light;
${render('  ', (n) => light.get(n))}
}
`;

const check = process.argv.includes('--check');
const current = existsSync(TARGET) ? readFileSync(TARGET, 'utf8') : null;

if (check) {
  if (current !== out) {
    console.error('sync-tokens: app/tokens.css is stale. Run `npm run sync:tokens`.');
    process.exit(1);
  }
  console.log(`sync-tokens: up to date (${names.length} tokens).`);
} else {
  writeFileSync(TARGET, out, 'utf8');
  console.log(
    `sync-tokens: wrote app/tokens.css — ${names.length} tokens` +
      (lightOnly.length ? `, dropped ${lightOnly.length} light-only` : '')
  );
}

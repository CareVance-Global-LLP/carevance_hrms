/**
 * Render the product brochure to a print-ready PDF.
 *
 *   node docs/brochure/build.mjs
 *
 * Uses the Playwright already installed for the frontend's tests, so this adds
 * no dependency. Chromium's print pipeline is what produces the PDF, which is
 * why the source is HTML with a print stylesheet rather than a page-layout
 * format — the brochure can be reviewed in a browser before it is rendered.
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(here, 'brochure.html');
const OUTPUT = join(here, 'CareVance-Product-Guide.pdf');

if (!existsSync(SOURCE)) {
  console.error(`Source not found: ${SOURCE}`);
  process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage();

// `file://` rather than a server: the document is deliberately self-contained
// (the logo is inline SVG, the styles are in the <head>), so there is nothing
// to serve and nothing that can fail to load at render time.
await page.goto('file:///' + SOURCE.replace(/\\/g, '/'), { waitUntil: 'load' });

// `screen` would apply the on-screen styles; the whole layout lives in the
// print stylesheet, so the media type has to be emulated explicitly.
await page.emulateMedia({ media: 'print' });

/*
 * The page number comes from the printer, not from the markup.
 *
 * Every page originally carried a hand-written "page 14" in a footer div. The
 * moment two sections were merged, all nineteen of them were wrong — and a
 * document that misnumbers its own pages undermines the care claimed by
 * everything on them. Chromium fills `pageNumber` and `totalPages` itself, so
 * the count cannot drift from reality again.
 *
 * The template renders at browser default (16px) regardless of the page's own
 * styles, hence the explicit small font size, and it is clipped unless the
 * bottom @page margin leaves room for it.
 */
const footer = `
  <div style="width:100%;font-size:7pt;color:#9AA6AE;padding:0 14mm;
              font-family:'Segoe UI',system-ui,sans-serif;
              display:flex;justify-content:space-between;">
    <span>CareVance · Product guide · August 2026</span>
    <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
  </div>`;

// A cover with a page number on it looks like a draft, so the first sheet is
// suppressed by giving it a header/footer of its own via CSS below.
await page.pdf({
  path: OUTPUT,
  format: 'A4',
  printBackground: true,
  preferCSSPageSize: true,
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate: footer,
});

await browser.close();

console.log(`Written: ${OUTPUT}`);

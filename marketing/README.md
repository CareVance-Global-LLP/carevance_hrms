# CareVance marketing site

The public site. Separate app from the product: different build target, different
deploy cadence, different dependencies. It shares the product's brand tokens and
its payroll arithmetic — by generation, not by copying.

```bash
npm install
npm run dev          # http://localhost:3000
npm run build
npm run verify       # tokens fresh · arithmetic correct · claims traceable
```

---

## The one rule

**Every claim on this site traces to a line in [`../PRODUCT_TRUTH.md`](../PRODUCT_TRUTH.md).**

That file is an audit of the CareVance codebase — what each module actually does,
counted from the source, with a claim ID per fact. Website copy cites those IDs
in the markup as `data-claim="PAY-07"`, which turns "everything is true" from a
promise into a command:

```bash
npm run verify:claims
```

It fails the build if a referenced ID does not exist in `PRODUCT_TRUTH.md`, if a
banned phrase appears (fabricated user counts, uncertified compliance badges,
features the codebase does not implement), or if a hard-coded hex slips in.

`PRODUCT_TRUTH.md` also records what must **not** be claimed. Read `§4 DONT-*`
before writing copy. Four of them exist because the product's own pricing config
sells features that are not built — see `lib/features.ts`.

---

## Generated files — do not edit

Two files are produced from the product and will be overwritten:

| File | Generated from | Command |
|---|---|---|
| `app/tokens.css` | `frontend/src/styles/theme.css` | `npm run sync:tokens` |
| `lib/pt-states.ts` | `backend/app/Services/PTStateService.php` | `npm run sync:pt` |

`npm run sync` runs both. `npm run verify:sync` fails if either is stale, so a
brand change or a professional-tax amendment in the product cannot silently
diverge from the site.

The token sync does two deliberate transforms — dropping tokens that exist in
only one theme, and emitting the dark values twice so both `prefers-color-scheme`
and the explicit toggle work. The header comment in `scripts/sync-tokens.mjs`
explains why.

---

## Layout

```
app/            routes; every page server-rendered
  layout.tsx      theme script (pre-paint), fonts, Organization + SoftwareApplication JSON-LD
  llms.txt/       plain-text brief for language models, generated from lib/
components/
  chrome/         navbar, footer, theme toggle
  home/           the homepage's 13 sections
  motion/         the six motions (see below)
  product/        the product UI, rebuilt as components
  tools/          calculator shells and controls
  ui/primitives   Container, Section, Card, Button, Eyebrow…
lib/
  calc.ts         payroll arithmetic, ported from PayrollCalculatorService
  demo.ts         one employee carried through every screen
  facts.ts        every published number, with its claim ID and provenance
  features.ts     plan comparison matrix (phantom features removed)
  pricing.ts      mirrors the product's constants/pricing.ts
  site.ts         nav, routes, CTAs — sitemap reads this too
scripts/          sync + verification
```

## Product imagery

There are no screenshots. `components/product/` rebuilds the real screens as
components using the product's own tokens and layout rules, which buys three
things a PNG cannot: correct in dark mode with no second asset, sharp at any
density, and the hero chain can animate the actual nodes rather than cross-fading
pictures of them.

All of it is server-rendered, so every figure lands in the HTML a crawler reads.

`lib/demo.ts` holds one employee — Priya Nair, ₹14,40,000 CTC, Mumbai — whose
numbers were derived from the engine's own constants and **balance exactly**:
gross + employer PF + gratuity provision = ₹1,20,000. That continuity is the
pitch: five screenshots argue nothing, five views of one record argue that they
are one system. If you change a figure, re-derive the rest.

## The six motions

Defined once in `lib/motion.ts`. A site with six consistent motions reads as
designed; a site with thirty reads as a demo reel.

1. **Reveal** — opacity + 16px rise, once at 20% intersection, never re-triggered
2. **Stagger** — 60ms between children, capped at 8
3. **Count-up** — real numbers only; the final value is in the SSR HTML and the
   animation mutates it afterwards, so crawlers and screen readers get the number
4. **Chain trace** — the hero's connector, an anime.js timeline (the only library)
5. **Tab swap** — cross-fade + 8px slide, into a height-reserved container
6. **Hover lift** — 2px + shadow. That is the whole hover language.

**`motion` / Framer is not a dependency.** It was, and the homepage measured
236 KB gzipped against a hard 180 KB budget — the navbar lives in the root layout,
so its imports land in every page's initial bundle. The six motions are CSS
transitions, one IntersectionObserver and one rAF lerp instead. Homepage is now
**90 KB**. See the note at the top of `lib/motion.ts`.

Everything is gated on `prefers-reduced-motion`, in JS as well as CSS, so a reader
who asked for no motion has none scheduled rather than running at zero duration.

## The cursor

`components/motion/Cursor.tsx`. Four gates, all required: fine pointer, no
reduced-motion preference, ≥1024px, and not on a conversion or form route. It
never suppresses the native cursor over text inputs — losing the I-beam is what
makes a custom cursor feel broken. The rAF loop stops when the ring catches up.

## Gotchas

- **Do not pass `hidden md:inline-flex` to `<Button>`.** Both are display
  utilities in the same layer and the base `inline-flex` wins regardless of
  attribute order. Wrap it: `<span className="hidden md:flex"><Button/></span>`.
  This shipped once and pushed the navbar 4px past the viewport on every page.
- **`text-n-500` is 4.26:1 on light surfaces** — below AA for small text. Muted
  text is `text-n-600`. Likewise `text-accent-500` (2.50:1) → `text-accent-700`,
  and white on `bg-brand-600` (3.33:1) → `bg-brand-700` (6.33:1).
- **`.band-deep` starts at `--cta-via`, not `--cta-from`.** A gradient is only as
  accessible as its lightest point, and white on `--cta-from` is 3.33:1.
- Two hard-coded hexes exist, both in `app/globals.css` and both documented: a
  surface that must stay dark in *both* themes cannot come from an inverting token.

## Verification

```bash
npm run verify:sync     # tokens.css and pt-states.ts are current
npm run verify:calc     # 28 assertions against the payroll engine's own figures
npm run verify:claims    # claim IDs resolve; no banned phrases; no stray hex
```

`verify:calc` covers the cases most calculators get wrong: the CTC balance, the
PF ceiling, ESI at both sides of the ₹21,000 boundary, the five-year gratuity
floor and the ₹20,00,000 ceiling, the HRA limbs, and §87A marginal relief above
₹12 lakh.

## Before launch

Blocked on answers only the founder has — marked in the source with a visible
`<Pending>` rather than invented:

- Registered entity name, address, grievance officer (`/legal/*`, `/contact`)
- Hosting region and sub-processor names (`/legal/dpa`)
- Support hours; whether any SLA is offered (`/security` currently claims none)
- `NEXT_PUBLIC_SITE_URL` for canonical URLs and the sitemap

P2 pages ship with honest placeholder bodies and are marked in the navigation
with a gold dot. They are real routes with real metadata — they simply say they
are unfinished rather than carrying copy nobody has checked.

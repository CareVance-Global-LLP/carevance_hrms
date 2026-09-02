# Branding: where the product is named, and how to change it

The vendor's name and logo used to be typed into 57 files. They now come from
three config files, so re-branding or un-branding the product is an edit to
those three rather than a hunt through the tree.

This document is the manifest: what moved, what deliberately did not, and how
to put any of it back.

---

## Current state

| App | Brand | Effect |
|---|---|---|
| **Web** | **OFF** | No wordmark, no logo, no "CareVance" text on any page — landing, legal and settings included. Title reads "HR and payroll". |
| Backend | ON | Email and filings still carry the name. |
| Mobile | ON | Login and the notification banner still carry the name. |

Turn the web brand back on with one line: `enabled: true` in
`frontend/src/config/brand.ts`.

## The switch

| App | File | Off switch |
|---|---|---|
| Web | `frontend/src/config/brand.ts` | `enabled: false` |
| Backend (email, filings) | `backend/config/brand.php` | `BRAND_ENABLED=false` in `.env`, or `enabled` in the file |
| Mobile | `mobile-app/src/constants/brand.ts` | `enabled: false` |

They are three files rather than one because the apps share no module graph.
**Change them together** — a half-switched product shows the vendor's name in
email and not in the app, which looks like a bug rather than a decision.

### Un-branding

```
frontend/src/config/brand.ts      enabled: true  ->  false
backend/config/brand.php          BRAND_ENABLED=false
mobile-app/src/constants/brand.ts enabled: true  ->  false
```

Nothing else needs touching. Every label falls back to neutral wording chosen so
the surrounding sentence still parses — "Sign in to CareVance" becomes "Sign in
to this workspace", not "Sign in to ". The logo component renders an empty box
of the same size rather than a broken image, so no layout shifts, and the
document head drops its icon and preview tags entirely rather than pointing them
at an empty string.

### Re-branding

Change `name`, `productName`, `tagline` and the two logo paths in each file, and
drop replacement artwork into `frontend/public/` and `backend/public/`.

### Reverting entirely

The original values are the defaults committed in all three files, so
`git checkout -- frontend/src/config/brand.ts backend/config/brand.php
mobile-app/src/constants/brand.ts` restores them. To undo the whole refactor,
revert the commit — the call sites are mechanical substitutions with no logic
change.

---

## What the labels are

Call sites read a **label**, never the raw value, so the off state stays
grammatical.

| Label | Branded | Un-branded | Used for |
|---|---|---|---|
| `brandLabel` | CareVance | this workspace | Mid-sentence: "the rest of X is unaffected" |
| `productLabel` | CareVance HRMS | HR and payroll | Titles, report headers, mastheads |
| `assistantLabel` | CareVance Assistant | Assistant | The in-app chat assistant |
| `mailSubjectBrand` | `CareVance ` | *(empty)* | `mailto:` subject prefixes |
| `downloadPrefix` | `carevance-` | *(empty)* | Downloaded filenames |
| `brandPrefix` | `CareVance ` | *(empty)* | Before a common noun: "CareVance tracker" → "tracker" |
| `legalLabel` | CareVance | the Service | Terms, Privacy, the DPDP notice |
| `legalProductLabel` | CareVance HRMS | the Service | The same, where the full name was used |
| `siteUrl` | `https://carevance.com` | the serving origin | Landing-page structured data |
| `appDomainPrefix` | `app.carevance.com/` | *(empty)* | Before the workspace slug in Settings |
| `supportEmail` | support@… | `null` | The chat assistant's fallback contact |
| `supportEmailSuffix` | ` at support@…` | *(empty)* | So the sentence closes cleanly with no address |
| `webhookHeaderPrefix` | `X-CareVance-` | `X-Webhook-` | **Display only** — see the warning below |
| `config('brand.label')` | CareVance | this workspace | Blade, mid-sentence |
| `config('brand.product_label')` | CareVance HRMS | HR and payroll | Blade, mastheads and filing footers |

### Two warnings

**`webhookHeaderPrefix` changes only what the integrations screen SHOWS.**
`backend/app/Jobs/DeliverWebhook.php` still sends `X-CareVance-Event`,
`-Delivery`, `-Timestamp` and `-Signature`, because every customer who has built
a receiver verifies against those exact names. With the brand off, that panel
therefore describes headers the server does not send — documentation that is
wrong rather than merely unbranded. Acceptable for a white-label preview;
**not** acceptable on a deployment with live webhook consumers. To make them
agree, change `DeliverWebhook.php` to the same prefix and send both names for a
deprecation window.

**`legalLabel` is a placeholder, not a legal review.** The Terms, the Privacy
Policy and the DPDP notice name a party because a party is who owes the duty.
"the Service" is fine for a demo; before real Terms go live they must name the
actual contracting entity, and that is a lawyer's call.

---

## Where it is used

**57 files changed.** Grouped by what a reader would actually see.

### Web — the document head

`frontend/index.html` is tokenised (`%BRAND_PRODUCT_NAME%`, `%BRAND_FAVICON%`,
`%BRAND_LOGO_MARK%`, `%BRAND_LOGO_FULL%`, `%BRAND_DESCRIPTION%`) and filled at
build time by the `brand:index-html` plugin in `frontend/vite.config.ts`. The
head is the one branded surface a React component cannot reach: the title, the
favicon and the link-preview tags are read before the app boots.

### Web — the logo

`frontend/src/components/branding/BrandLogo.tsx` is the only component that
draws the mark. Six places use it: the sidebar, the app layout, the dashboard
topbar, the auth shell, and the landing navbar and footer.

### Web — every route title

`frontend/src/lib/seo.ts` funnels all nineteen route titles through one
`siteName`, now `productLabel`. Changing the brand renames every browser tab.

### Web — in-app copy

Sign-in, support, contact sales, billing, settings, onboarding, invitations, the
error boundary, the command bar, the chat assistant, API keys, webhooks,
integrations, notifications, two-factor, recovery codes, signed-in devices,
break-glass access, the desktop update panel, the monitoring notice, and the
payroll report headers and footers.

### Web — downloaded files

`carevance-add-user-template.csv`, `carevance-import-issues.csv` and
`carevance-recovery-codes.txt` take `downloadPrefix`, so un-branded they lose the
prefix rather than gaining a stray leading dash.

### Backend — every email

`backend/resources/views/components/mail/layout.blade.php` is the shell all 18
templates inherit: the eyebrow, the footer line, the `<title>` and the logo.
Auth, billing, invitations, welcome, payslip, break-glass, bug reports and the
idle-timer notice each carry their own mentions on top.

### Backend — statutory filings

`filings/_form_foot.blade.php` and `filings/form12ba.blade.php` stamp
*"Generated by …"* on forms filed under the **customer's** PAN and TAN. This is
the one most worth un-branding for a white-label deployment.

### Mobile

`app/login.tsx` and `src/components/NotificationBanner.tsx`.

---

## What was deliberately NOT changed

Each of these matched a search for the vendor's name and each must stay. This is
the more important half of the manifest: a future sweep that "finishes the job"
by changing them will break things.

### Storage keys — renaming these is a data migration, not a rebrand

`carevance.theme`, `carevance:user`, `carevance.rememberedEmail`,
`carevance-add-user-defaults`, `carevance-chat-position`,
`carevance:chunk-reload`, `carevance.reports.recent`,
`carevance.renewalBannerDismissed`, `carevance.desktopUpdate.seen.<id>`.

These are where the browser has **already written this user's data**. Renaming
one signs everybody out, or loses their theme, or re-shows a banner they
dismissed months ago.

### Webhook headers — a wire contract with customers' systems

`X-CareVance-Event`, `X-CareVance-Delivery`, `X-CareVance-Timestamp`,
`X-CareVance-Signature` in `backend/app/Jobs/DeliverWebhook.php`, and the
signature scheme described in `IntegrationController` and `WebhooksSection`.

Every customer who has built a receiver verifies against these names. Renaming
them silently breaks every existing integration.

### Application identity

`mobile-app/app.json`, `mobile-app/package.json`, `desktop/package.json` and the
desktop shell. These are registered with the OS, the app stores and Expo;
changing them breaks update delivery to installed apps. `GoogleLoginButton` and
`RazorpayPaymentButton` name the app as registered with those providers.

### Hosts and addresses

`mobile-app/src/constants/config.ts` API hostnames, the support mailbox in
`chatChrome.ts`, and the addresses in `frontend/.env.example`. These route
traffic and mail.

### Legal and disclosure copy

`TermsPage.tsx`, `PrivacyPolicyPage.tsx`, `lib/legalContent.ts` and the DPDP
notice in `features/settings/panes/PrivacyPane.tsx` ("What CareVance collects
about you"). These name the vendor **because the vendor is the party and the
data processor**. Substituting a customer's name would make them false.

### Marketing

`frontend/src/pages/LandingPage.tsx`, `frontend/src/components/landing/*` and the
whole `marketing/` site are about this product by name.

### Self-detection

`SELF_TRACKER_KEYWORDS` in `frontend/src/hooks/useDesktopTracker.ts` is how the
tracker recognises its own window so it does not record itself. It is a matching
list, not a label.

---

## Verifying a change

```bash
# web
cd frontend && npx tsc --noEmit && npx vitest run && npx vite build

# backend — templates fail at RENDER time, not compile time, so run these
cd backend && php artisan view:clear && php artisan test --filter="Mail|Email|Invitation|Payslip|Filing"

# mobile
cd mobile-app && npx tsc --noEmit && npx jest
```

Then, with the brand switched off, confirm nothing survives that should not:

```bash
cd frontend && npx vite build
grep -ioE "carevance[^\"'<) ]*" dist/index.html          # expect only: carevance.theme
grep -ohoE "CareVance[^\"'\`,;<)]{0,30}" dist/assets/*.js # expect only the exclusions above
```

Blade is the one that bites: a broken template compiles fine and throws a
`ViewException` when the mail is sent. Three cases caught during this refactor,
all in `:attribute="..."` bindings, where the value is a **PHP expression** and a
`{{ }}` echo is a syntax error — use string concatenation there instead.

### What a grep of the built bundle still finds, and why that is fine

An un-branded build renders nothing branded, but the strings are not all gone
from the JavaScript. Three groups survive and none of them reaches a screen:

- **Storage keys** — `carevance.theme`, `carevance:user` and the dozen others.
  Live, load-bearing, and listed above.
- **The `BRAND` object's own values** — `carevance.com`, the two logo paths, the
  support address. They sit in an object literal, so no bundler removes them
  even when every reader is behind `BRAND.enabled`. Unreferenced at runtime. If
  they must be absent from the artefact as well, move them to `VITE_*` env vars
  so the build never sees them.
- **`SELF_TRACKER_KEYWORDS`** — how the tracker recognises its own window.

One thing that is **not** in the repo: `frontend/.env` (gitignored) sets
`VITE_SALES_EMAIL` and `VITE_SUPPORT_EMAIL`, which Vite inlines at build time.
A local build picks up whatever that file holds. Set both explicitly in any
deployment that must not show a vendor address — the hardcoded fallbacks are now
empty when the brand is off, so nothing leaks from the code itself.

/**
 * The one place the product is named.
 *
 * Every visible use of the vendor's name and logo in the web app reads from
 * here, so re-branding or un-branding the product is an edit to this file
 * rather than a hunt through 80 of them. `docs/BRANDING.md` lists every call
 * site and how to put the original back.
 *
 * TO UN-BRAND: set `enabled` to false. Nothing else needs touching -- the
 * labels below fall back to neutral wording that still reads as a sentence,
 * and the logo component renders the organization's own mark, or its initial,
 * instead of the vendor's.
 *
 * TO RE-BRAND: change `name`, `productName`, `tagline` and the two logo paths,
 * and drop the replacement artwork into `frontend/public/`.
 *
 * WHAT IS DELIBERATELY NOT HERE, and must not be moved here:
 *
 *   Storage keys -- `carevance.theme`, `carevance:user`,
 *   `carevance.rememberedEmail`, `carevance-add-user-defaults` and the rest.
 *   They look like branding and are not: they are where the browser has
 *   already written this user's data. Renaming one signs everybody out, or
 *   loses their theme, or re-shows a banner they dismissed months ago. A
 *   rebrand must never be a data migration.
 *
 *   Real addresses and hosts -- the support mailbox, the API hostnames in the
 *   mobile config. Those route traffic; renaming them breaks delivery.
 *
 *   Application identity -- the name registered with Google and Razorpay, and
 *   `__CAREVANCE_DESKTOP_TRACKER_COMPAT__`, which is a contract with the
 *   desktop shell. `SELF_TRACKER_KEYWORDS` in useDesktopTracker is a matching
 *   list, not a label: it is how the tracker recognises its own window so it
 *   does not record itself.
 *
 * IN SCOPE, and worth knowing why:
 *
 *   Legal and disclosure copy -- the Terms, the Privacy Policy and the DPDP
 *   notice DO read from here, via `legalLabel`. They name a party because a
 *   party is who owes the duty, so "the Service" is a placeholder for a
 *   preview, not a finished document. Before real Terms go live they must name
 *   the actual contracting entity; that is a lawyer's call, not a switch.
 *
 *   Marketing -- the landing page reads from here too, so an un-branded build
 *   is presentable end to end. The separate `marketing/` site does not: it is
 *   about this product by name and has no reason to be neutral.
 */

export const BRAND = {
  /** The master switch. False strips the vendor's name and logo from the app. */
  enabled: false,

  /** The bare wordmark, as it appears mid-sentence. */
  name: 'CareVance',

  /** Name plus product, for titles, report headers and mastheads. */
  productName: 'CareVance HRMS',

  /** Follows the wordmark in email footers. No leading dash. */
  tagline: 'HR and payroll, in one place.',

  /** The in-app assistant's name. */
  assistantName: 'CareVance Assistant',

  /** Served from `frontend/public/`. See the note in BrandLogo about the PNGs. */
  logoFull: '/carevance-logo-full.png',
  logoMark: '/carevance-logo-icon.png',

  /** Prefix for files the user downloads, e.g. `carevance-add-user-template.csv`. */
  filePrefix: 'carevance',

  /** The public site, used in the landing page's structured data. */
  domain: 'carevance.com',

  /** Shown beside the workspace slug in Settings, as `app.<domain>/<slug>`. */
  appDomain: 'app.carevance.com',

  /**
   * Where the chat assistant tells people to go when it cannot reach the API.
   *
   * A REAL mailbox. Un-branded this becomes null and the message drops the
   * address rather than inventing one -- a support line that bounces is worse
   * than no support line.
   */
  supportEmail: 'support@carevance.com',
} as const;

/*
 * Labels, not raw values.
 *
 * Call sites read these rather than `BRAND.name` directly, because "Sign in to
 * CareVance" must not become "Sign in to " when the brand is switched off. The
 * neutral wording is chosen so every sentence that embeds it still parses.
 */

/** Mid-sentence: "Sign in to X", "the rest of X is unaffected". */
export const brandLabel = BRAND.enabled ? BRAND.name : 'this workspace';

/** Titles and mastheads: "X - Payroll Register". */
export const productLabel = BRAND.enabled ? BRAND.productName : 'HR and payroll';

/** The assistant's display name. */
export const assistantLabel = BRAND.enabled ? BRAND.assistantName : 'Assistant';

/** Subject-line fragment for support and sales mailto links. */
export const mailSubjectBrand = BRAND.enabled ? `${BRAND.name} ` : '';

/**
 * A qualifier before a common noun: "CareVance tracker", "CareVance Desktop".
 *
 * Un-branded it is empty, leaving "tracker" and "Desktop" -- which is what the
 * thing is called anyway. Substituting a stand-in here would produce "this
 * workspace tracker", which reads as a mistake.
 */
export const brandPrefix = BRAND.enabled ? `${BRAND.name} ` : '';

/**
 * Formal copy: the Terms, the Privacy Policy and the DPDP notice.
 *
 * "this workspace collects about you" is wrong in a legal document -- the
 * sentence needs a defined party. "the Service" is the conventional term and
 * the one the rest of that copy already uses.
 *
 * NOTE. These documents name a party because a party is who owes the duty. A
 * generic label is fine for a demo or a white-label preview; before real Terms
 * go live they must name the actual contracting entity, and that is a lawyer's
 * call, not a config switch.
 */
export const legalLabel = BRAND.enabled ? BRAND.name : 'the Service';

/** Formal copy, where the full product name is used. */
export const legalProductLabel = BRAND.enabled ? BRAND.productName : 'the Service';

/**
 * The webhook header prefix, as SHOWN on the integrations screen.
 *
 * READ THIS BEFORE CHANGING IT. The backend sends `X-CareVance-Event`,
 * `X-CareVance-Delivery`, `X-CareVance-Timestamp` and `X-CareVance-Signature`
 * from `app/Jobs/DeliverWebhook.php`, and every customer who has built a
 * receiver verifies against those exact names. Renaming them there breaks all
 * of those integrations silently.
 *
 * So this constant changes only what the screen DISPLAYS. With the brand off,
 * the panel names headers the server does not send -- documentation that is
 * wrong rather than merely unbranded. That is a deliberate trade for a
 * white-label preview and must not survive into a deployment that has live
 * webhook consumers.
 *
 * To make them agree, change `DeliverWebhook.php` to the same prefix and send
 * BOTH names for a deprecation window.
 */
export const webhookHeaderPrefix = BRAND.enabled ? 'X-CareVance-' : 'X-Webhook-';

/**
 * The canonical site URL for structured data.
 *
 * Un-branded it falls back to wherever the page is actually served from, which
 * is both neutral and more correct than a vendor domain on somebody else's
 * deployment. Empty during SSR or a test render, and every consumer treats an
 * empty string as "omit the field" -- an Organization entry with a blank url is
 * invalid structured data, not merely unbranded.
 */
export const siteUrl = BRAND.enabled
  ? `https://${BRAND.domain}`
  : (typeof window === 'undefined' ? '' : window.location.origin);

/** `app.carevance.com/` before the workspace slug, or nothing. */
export const appDomainPrefix = BRAND.enabled ? `${BRAND.appDomain}/` : '';

/** The support mailbox, or null when there is no branded one to give. */
export const supportEmail: string | null = BRAND.enabled ? BRAND.supportEmail : null;

/** " at support@…" or "" — so the sentence closes cleanly either way. */
export const supportEmailSuffix = supportEmail ? ` at ${supportEmail}` : '';

/**
 * Prefix for a downloaded file, with its trailing dash.
 *
 * Unbranded this is empty, so `add-user-template.csv` rather than a stray
 * leading dash.
 */
export const downloadPrefix = BRAND.enabled ? `${BRAND.filePrefix}-` : '';

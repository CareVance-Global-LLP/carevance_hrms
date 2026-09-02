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
 *   Legal and disclosure copy -- the Terms, the Privacy Policy and the DPDP
 *   notice in Settings name the vendor because the vendor is the party and the
 *   data processor. Substituting a customer's name there would make them false.
 *
 *   Marketing -- the landing page and the marketing site are about this
 *   product by name, so they say it directly.
 */

export const BRAND = {
  /** The master switch. False strips the vendor's name and logo from the app. */
  enabled: true,

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
 * Prefix for a downloaded file, with its trailing dash.
 *
 * Unbranded this is empty, so `add-user-template.csv` rather than a stray
 * leading dash.
 */
export const downloadPrefix = BRAND.enabled ? `${BRAND.filePrefix}-` : '';

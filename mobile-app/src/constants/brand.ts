/**
 * The one place the product is named in the mobile app.
 *
 * Mirrors `frontend/src/config/brand.ts`; the two are separate files because
 * the apps do not share a module graph, and `docs/BRANDING.md` records that
 * they have to be changed together.
 *
 * TO UN-BRAND: set `enabled` to false.
 *
 * DELIBERATELY NOT HERE, and must not be moved here:
 *
 *   `app.json` and `package.json` -- the name and slug registered with the OS,
 *   the store listing and Expo. Changing those is a release-identity change,
 *   not a rebrand, and it breaks update delivery to installed apps.
 *
 *   `src/constants/config.ts` -- the API hostnames. Those route traffic.
 */

export const BRAND = {
  /** The master switch. False strips the vendor's name from the app's screens. */
  enabled: true,

  /** The bare wordmark, as it appears mid-sentence. */
  name: 'CareVance',

  /** Name plus product, for screen titles and the notification banner. */
  productName: 'CareVance HRMS',
} as const;

/** Mid-sentence. */
export const brandLabel = BRAND.enabled ? BRAND.name : 'this workspace';

/** Titles and mastheads. Neutral wording still reads as a heading. */
export const productLabel = BRAND.enabled ? BRAND.productName : 'HR and payroll';

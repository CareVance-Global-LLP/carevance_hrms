<?php

/*
|--------------------------------------------------------------------------
| Product branding
|--------------------------------------------------------------------------
|
| The one place the product is named in anything the backend sends out --
| every email, the payslip notification and the footer stamped on statutory
| filings. `docs/BRANDING.md` lists every call site and how to revert.
|
| TO UN-BRAND: set `enabled` to false, or BRAND_ENABLED=false in .env. The
| labels below fall back to neutral wording that still reads as a sentence,
| and the logo is omitted rather than left as a broken image.
|
| TO RE-BRAND: change the name, product name, tagline and logo file, and drop
| the replacement artwork into `backend/public/`.
|
| DELIBERATELY NOT HERE:
|
|   The support mailbox and the app URL. Those route mail and links; renaming
|   them breaks delivery, which a rebrand must never do.
|
|   The invitation email's org-led wording. That template already leads with
|   the CUSTOMER's name because the recipient has a relationship with their
|   employer and usually none at all with the vendor -- see its own header
|   comment. It names the vendor once, on purpose, and that single mention is
|   what these keys drive.
|
*/

$enabled = (bool) env('BRAND_ENABLED', true);
$name = env('BRAND_NAME', 'CareVance');
$productName = env('BRAND_PRODUCT_NAME', 'CareVance HRMS');

return [

    /*
     * Labels, not raw values.
     *
     * Templates read these rather than `brand.name`, because "your CareVance
     * account" must not become "your  account" when the brand is switched off.
     * The neutral wording is chosen so every sentence that embeds it still
     * parses.
     */
    'label' => $enabled ? $name : 'this workspace',
    'product_label' => $enabled ? $productName : 'HR and payroll',

    /** The master switch. False strips the vendor's name and logo from outgoing mail. */
    'enabled' => $enabled,

    /** The bare wordmark, as it appears mid-sentence. */
    'name' => $name,

    /** Name plus product, for mastheads and filing footers. */
    'product_name' => $productName,

    /** Follows the wordmark in email footers. No leading dash. */
    'tagline' => env('BRAND_TAGLINE', 'HR and payroll, in one place.'),

    /**
     * Served from `backend/public/`, absolute-URL'd at render time because an
     * email client has no page to resolve a relative path against.
     */
    'logo' => env('BRAND_LOGO', 'carevance-logo-icon.png'),

];

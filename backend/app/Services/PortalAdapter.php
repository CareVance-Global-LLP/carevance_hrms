<?php

namespace App\Services;

use App\Models\Organization;
use App\Models\PayrollFiling;

/**
 * Maps a generated filing to the human-facing "Upload to portal" action.
 *
 * IMPORTANT: This system NEVER posts to any government portal and never stores
 * portal credentials. Every entry returns a public government URL that a human
 * opens to log in, pre-fill / upload the exact file we generated, and pay. The
 * `instructions` tell them precisely what to do with the downloaded file.
 *
 * TDS (Form 24Q) aggregator e-filing is intentionally out of scope here — see
 * the plan; it would be a separate, explicit opt-in integration.
 */
class PortalAdapter
{
    /**
     * @return array{type:string, url:string|null, portal:string|null, instructions:string, prefill:bool, file_based:bool}
     */
    public function resolve(PayrollFiling $filing, Organization $org): array
    {
        $meta = $filing->meta_data ?? [];
        $state = $meta['state'] ?? null;

        return match ($filing->type) {
            'pf_ecr' => [
                'type' => 'pf_ecr',
                'url' => 'https://unifiedportal-emp.epfindia.gov.in',
                'portal' => 'EPFO Unified Employer Portal — ECR Upload',
                'instructions' => 'Log in to the EPFO Unified Employer Portal, go to "ECR Upload", download the ECR text file from this filing, and upload it. Verify member wages/contributions before final submission.',
                'prefill' => false,
                'file_based' => true,
            ],
            'esi_challan' => [
                'type' => 'esi_challan',
                'url' => 'https://portal.esic.gov.in',
                'portal' => 'ESIC Employer Portal — Monthly Contribution',
                'instructions' => 'Log in to the ESIC employer portal, open "Monthly Contribution", and use the portal-aligned CSV from this filing to pre-fill IP contributions. Generate the actual challan and pay there.',
                'prefill' => false,
                'file_based' => true,
            ],
            'form_24q' => [
                'type' => 'form_24q',
                'url' => 'https://www.tdscpc.gov.in',
                'portal' => 'TDS-CPC (TRACES)',
                'instructions' => 'This filing is source data only. Build the actual e-TDS return in NSDL-approved RPU software (FVU format) using this export, then file via TRACES/TDS-CPC.',
                'prefill' => false,
                'file_based' => true,
            ],
            'form_16' => [
                'type' => 'form_16',
                'url' => 'https://www.tdscpc.gov.in',
                'portal' => 'TRACES (Form 16 Part A)',
                'instructions' => 'Form 16 Part B is generated here. Download Part A (with the TRACES certificate number) from TRACES after quarterly TDS filing and attach it before distributing to the employee.',
                'prefill' => false,
                'file_based' => false,
            ],
            'form_12ba' => [
                'type' => 'form_12ba',
                'url' => null,
                'portal' => 'Issued to employee (no portal upload)',
                'instructions' => 'Form 12BA is an employer-issued statement paired with Form 16 Part B. No government portal upload is required — distribute it to the employee alongside Form 16.',
                'prefill' => false,
                'file_based' => false,
            ],
            'pt_return' => [
                'type' => 'pt_return',
                'url' => $meta['portal']['url'] ?? null,
                'portal' => $meta['portal']['name'] ?? 'State Commercial Tax Department',
                'instructions' => 'Use the PT contribution summary from this filing to key the return/payment into the state commercial tax department portal.'.($state ? " State: {$state}." : ''),
                'prefill' => false,
                'file_based' => false,
            ],
            'lwf_return' => [
                'type' => 'lwf_return',
                'url' => $meta['portal']['url'] ?? null,
                'portal' => $meta['portal']['name'] ?? 'State Labour Department',
                'instructions' => 'Use the LWF return from this filing to file/pay on the state labour department portal.'.($state ? " State: {$state}." : ''),
                'prefill' => false,
                'file_based' => false,
            ],
            'bonus_form_c' => [
                'type' => 'bonus_form_c',
                'url' => null,
                'portal' => 'Maintained as statutory record (no portal upload)',
                'instructions' => 'Bonus Form C is the annual return under the Payment of Bonus Act, retained as a statutory record. File/submit per your state labour department requirement.',
                'prefill' => false,
                'file_based' => false,
            ],
            default => [
                'type' => $filing->type,
                'url' => null,
                'portal' => null,
                'instructions' => 'No portal mapping configured for this filing type.',
                'prefill' => false,
                'file_based' => false,
            ],
        };
    }
}

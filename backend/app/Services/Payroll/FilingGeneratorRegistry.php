<?php

namespace App\Services\Payroll;

/**
 * The single authority on which statutory filings this installation can
 * actually produce.
 *
 * Ten declaration-form generators reference blade views that were never
 * written. Before this class existed the dashboard advertised all nineteen
 * returns as `complianceStatus: 'ready'`, the user clicked, and the generator
 * threw — after the batch had already written PF ECR, ESI, 24Q and 12BA.
 *
 * Availability is resolved against the filesystem rather than a hand-kept
 * flag, so writing `resources/views/filings/form19.blade.php` is the whole act
 * of shipping Form 19. There is no second edit here to forget, and no window
 * in which the list and the templates disagree.
 */
class FilingGeneratorRegistry
{
    private const MISSING_TEMPLATE_REASON =
        'The statutory template for this form has not been written yet. '
        .'It is real compliance work, not a configuration step.';

    /**
     * type => [label, view].
     *
     * A null view means the generator writes a text, CSV or aggregate format
     * directly and needs no blade template — those can never be unavailable
     * for want of a view.
     *
     * @var array<string, array{0:string, 1:?string}>
     */
    private const GENERATORS = [
        // Text / CSV / aggregate generators — no blade template involved.
        'pf_ecr' => ['PF ECR', null],
        'esi_challan' => ['ESI Challan', null],
        'form_24q' => ['Form 24Q', null],
        'full_ecr' => ['Full ECR', null],
        'pt_return' => ['PT Return', null],
        'lwf_return' => ['LWF Return', null],
        'bonus' => ['Bonus (C + D + E)', null],
        'bonus_form_c' => ['Bonus — Form C', null],
        'bonus_form_d' => ['Bonus — Form D', null],
        'bonus_form_e' => ['Bonus — Form E', null],

        // PDF generators whose templates exist.
        'form_12ba' => ['Form 12BA', 'filings.form12ba'],
        'form_16' => ['Form 16', 'filings.form16'],
        'form_16_annual' => ['Form 16 (Annual)', 'filings.form16_annual'],

        // PDF generators whose templates do not exist yet. Listed rather than
        // omitted: the product must be able to say *why* these are missing.
        'form_19' => ['Form 19', 'filings.form19'],
        'form_31' => ['Form 31', 'filings.form31'],
        'form_1' => ['Form 1', 'filings.form1'],
        'form_2' => ['Form 2', 'filings.form2'],
        'form_6' => ['Form 6', 'filings.form6'],
        'form_124' => ['Form 124', 'filings.form124'],
        'eshram_registration' => ['e-SHRAM', 'filings.eshram_registration'],
        'uan_activation' => ['UAN Activation', 'filings.uan_activation'],
        'se_registration' => ['S&E Registration', 'filings.se_registration'],
        'shram_card_registration' => ['Shram Card', 'filings.shram_card_registration'],
    ];

    /**
     * @return array<string, array{label:string, view:?string, available:bool, unavailable_reason:?string}>
     */
    public function all(): array
    {
        $catalogue = [];

        foreach (self::GENERATORS as $type => [$label, $view]) {
            $available = $view === null || $this->viewExists($view);

            $catalogue[$type] = [
                'label' => $label,
                'view' => $view,
                'available' => $available,
                'unavailable_reason' => $available ? null : self::MISSING_TEMPLATE_REASON,
            ];
        }

        return $catalogue;
    }

    /**
     * Whether a filing can be produced.
     *
     * A type this registry has never heard of reports *available*, and that
     * default is deliberate. This method gates `generateAllFilings`, so a
     * false answer silently removes a filing from the batch. A new generator
     * added without a registry entry should therefore still run and be judged
     * on whether it throws — the failure mode of the old code — rather than
     * disappearing from the run with no error anywhere. Unknown types are
     * reported honestly by `unavailableReason()` for the catalogue, which is
     * where a missing entry can be surfaced without dropping work.
     */
    public function isAvailable(string $type): bool
    {
        $entry = self::GENERATORS[$type] ?? null;

        if ($entry === null) {
            return true;
        }

        return $entry[1] === null || $this->viewExists($entry[1]);
    }

    public function unavailableReason(string $type): ?string
    {
        if (! array_key_exists($type, self::GENERATORS)) {
            return null;
        }

        return $this->isAvailable($type) ? null : self::MISSING_TEMPLATE_REASON;
    }

    public function isKnown(string $type): bool
    {
        return array_key_exists($type, self::GENERATORS);
    }

    /**
     * Resolved against the filesystem rather than the view finder: the finder
     * caches its hints, and this has to reflect what is actually on disk on
     * every call for the truthfulness test to mean anything.
     */
    private function viewExists(string $view): bool
    {
        return file_exists(
            resource_path('views/'.str_replace('.', '/', $view).'.blade.php')
        );
    }
}

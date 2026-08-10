<?php

namespace App\Services\Lifecycle;

use App\Models\ChecklistTemplate;
use App\Models\ChecklistTemplateItem;
use Illuminate\Support\Facades\DB;

/**
 * Seeds a usable default checklist the first time an organisation needs one.
 *
 * Lazy rather than migration-time, so organisations created before this feature
 * existed get their templates on first use and nothing has to be backfilled.
 * Offsets are relative to the anchor: negative is before joining / before the
 * last working day.
 */
class DefaultChecklistProvisioner
{
    /** @var array<int, array{title:string,owner_kind:string,offset_days:int,requires?:string,document_category?:string,is_blocking?:bool,description?:string}> */
    public const ONBOARDING = [
        ['title' => 'Send offer letter and welcome pack', 'owner_kind' => 'hr', 'offset_days' => -14],
        ['title' => 'Upload PAN card', 'owner_kind' => 'employee', 'offset_days' => -7, 'requires' => 'document', 'document_category' => 'pan', 'is_blocking' => true],
        ['title' => 'Upload bank account details', 'owner_kind' => 'employee', 'offset_days' => -7, 'requires' => 'document', 'document_category' => 'bank', 'is_blocking' => true],
        ['title' => 'Upload proof of identity and address', 'owner_kind' => 'employee', 'offset_days' => -7, 'requires' => 'document', 'document_category' => 'identity'],
        ['title' => 'Upload previous employment documents', 'owner_kind' => 'employee', 'offset_days' => -5, 'requires' => 'document', 'document_category' => 'employment'],
        ['title' => 'Sign employment contract', 'owner_kind' => 'employee', 'offset_days' => -5, 'requires' => 'document', 'document_category' => 'contract', 'is_blocking' => true],
        ['title' => 'Create email account and system access', 'owner_kind' => 'it', 'offset_days' => -3, 'is_blocking' => true],
        ['title' => 'Prepare laptop and peripherals', 'owner_kind' => 'it', 'offset_days' => -2, 'is_blocking' => true],
        ['title' => 'Assign onboarding buddy', 'owner_kind' => 'hr', 'offset_days' => -2],
        ['title' => 'Share first-week schedule with the team', 'owner_kind' => 'manager', 'offset_days' => -1],
        ['title' => 'Welcome and workspace handover', 'owner_kind' => 'manager', 'offset_days' => 0],
        ['title' => 'Hand over equipment and collect signature', 'owner_kind' => 'it', 'offset_days' => 0, 'requires' => 'acknowledgement'],
        ['title' => 'Payroll and benefits enrolment', 'owner_kind' => 'finance', 'offset_days' => 1],
        ['title' => 'Complete workplace policy training', 'owner_kind' => 'employee', 'offset_days' => 5, 'requires' => 'acknowledgement'],
        ['title' => 'First-week check-in', 'owner_kind' => 'buddy', 'offset_days' => 7],
        ['title' => '30-day review', 'owner_kind' => 'manager', 'offset_days' => 30],
        ['title' => '60-day review', 'owner_kind' => 'manager', 'offset_days' => 60],
        ['title' => 'Probation review and confirmation', 'owner_kind' => 'manager', 'offset_days' => 90],
    ];

    /** @var array<int, array{title:string,owner_kind:string,offset_days:int,requires?:string,is_blocking?:bool,description?:string}> */
    public const OFFBOARDING = [
        ['title' => 'Acknowledge resignation and confirm last working day', 'owner_kind' => 'hr', 'offset_days' => -30],
        ['title' => 'Agree knowledge transfer plan', 'owner_kind' => 'manager', 'offset_days' => -21, 'is_blocking' => true],
        ['title' => 'Hand over active projects and clients', 'owner_kind' => 'employee', 'offset_days' => -7, 'is_blocking' => true],
        ['title' => 'Hand over documents and credentials', 'owner_kind' => 'employee', 'offset_days' => -3, 'is_blocking' => true],
        ['title' => 'Complete exit interview', 'owner_kind' => 'hr', 'offset_days' => -2],
        ['title' => 'Confirm no outstanding advances or loans', 'owner_kind' => 'finance', 'offset_days' => -1, 'is_blocking' => true],
        ['title' => 'Revoke system and application access', 'owner_kind' => 'it', 'offset_days' => 0, 'is_blocking' => true],
        ['title' => 'Collect ID card and access badge', 'owner_kind' => 'it', 'offset_days' => 0, 'requires' => 'asset_return', 'is_blocking' => true],
        ['title' => 'Manager sign-off on clearance', 'owner_kind' => 'manager', 'offset_days' => 0, 'is_blocking' => true],
        ['title' => 'Issue experience and relieving letter', 'owner_kind' => 'hr', 'offset_days' => 3],
        ['title' => 'Process full and final settlement', 'owner_kind' => 'finance', 'offset_days' => 30],
    ];

    /**
     * Returns the organisation's template for a kind, creating the default set
     * on first call. Safe to call on every journey creation.
     */
    public function ensure(int $organizationId, string $kind): ChecklistTemplate
    {
        $existing = ChecklistTemplate::defaultFor($organizationId, $kind);
        if ($existing) {
            return $existing;
        }

        $blueprint = $kind === ChecklistTemplate::KIND_ONBOARDING ? self::ONBOARDING : self::OFFBOARDING;
        $name = $kind === ChecklistTemplate::KIND_ONBOARDING ? 'Standard onboarding' : 'Standard exit clearance';

        return DB::transaction(function () use ($organizationId, $kind, $blueprint, $name) {
            $template = ChecklistTemplate::create([
                'organization_id' => $organizationId,
                'kind' => $kind,
                'name' => $name,
                'description' => 'Created automatically. Edit or replace it in Settings.',
                'is_default' => true,
                'is_active' => true,
            ]);

            foreach ($blueprint as $index => $row) {
                ChecklistTemplateItem::create([
                    'checklist_template_id' => $template->id,
                    'title' => $row['title'],
                    'description' => $row['description'] ?? null,
                    'owner_kind' => $row['owner_kind'],
                    'offset_days' => $row['offset_days'],
                    'requires' => $row['requires'] ?? 'none',
                    'document_category' => $row['document_category'] ?? null,
                    'is_blocking' => $row['is_blocking'] ?? false,
                    'sort_order' => $index * 10,
                ]);
            }

            return $template->load('items');
        });
    }
}

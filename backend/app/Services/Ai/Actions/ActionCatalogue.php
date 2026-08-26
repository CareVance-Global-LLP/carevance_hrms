<?php

namespace App\Services\Ai\Actions;

use App\Models\Group;
use App\Models\LeaveType;
use App\Models\Organization;

/**
 * Everything AI mode is allowed to change, written down by hand.
 *
 * `SemanticLayer` is the equivalent for reads, and the two are deliberately
 * shaped alike: the model picks a KEY from a curated list and supplies values.
 * It cannot name an endpoint, a table, a column or a model class, so the worst
 * a wrong plan can do is name a key that does not exist — which is a refusal,
 * not a write.
 *
 * WHY EACH ENTRY LOOKS LIKE THIS
 *
 * - `endpoint` is a real HTTP method and route, because execution goes through
 *   the REAL ENDPOINT and never through Eloquent. This codebase has zero
 *   Laravel policies: authorization lives inline in controllers, so a direct
 *   `$model->update()` would not be a shortcut past one check, it would be a
 *   shortcut past ALL of them — plus the FormRequest rules, the audit
 *   observers, and `BelongsToOrganization`'s global scope.
 * - `roles` mirrors the middleware that route actually carries, and
 *   `permission` names the capability in business terms. Both are needed and
 *   they are not the same set: `settings.manage` is granted to admin, hr and
 *   payroll_manager, while `role:admin` admits only admin. Checking the
 *   capability alone would walk an HR user through composing a change and then
 *   403 them at Apply, which is precisely the "told immediately" the preview
 *   exists to provide.
 * - `target_by` is how a phrase becomes a row — "the casual leave policy" has
 *   to resolve to one record, and the lookup columns are named here rather than
 *   guessed. Resolution still runs inside the tenant scope, so a name belonging
 *   to another organisation resolves to nothing.
 * - `fields` carry bounds so an out-of-range value is refused at PREVIEW, in
 *   words about days, rather than reaching the endpoint and coming back as a
 *   422 the asker cannot act on.
 * - `impact` answers "and who does this land on?" as a COUNT. Never a list of
 *   names: a preview is not a directory export.
 * - `required_by_endpoint` exists because a FormRequest can mark a field
 *   `required` even for a partial edit. `PUT /api/settings/organization`
 *   requires `name` and `slug` whatever else is being changed, so the executor
 *   has to echo the CURRENT value of any of these the plan does not touch. Omit
 *   this and a timezone change is a 422 — the whole feature failing at the last
 *   step, after a human has already confirmed it.
 *
 * WHAT IS DELIBERATELY ABSENT
 *
 * No deletes, no money, no payroll state transitions. Locking, approving,
 * releasing and disbursing a run carry maker-checker exactly so one actor
 * cannot do them alone; routing them through an assistant makes the maker and
 * the checker the same person by construction. `ActionCatalogueTest` scans this
 * file by pattern rather than pinning today's three entries, so an addition
 * that reaches into any of it trips a test without anybody remembering to add
 * a case.
 *
 * @see docs/superpowers/specs/2026-08-26-ai-write-actions.md §3, §4
 */
class ActionCatalogue
{
    /**
     * The organisation an action is aimed at is the acting user's own, and
     * there is no other addressable one. Used where `target_by` would otherwise
     * be empty — an empty lookup list reads as "no way to find a target", which
     * is a hole, and this says "there is exactly one and we already know it".
     */
    public const TARGET_ACTING_ORGANIZATION = 'acting_organization';

    /** Every impact the preview knows how to turn into a count. */
    public const IMPACTS = [
        'employees_in_organization',
        'employees_in_department',
    ];

    /**
     * @return array<string, array<string, mixed>>
     */
    public static function all(): array
    {
        return [
            /*
             * Leave policy. A quota and a carry-forward cap decide how much
             * leave every employee earns and keeps, which is why the route is
             * admin-only and why these two fields are the whole of it — the
             * accrual frequency, the year-end action and the probation rate all
             * change how the ledger is WRITTEN, and a wrong one there is not a
             * field edit, it is a re-computation of everyone's balance.
             *
             * Days, not currency. Leave does encash into pay eventually, but
             * these columns count days and the money is derived elsewhere,
             * once, at a boundary.
             */
            'leave_type.update' => [
                'label' => 'Update a leave type',
                'model' => LeaveType::class,
                // `name` is what a person says; `code` is what a policy is
                // keyed by. Both are real columns and both are unique enough
                // within a tenant to resolve one row.
                'target_by' => ['name', 'code'],
                'permission' => 'settings.manage',
                'roles' => ['admin'],
                'endpoint' => ['PUT', '/api/leave-types/{leaveType}'],
                'required_by_endpoint' => [],
                'fields' => [
                    'carry_forward_cap' => [
                        'label' => 'Carry-forward cap',
                        'type' => 'number',
                        'min' => 0,
                        'max' => 365,
                        'unit' => 'days',
                    ],
                    'annual_quota' => [
                        'label' => 'Annual quota',
                        'type' => 'number',
                        'min' => 0,
                        'max' => 365,
                        'unit' => 'days',
                    ],
                ],
                'impact' => 'employees_in_organization',
                'view_route' => '/settings?pane=leave-types',
            ],

            /*
             * The organisation itself: what it is called, what clock it keeps,
             * and when its working day starts.
             *
             * `/api/settings/organization` rather than
             * `/api/organizations/{id}` on purpose. The timezone and the two
             * working-day times live inside the `settings` JSON, and the
             * organizations route takes `settings` as one whole array — writing
             * a timezone through it means sending the entire blob back, which
             * turns a one-field edit into a full overwrite of every other
             * setting in it. The settings endpoint merges key by key.
             */
            'organization.update' => [
                'label' => 'Update organization settings',
                'model' => Organization::class,
                'target_by' => [self::TARGET_ACTING_ORGANIZATION],
                'permission' => 'settings.manage',
                'roles' => ['admin', 'manager'],
                'endpoint' => ['PUT', '/api/settings/organization'],
                // Both are `required` on UpdateOrganizationRequest regardless
                // of what is being changed, so the executor echoes the live
                // value of whichever the plan does not touch.
                'required_by_endpoint' => ['name', 'slug'],
                'fields' => [
                    'name' => [
                        'label' => 'Organization name',
                        'type' => 'text',
                        'max_length' => 255,
                    ],
                    'timezone' => [
                        'label' => 'Timezone',
                        'type' => 'timezone',
                    ],
                    // The working day. `office_start_time` is when the day
                    // begins; `late_after_time` is when arriving counts as
                    // late, and they are separate because a grace period is a
                    // policy decision, not a rounding of the first.
                    'office_start_time' => [
                        'label' => 'Office start time',
                        'type' => 'time',
                        'format' => 'H:i',
                    ],
                    'late_after_time' => [
                        'label' => 'Late after',
                        'type' => 'time',
                        'format' => 'H:i',
                    ],
                ],
                'impact' => 'employees_in_organization',
                'view_route' => '/settings?pane=organization',
            ],

            /*
             * Renaming a department.
             *
             * There is no departments table — a department IS a row in
             * `groups`, which is why the model here is Group and the endpoint
             * is the groups one. The name is the only field: membership,
             * activation and description all change who is in a report or
             * whether a group answers at all, and none of them is what somebody
             * means by "rename".
             *
             * Worth having precisely because of the duplicate-name problem this
             * codebase already carries — "HR" and "Human Resources" as two
             * departments splitting every department-scoped report. Fixing that
             * is a rename, and it is the kind of small correction nobody opens
             * a settings screen for.
             */
            'department.rename' => [
                'label' => 'Rename a department',
                'model' => Group::class,
                'target_by' => ['name'],
                'permission' => 'groups.manage',
                'roles' => ['admin', 'manager'],
                'endpoint' => ['PUT', '/api/groups/{id}'],
                'required_by_endpoint' => [],
                'fields' => [
                    'name' => [
                        'label' => 'Department name',
                        'type' => 'text',
                        'max_length' => 100,
                    ],
                ],
                'impact' => 'employees_in_department',
                'view_route' => '/employees/teams',
            ],
        ];
    }

    /** @return list<string> */
    public static function keys(): array
    {
        return array_keys(self::all());
    }

    public static function has(string $key): bool
    {
        return array_key_exists($key, self::all());
    }

    /**
     * @return array<string, mixed>|null
     */
    public static function get(string $key): ?array
    {
        return self::all()[$key] ?? null;
    }

    /**
     * The declaration for one field of one action, or null.
     *
     * Deliberately scoped to the action rather than to the model: a column
     * being editable through one action says nothing about another. `is_active`
     * exists on `leave_types` and is not in `leave_type.update`, and asking for
     * it must come back as "not a field of this action", not as a lookup that
     * happens to find it on the table.
     *
     * @return array<string, mixed>|null
     */
    public static function field(string $key, string $field): ?array
    {
        return self::get($key)['fields'][$field] ?? null;
    }
}

<?php

namespace App\Services\Payroll;

use App\Models\EmployeePayrollTemplate;
use App\Models\PayrollItem;
use App\Models\PayrollMonthlyRun;
use App\Models\PayrollOverride;
use App\Models\SalaryComponent;
use App\Services\PayrollCalculatorService;
use Carbon\Carbon;
use Illuminate\Support\Collection;

/**
 * One row per employee: what the structure produces, and what will be paid.
 *
 * The same builder serves the grid and the CSV export. That is deliberate — a
 * spreadsheet whose figures disagree with the screen it was exported from is
 * worse than no export at all, and two query paths would eventually drift.
 * Paging is applied by the caller, not here.
 *
 * Everything on the way out is ANNUAL, because that is the unit a revision
 * letter, an offer and the override register all use. The engine works monthly.
 * The conversion happens once, at this boundary.
 */
class OverrideGridService
{
    /** Only these two are overridable in this release. */
    public const OVERRIDABLE = ['basic', 'hra'];

    public function __construct(
        private readonly PayrollCalculatorService $calculator,
        private readonly OverrideBalancingService $balancer,
    ) {
    }

    /**
     * The earliest month an override may still affect.
     *
     * Anything on or before the last closed run is history: an override
     * backdated into it would change a figure already paid, which is the one
     * thing this module exists not to do.
     */
    public function earliestOpenMonth(int $organizationId): string
    {
        $lastClosed = PayrollMonthlyRun::query()
            ->where('organization_id', $organizationId)
            ->whereIn('status', ['disbursed', 'released', 'approved'])
            ->orderByDesc('month_year')
            ->value('month_year');

        if (! $lastClosed) {
            return now()->format('Y-m');
        }

        return Carbon::createFromFormat('Y-m', $lastClosed)->addMonth()->format('Y-m');
    }

    /**
     * Rows for every employee the filter selects.
     *
     * @param  array{q?: string|null, salary_template_id?: int|null}  $filters
     * @return Collection<int, array<string, mixed>>
     */
    public function rows(int $organizationId, string $monthYear, array $filters = []): Collection
    {
        $templates = EmployeePayrollTemplate::query()
            ->where('organization_id', $organizationId)
            ->where('is_active', true)
            ->with([
                'user:id,name,organization_id',
                'user.employeeWorkInfo:id,user_id,employee_code,designation,report_group_id',
                'user.employeeWorkInfo.department:id,name',
                'salaryTemplate:id,name',
            ])
            ->when(
                $filters['salary_template_id'] ?? null,
                fn ($query, $id) => $query->where('salary_template_id', $id),
            )
            ->get()
            // Filtered in PHP rather than SQL because the searchable text spans
            // three tables and the set is a few hundred rows, not a few million.
            ->filter(function (EmployeePayrollTemplate $template) use ($filters) {
                $needle = trim((string) ($filters['q'] ?? ''));

                if ($needle === '') {
                    return true;
                }

                $haystack = strtolower(implode(' ', [
                    $template->user?->name ?? '',
                    $template->user?->employeeWorkInfo?->employee_code ?? '',
                ]));

                return str_contains($haystack, strtolower($needle));
            })
            ->values();

        $userIds = $templates->pluck('user_id')->all();

        /*
         * Two queries for the whole page rather than two per row. The grid
         * renders up to 100 employees and this used to be where an N+1 would
         * hide — the override lookup and the lock lookup are both per-employee
         * questions with a single answer set.
         */
        $overrides = PayrollOverride::query()
            ->whereIn('user_id', $userIds)
            ->whereIn('scope', ['component'])
            ->whereIn('status', [PayrollOverride::STATUS_PENDING, PayrollOverride::STATUS_APPROVED])
            ->get()
            ->groupBy('user_id');

        $lockedUserIds = PayrollItem::query()
            ->whereIn('user_id', $userIds)
            ->where('month_year', $monthYear)
            ->whereNotNull('locked_at')
            ->pluck('user_id')
            ->flip();

        return $templates->map(fn (EmployeePayrollTemplate $template) => $this->row(
            $template,
            $overrides->get($template->user_id, collect()),
            $lockedUserIds->has($template->user_id),
            $monthYear,
        ));
    }

    /** The residual component, and whether the organisation has named two. */
    public function residualMeta(int $organizationId): array
    {
        $residual = $this->balancer->resolveResidual($organizationId);

        return [
            'residual_component' => $residual ? ['id' => $residual->id, 'name' => $residual->name] : null,
            'ambiguous_residual' => $this->balancer->hasAmbiguousResidual($organizationId),
        ];
    }

    /**
     * Which of basic/hra the organisation has opened to employee-level
     * override, as engine keys.
     *
     * @return list<string>
     */
    public function overridableTargets(int $organizationId): array
    {
        return SalaryComponent::query()
            ->where('organization_id', $organizationId)
            ->where('is_active', true)
            ->where('allow_employee_override', true)
            ->get()
            ->map(fn (SalaryComponent $component) => OverrideApplicationService::engineKeyFor($component))
            ->filter(fn (?string $key) => $key !== null && in_array($key, self::OVERRIDABLE, true))
            ->unique()
            ->values()
            ->all();
    }

    /**
     * The structure percentages for one employee, as the engine sees them.
     *
     * @return array<string, float>
     */
    public function configFor(EmployeePayrollTemplate $template): array
    {
        return $this->calculator->resolveStructureConfig([
            'basic_percentage' => (float) ($template->basic_percentage ?? 40) / 100,
            'hra_percentage_of_basic' => (float) ($template->hra_percentage ?? 50) / 100,
            'conveyance_allowance' => (float) ($template->conveyance_allowance ?? 1600),
            'medical_allowance' => (float) ($template->medical_allowance ?? 0),
        ], (bool) ($template->is_metro_city ?? true));
    }

    /**
     * @param  Collection<int, PayrollOverride>  $overrides
     * @return array<string, mixed>
     */
    private function row(
        EmployeePayrollTemplate $template,
        Collection $overrides,
        bool $locked,
        string $monthYear
    ): array {
        $annualCtc = (float) ($template->annual_ctc ?? 0);
        $monthlyCtc = $annualCtc / 12;
        $config = $this->configFor($template);

        $computed = $annualCtc > 0
            ? $this->calculator->calculateSalaryComponents($monthlyCtc, $config)
            : ['basic' => 0.0, 'hra' => 0.0, 'conveyance' => 0.0, 'special_allowance' => 0.0];

        $overridable = $this->overridableTargets($template->organization_id);
        $inForce = $overrides->filter(
            fn (PayrollOverride $override) => $override->status === PayrollOverride::STATUS_APPROVED
        );

        $effective = $computed;
        foreach ($inForce as $override) {
            if (array_key_exists($override->target, $effective)) {
                $effective[$override->target] = (float) $override->value;
            }
        }

        // HRA follows basic unless HRA itself carries an override — the rule in
        // §3.1, and the reason the amplification differs between the two cases.
        $hraPinned = $inForce->contains(fn (PayrollOverride $o) => $o->target === 'hra');
        if (! $hraPinned && $inForce->contains(fn (PayrollOverride $o) => $o->target === 'basic')) {
            $effective['hra'] = $effective['basic'] * (float) $config['hra_percentage_of_basic'];
        }

        $components = [];
        foreach (['basic', 'hra'] as $target) {
            $override = $overrides->firstWhere('target', $target);

            $components[$target] = [
                'annual' => $this->annual($effective[$target] ?? null),
                'computed_annual' => $this->annual($computed[$target] ?? null),
                'overridable' => in_array($target, $overridable, true),
                'override_id' => $override?->id,
                'status' => $override?->status,
                /*
                 * What has been REQUESTED but not yet approved.
                 *
                 * Separate from `annual` on purpose: `annual` is what will be
                 * paid, and a pending override changes nothing until somebody
                 * releases it. But without this the grid had no way to show
                 * that a request exists at all — an officer saved a change,
                 * watched the cell snap back to the structure figure, and had
                 * no way to tell a saved request from a failed save.
                 */
                'pending_annual' => $override && $override->status === PayrollOverride::STATUS_PENDING
                    ? (int) round((float) $override->value * 12)
                    : null,
            ];
        }

        $namedTotal = ($effective['basic'] ?? 0) + ($effective['hra'] ?? 0) + ($effective['conveyance'] ?? 0);
        $grossAfter = $annualCtc > 0
            ? $monthlyCtc
                - $this->calculator->calculateEmployerPF($effective['basic'] ?? 0)
                - $this->calculator->calculateGratuityProvision($effective['basic'] ?? 0)
            : 0.0;

        $components['special_allowance'] = [
            'annual' => $this->annual($grossAfter - $namedTotal),
            'overridable' => false,
            'role' => 'residual',
        ];
        $components['conveyance'] = [
            'annual' => $this->annual($effective['conveyance'] ?? null),
            'overridable' => false,
        ];

        $workInfo = $template->user?->employeeWorkInfo;

        return [
            'user_id' => (int) $template->user_id,
            'employee_number' => $workInfo?->employee_code,
            'employee_name' => $template->user?->name,
            'department' => $workInfo?->department?->name,
            'salary_structure' => $template->salaryTemplate?->name,
            'annual_ctc' => $this->annual($monthlyCtc),
            'components' => $components,
            'max_basic_annual' => $annualCtc > 0
                ? $this->annual($this->calculator->maxBasicWithinCtc($monthlyCtc, $config))
                : null,
            'locked' => $locked,
            'lock_reason' => $locked
                ? sprintf('%s payroll is finalised for this employee.', $monthYear)
                : null,
        ];
    }

    /**
     * Monthly to annual, as a whole rupee.
     *
     * Null survives as null: it means "this component is not in this
     * employee's structure", which is a different statement from zero and the
     * importer refuses a value for it.
     */
    private function annual(?float $monthly): ?int
    {
        if ($monthly === null) {
            return null;
        }

        return (int) round($monthly * 12);
    }
}

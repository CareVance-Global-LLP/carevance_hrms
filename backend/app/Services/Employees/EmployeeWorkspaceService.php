<?php

namespace App\Services\Employees;

use App\Models\AuditLog;
use App\Models\EmployeeActivityLog;
use App\Models\EmployeeBankAccount;
use App\Models\EmployeeDocument;
use App\Models\EmployeeGovernmentId;
use App\Models\EmployeeProfile;
use App\Models\EmployeeSalaryAssignment;
use App\Models\EmployeeWorkInfo;
use App\Models\Group;
use App\Models\LeaveRequest;
use App\Models\PayrollAdjustment;
use App\Models\PayrollAuditLog;
use App\Models\PayrollProfile;
use App\Models\PayrollTaxDeclaration;
use App\Models\Payslip;
use App\Models\Reimbursement;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Storage;

class EmployeeWorkspaceService
{
    private const EMPLOYEE_DOCUMENTS_DISK = 'employee_documents';

    public function workspace(User $employee, string $payrollMonth): array
    {
        $employee->loadMissing([
            'groups:id,name,slug',
            'employeeProfile',
            'employeeWorkInfo.department',
            'employeeWorkInfo.reportingManager:id,name,email',
            'payrollProfile.salaryTemplate.components.component',
            'salaryAssignments.salaryTemplate',
        ]);

        $profile = $employee->employeeProfile;
        $workInfo = $employee->employeeWorkInfo;
        $payrollProfile = $employee->payrollProfile;
        $fallbackReportingManager = User::query()
            ->where('organization_id', $employee->organization_id)
            ->where('role', 'manager')
            ->whereHas('groups', fn ($query) => $query->whereIn('groups.id', $employee->groups->pluck('id')))
            ->orderBy('name')
            ->first(['id', 'name', 'email']);
        $resolvedReportingManager = $workInfo?->reportingManager ?: $fallbackReportingManager;
        $attendance = $this->attendanceSummary($employee, $payrollMonth);
        $leave = $this->leaveSummary($employee, $payrollMonth);
        $documents = EmployeeDocument::query()
            ->with('uploader:id,name,email')
            ->where('organization_id', $employee->organization_id)
            ->where('user_id', $employee->id)
            ->latest('uploaded_at')
            ->latest()
            ->get();
        $governmentIds = EmployeeGovernmentId::query()
            ->with(['document', 'reviewer:id,name,email'])
            ->where('organization_id', $employee->organization_id)
            ->where('user_id', $employee->id)
            ->latest()
            ->get();
        $bankAccounts = EmployeeBankAccount::query()
            ->with('document')
            ->where('organization_id', $employee->organization_id)
            ->where('user_id', $employee->id)
            ->orderByDesc('is_default')
            ->latest()
            ->get();
        $salaryAssignments = EmployeeSalaryAssignment::query()
            ->with('salaryTemplate:id,name,currency')
            ->where('organization_id', $employee->organization_id)
            ->where('user_id', $employee->id)
            ->latest('effective_from')
            ->limit(8)
            ->get();
        $reimbursements = Reimbursement::query()
            ->where('organization_id', $employee->organization_id)
            ->where('user_id', $employee->id)
            ->latest()
            ->limit(8)
            ->get();
        $adjustments = PayrollAdjustment::query()
            ->with(['approvedBy:id,name,email', 'appliedBy:id,name,email', 'appliedRun:id,run_code,payroll_month'])
            ->where('organization_id', $employee->organization_id)
            ->where('user_id', $employee->id)
            ->latest()
            ->limit(8)
            ->get();
        $taxDeclarations = PayrollTaxDeclaration::query()
            ->where('organization_id', $employee->organization_id)
            ->where('user_id', $employee->id)
            ->latest('financial_year')
            ->latest()
            ->limit(5)
            ->get();

        return [
            'employee' => $employee,
            'payroll_month' => $payrollMonth,
            'about' => $profile,
            'work_info' => $workInfo,
            'payroll' => [
                'profile' => $payrollProfile,
                'salary_assignments' => $salaryAssignments,
                'current_compensation' => $this->simpleCompensationSnapshot($payrollProfile),
                'warnings' => $this->simplePayrollWarnings($employee, $payrollProfile),
                'tax_declarations' => $taxDeclarations->values(),
                'pending_reimbursements' => $reimbursements->whereIn('status', ['draft', 'pending_approval'])->count(),
                'recent_reimbursements' => $reimbursements->values(),
                'recent_adjustments' => $adjustments->values(),
            ],
            'government_ids' => $governmentIds,
            'bank_accounts' => $bankAccounts,
            'documents' => $documents,
            'attendance' => $attendance,
            'leave' => $leave,
            'activity' => $this->activityFeed($employee),
            'overview' => [
                'reporting_manager' => $resolvedReportingManager?->only(['id', 'name', 'email']),
                'department' => $workInfo?->department?->name,
                'designation' => $workInfo?->designation,
                'documents_uploaded' => $documents->count(),
                'salary_template' => $payrollProfile?->salaryTemplate?->name ?? $salaryAssignments->first()?->salaryTemplate?->name,
                'pending_reimbursements' => $reimbursements->whereIn('status', ['draft', 'pending_approval'])->count(),
                'payslips_count' => Payslip::query()
                    ->where('organization_id', $employee->organization_id)
                    ->where('user_id', $employee->id)
                    ->count(),
            ],
            'readiness' => $this->readiness($employee, $payrollMonth, $attendance, $leave, $documents, $governmentIds, $bankAccounts),
            'options' => [
                'departments' => \App\Models\ReportGroup::query()
                    ->where('organization_id', $employee->organization_id)
                    ->orderBy('name')
                    ->get(['id', 'name']),
                'managers' => User::query()
                    ->where('organization_id', $employee->organization_id)
                    ->whereIn('role', ['admin', 'manager'])
                    ->orderBy('name')
                    ->get(['id', 'name', 'email']),
            ],
        ];
    }

    public function upsertProfile(User $employee, array $data): EmployeeProfile
    {
        $profile = EmployeeProfile::query()->firstOrNew([
            'organization_id' => $employee->organization_id,
            'user_id' => $employee->id,
        ]);
        $profile->fill($data);
        $profile->organization_id = $employee->organization_id;
        $profile->user_id = $employee->id;
        $profile->save();

        return $profile;
    }

    public function upsertWorkInfo(User $employee, array $data): EmployeeWorkInfo
    {
        if (!empty($data['report_group_id'])) {
            $resolvedManagerId = $this->resolveGroupManagerId((int) $employee->organization_id, (int) $data['report_group_id']);
            $data['reporting_manager_id'] = $resolvedManagerId;
        }

        $workInfo = EmployeeWorkInfo::query()->firstOrNew([
            'organization_id' => $employee->organization_id,
            'user_id' => $employee->id,
        ]);
        $workInfo->fill($data);
        $workInfo->organization_id = $employee->organization_id;
        $workInfo->user_id = $employee->id;
        $workInfo->save();

        return $workInfo->fresh(['department', 'reportingManager']);
    }

    private function resolveGroupManagerId(int $organizationId, int $groupId): ?int
    {
        $groupExists = Group::query()
            ->where('organization_id', $organizationId)
            ->whereKey($groupId)
            ->exists();

        if (!$groupExists) {
            return null;
        }

        return User::query()
            ->where('organization_id', $organizationId)
            ->where('role', 'manager')
            ->whereHas('groups', fn ($query) => $query->where('groups.id', $groupId))
            ->orderBy('name')
            ->value('id');
    }

    public function storeDocument(User $employee, User $actor, array $data, UploadedFile $file): EmployeeDocument
    {
        $disk = self::EMPLOYEE_DOCUMENTS_DISK;
        $path = $file->store("employee-documents/{$employee->organization_id}/{$employee->id}", $disk);

        return EmployeeDocument::query()->create([
            'organization_id' => $employee->organization_id,
            'user_id' => $employee->id,
            'title' => (string) ($data['title'] ?? $file->getClientOriginalName()),
            'category' => (string) ($data['category'] ?? 'other'),
            'file_path' => $path,
            'file_name' => $file->getClientOriginalName(),
            'file_disk' => $disk,
            'mime_type' => $file->getClientMimeType(),
            'file_size' => $file->getSize(),
            'uploaded_by' => $actor->id,
            'uploaded_at' => now(),
            'review_status' => (string) ($data['review_status'] ?? 'pending'),
            'notes' => $data['notes'] ?? null,
            'meta' => $data['meta'] ?? null,
        ])->fresh('uploader');
    }

    public function upsertGovernmentId(User $employee, array $data): EmployeeGovernmentId
    {
        $record = EmployeeGovernmentId::query()
            ->when(!empty($data['id']), fn ($query) => $query->where('id', (int) $data['id']))
            ->where('organization_id', $employee->organization_id)
            ->where('user_id', $employee->id)
            ->first() ?: new EmployeeGovernmentId([
                'organization_id' => $employee->organization_id,
                'user_id' => $employee->id,
            ]);

        unset($data['id']);
        $record->fill($data);
        $record->organization_id = $employee->organization_id;
        $record->user_id = $employee->id;
        if (!empty($data['status']) && in_array($data['status'], ['verified', 'rejected'], true)) {
            $record->reviewed_at = now();
        }
        $record->save();

        return $record->fresh(['document', 'reviewer']);
    }

    public function upsertBankAccount(User $employee, array $data): EmployeeBankAccount
    {
        $record = EmployeeBankAccount::query()
            ->when(!empty($data['id']), fn ($query) => $query->where('id', (int) $data['id']))
            ->where('organization_id', $employee->organization_id)
            ->where('user_id', $employee->id)
            ->first() ?: new EmployeeBankAccount([
                'organization_id' => $employee->organization_id,
                'user_id' => $employee->id,
            ]);

        unset($data['id']);
        if (($data['is_default'] ?? false) === true) {
            EmployeeBankAccount::query()
                ->where('organization_id', $employee->organization_id)
                ->where('user_id', $employee->id)
                ->update(['is_default' => false]);
        }

        $record->fill($data);
        $record->organization_id = $employee->organization_id;
        $record->user_id = $employee->id;
        $record->save();

        return $record->fresh('document');
    }

    public function recordActivity(User $employee, ?User $actor, string $action, string $description, ?array $meta = null): EmployeeActivityLog
    {
        return EmployeeActivityLog::query()->create([
            'organization_id' => $employee->organization_id,
            'user_id' => $employee->id,
            'actor_user_id' => $actor?->id,
            'action' => $action,
            'description' => $description,
            'meta' => $meta,
        ]);
    }

    public function documentResponse(EmployeeDocument $document)
    {
        $disk = $this->resolveDocumentDisk($document);
        abort_unless(Storage::disk($disk)->exists($document->file_path), 404);

        return response()->download(
            Storage::disk($disk)->path($document->file_path),
            $document->file_name,
            ['Content-Type' => $document->mime_type ?: 'application/octet-stream']
        );
    }

    private function resolveDocumentDisk(EmployeeDocument $document): string
    {
        $configuredDisk = trim((string) $document->file_disk);

        if ($configuredDisk !== '' && Storage::disk($configuredDisk)->exists($document->file_path)) {
            return $configuredDisk;
        }

        if ($configuredDisk === '' || $configuredDisk === 'public') {
            if (Storage::disk(self::EMPLOYEE_DOCUMENTS_DISK)->exists($document->file_path)) {
                return self::EMPLOYEE_DOCUMENTS_DISK;
            }
        }

        return $configuredDisk !== '' ? $configuredDisk : self::EMPLOYEE_DOCUMENTS_DISK;
    }

    private function attendanceSummary(User $employee, string $payrollMonth): array
    {
        $start = Carbon::parse(sprintf('%s-01', $payrollMonth))->startOfMonth();
        $end = $start->copy()->endOfMonth();
        $records = \App\Models\AttendanceRecord::query()
            ->where('organization_id', $employee->organization_id)
            ->where('user_id', $employee->id)
            ->whereDate('attendance_date', '>=', $start->toDateString())
            ->whereDate('attendance_date', '<=', $end->toDateString())
            ->get();
        $approvedLeaveDays = LeaveRequest::query()
            ->where('organization_id', $employee->organization_id)
            ->where('user_id', $employee->id)
            ->where('status', 'approved')
            ->whereDate('start_date', '<=', $end->toDateString())
            ->whereDate('end_date', '>=', $start->toDateString())
            ->count();
        $workedSeconds = (int) $records->sum('worked_seconds');

        $base = [
            'period_start' => $start->toDateString(),
            'period_end' => $end->toDateString(),
            'present_days' => $records->filter(fn ($record) => !empty($record->check_in_at))->count(),
            'approved_leave_days' => $approvedLeaveDays,
            'paid_leave_days' => $approvedLeaveDays,
            'worked_seconds' => $workedSeconds,
            'approved_worked_hours' => round($workedSeconds / 3600, 2),
            'payable_days' => $records->filter(fn ($record) => !empty($record->check_in_at))->count() + $approvedLeaveDays,
        ];

        $lateDays = \App\Models\AttendanceRecord::query()
            ->where('organization_id', $employee->organization_id)
            ->where('user_id', $employee->id)
            ->whereDate('attendance_date', '>=', $start->toDateString())
            ->whereDate('attendance_date', '<=', $end->toDateString())
            ->where('late_minutes', '>', 0)
            ->count();

        $exceptions = \App\Models\AttendanceTimeEditRequest::query()
            ->where('organization_id', $employee->organization_id)
            ->where('user_id', $employee->id)
            ->whereDate('attendance_date', '>=', $start->toDateString())
            ->whereDate('attendance_date', '<=', $end->toDateString())
            ->where('status', 'pending')
            ->count();

        $daysInMonth = (int) $start->copy()->endOfMonth()->day;

        return $base + [
            'absent_days' => max(0, $daysInMonth - ((int) $base['present_days'] + (int) $base['approved_leave_days'])),
            'late_days' => $lateDays,
            'exceptions' => $exceptions,
        ];
    }

    private function leaveSummary(User $employee, string $payrollMonth): array
    {
        $monthStart = Carbon::parse(sprintf('%s-01', $payrollMonth))->startOfMonth();
        $monthEnd = $monthStart->copy()->endOfMonth();

        $items = LeaveRequest::query()
            ->where('organization_id', $employee->organization_id)
            ->where('user_id', $employee->id)
            ->whereDate('start_date', '<=', $monthEnd->toDateString())
            ->whereDate('end_date', '>=', $monthStart->toDateString())
            ->latest('start_date')
            ->get();

        return [
            'balance_available' => false,
            'balance_note' => 'Leave balance source is not modeled in the current backend yet.',
            'approved_count' => $items->where('status', 'approved')->count(),
            'pending_count' => $items->where('status', 'pending')->count(),
            'rejected_count' => $items->where('status', 'rejected')->count(),
            'unpaid_count' => null,
            'payroll_impact_days' => $items->where('status', 'approved')->count(),
            'recent_requests' => $items->take(8)->values(),
        ];
    }

    private function readiness(User $employee, string $payrollMonth, array $attendance, array $leave, Collection $documents, Collection $governmentIds, Collection $bankAccounts): array
    {
        $profile = $employee->employeeProfile;
        $workInfo = $employee->employeeWorkInfo;
        $payrollProfile = $employee->payrollProfile;
        $payrollWarnings = $this->simplePayrollWarnings($employee, $payrollProfile);
        $defaultBank = $bankAccounts->first(fn (EmployeeBankAccount $account) => $account->is_default) ?: $bankAccounts->first();

        $sections = [
            'personal_info' => (bool) ($profile?->first_name && $profile?->phone && $profile?->personal_email),
            'work_info' => (bool) ($workInfo?->employee_code && $workInfo?->designation && $workInfo?->joining_date),
            'payroll_info' => (bool) ($payrollProfile && $payrollProfile->payroll_eligible && !empty($payrollProfile->payout_method)),
            'bank_info' => (bool) ($defaultBank?->account_number && $defaultBank?->ifsc_swift),
            'government_ids' => $governmentIds->isNotEmpty(),
            'documents' => $documents->isNotEmpty(),
        ];

        $completed = collect($sections)->filter()->count();
        $total = count($sections);

        return [
            'overall_percentage' => (int) round(($completed / max(1, $total)) * 100),
            'sections' => $sections,
            'missing_sections' => collect($sections)->filter(fn (bool $value) => !$value)->keys()->values()->all(),
            'payroll_readiness' => [
                'is_ready' => count($payrollWarnings) === 0,
                'warnings' => $payrollWarnings,
            ],
            'payout_readiness' => [
                'is_ready' => (bool) ($defaultBank?->account_number && $defaultBank?->ifsc_swift),
                'warnings' => array_values(array_filter([
                    $defaultBank ? null : 'Missing default bank account',
                    $defaultBank && empty($defaultBank->account_number) ? 'Missing account number' : null,
                    $defaultBank && empty($defaultBank->ifsc_swift) ? 'Missing IFSC or SWIFT code' : null,
                    $defaultBank && empty($defaultBank->payout_method) ? 'Missing payout method' : null,
                ])),
            ],
            'declaration_status' => $payrollProfile?->declaration_status ?: 'not_started',
            'compliance_status' => $payrollProfile?->compliance_readiness_status ?: 'pending',
            'attendance' => $attendance,
            'leave' => $leave,
        ];
    }

    private function simpleCompensationSnapshot(?PayrollProfile $profile): array
    {
        $meta = $profile?->meta ?: [];

        return [
            'source' => $profile ? 'simple_payroll_profile' : 'missing',
            'salary_type' => data_get($meta, 'salary_type', 'fixed_monthly'),
            'monthly_salary' => (float) data_get($meta, 'monthly_salary', 0),
            'hourly_rate' => (float) data_get($meta, 'hourly_rate', 0),
            'working_days' => (float) data_get($meta, 'working_days', 30),
            'overtime_enabled' => (bool) data_get($meta, 'overtime_enabled', true),
            'overtime_hourly_rate' => (float) data_get($meta, 'overtime_hourly_rate', 0),
            'productivity_bonus_enabled' => (bool) data_get($meta, 'productivity_bonus_enabled', false),
            'productivity_bonus_rate' => (float) data_get($meta, 'productivity_bonus_rate', 0),
        ];
    }

    private function simplePayrollWarnings(User $employee, ?PayrollProfile $profile): array
    {
        $warnings = [];
        $meta = $profile?->meta ?: [];
        $salaryType = data_get($meta, 'salary_type', 'fixed_monthly');

        if (!$profile) {
            $warnings[] = 'Salary profile missing';
        }
        if ($profile && (!$profile->is_active || !$profile->payroll_eligible)) {
            $warnings[] = 'Salary profile on hold';
        }
        if (in_array($salaryType, ['fixed_monthly', 'hybrid'], true) && (float) data_get($meta, 'monthly_salary', 0) <= 0) {
            $warnings[] = 'Monthly salary missing';
        }
        if ($salaryType === 'hourly' && (float) data_get($meta, 'hourly_rate', 0) <= 0) {
            $warnings[] = 'Hourly rate missing';
        }
        if (!$employee->organization_id) {
            $warnings[] = 'Employee organization missing';
        }

        return array_values(array_unique($warnings));
    }

    private function activityFeed(User $employee): array
    {
        $custom = EmployeeActivityLog::query()
            ->with('actor:id,name,email')
            ->where('organization_id', $employee->organization_id)
            ->where('user_id', $employee->id)
            ->get()
            ->map(fn (EmployeeActivityLog $item) => [
                'id' => "employee-log-{$item->id}",
                'source' => 'employee',
                'action' => $item->action,
                'description' => $item->description,
                'created_at' => optional($item->created_at)->toIso8601String(),
                'actor' => $item->actor?->only(['id', 'name', 'email']),
                'meta' => $item->meta,
            ]);

        $audit = AuditLog::query()
            ->with('actor:id,name,email')
            ->where('organization_id', $employee->organization_id)
            ->where(function ($query) use ($employee) {
                $query->where(function ($inner) use ($employee) {
                    $inner->where('target_type', 'User')->where('target_id', $employee->id);
                })->orWhere(function ($inner) use ($employee) {
                    $inner->where('target_type', User::class)->where('target_id', $employee->id);
                });
            })
            ->get()
            ->map(fn (AuditLog $item) => [
                'id' => "audit-log-{$item->id}",
                'source' => 'audit',
                'action' => $item->action,
                'description' => (string) $item->action,
                'created_at' => optional($item->created_at)->toIso8601String(),
                'actor' => $item->actor?->only(['id', 'name', 'email']),
                'meta' => $item->metadata,
            ]);

        $payroll = PayrollAuditLog::query()
            ->with('user:id,name,email')
            ->where('organization_id', $employee->organization_id)
            ->where(function ($query) use ($employee) {
                $query
                    ->where('target_type', 'PayrollProfile')
                    ->whereIn('target_id', PayrollProfile::query()
                        ->where('organization_id', $employee->organization_id)
                        ->where('user_id', $employee->id)
                        ->pluck('id'))
                    ->orWhereJsonContains('payload->user_id', $employee->id);
            })
            ->get()
            ->map(fn (PayrollAuditLog $item) => [
                'id' => "payroll-log-{$item->id}",
                'source' => 'payroll',
                'action' => $item->action,
                'description' => (string) $item->action,
                'created_at' => optional($item->created_at)->toIso8601String(),
                'actor' => $item->user?->only(['id', 'name', 'email']),
                'meta' => $item->payload,
            ]);

        return $custom
            ->concat($audit)
            ->concat($payroll)
            ->sortByDesc('created_at')
            ->take(20)
            ->values()
            ->all();
    }
}

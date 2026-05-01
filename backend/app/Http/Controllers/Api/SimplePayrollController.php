<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Activity;
use App\Models\AttendanceRecord;
use App\Models\LeaveRequest;
use App\Models\PayRun;
use App\Models\PayRunItem;
use App\Models\Payroll;
use App\Models\PayrollAdjustment;
use App\Models\PayrollProfile;
use App\Models\PayrollSetting;
use App\Models\Payslip;
use App\Models\TimeEntry;
use App\Models\User;
use App\Services\Payroll\PayrollCalculatorService;
use Carbon\Carbon;
use Dompdf\Dompdf;
use Dompdf\Options;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\View;

class SimplePayrollController extends Controller
{
    public function __construct(private readonly PayrollCalculatorService $calculator)
    {
    }

    public function overview(Request $request)
    {
        $actor = $this->actor($request);
        if (!$this->canManage($actor)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $month = $this->month($request->get('month'));
        $run = PayRun::query()
            ->where('organization_id', $actor->organization_id)
            ->where('payroll_month', $month)
            ->withCount('items')
            ->latest('id')
            ->first();

        $recentRuns = PayRun::query()
            ->where('organization_id', $actor->organization_id)
            ->withCount('items')
            ->latest('payroll_month')
            ->latest('id')
            ->limit(6)
            ->get()
            ->map(fn (PayRun $row) => $this->runRow($row))
            ->values();

        return response()->json([
            'month' => $month,
            'current_run' => $run ? $this->runRow($run) : null,
            'summary' => $this->summaryForRun($run),
            'recent_runs' => $recentRuns,
            'pending_exceptions' => $run ? $run->items()->where('status', 'exception')->count() : 0,
        ]);
    }

    public function salaryProfiles(Request $request)
    {
        $actor = $this->actor($request);
        if (!$this->canManage($actor)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $profiles = PayrollProfile::query()
            ->where('organization_id', $actor->organization_id)
            ->with('user:id,name,email,role')
            ->get()
            ->keyBy('user_id');

        $employees = User::query()
            ->where('organization_id', $actor->organization_id)
            ->where('role', 'employee')
            ->orderBy('name')
            ->get(['id', 'name', 'email', 'role'])
            ->map(fn (User $employee) => $this->profileRow($employee, $profiles->get($employee->id)))
            ->values();

        return response()->json(['data' => $employees]);
    }

    public function saveSalaryProfile(Request $request, int $userId)
    {
        $actor = $this->actor($request);
        if (!$this->canManage($actor)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $employee = User::query()
            ->where('organization_id', $actor->organization_id)
            ->where('role', 'employee')
            ->findOrFail($userId);

        $data = $request->validate([
            'salary_type' => 'required|in:fixed_monthly,hourly,hybrid',
            'monthly_salary' => 'nullable|numeric|min:0',
            'hourly_rate' => 'nullable|numeric|min:0',
            'working_days' => 'required|numeric|min:1|max:31',
            'payroll_start_date' => 'nullable|date',
            'status' => 'required|in:active,on_hold',
            'overtime_enabled' => 'nullable|boolean',
            'overtime_hourly_rate' => 'nullable|numeric|min:0',
            'productivity_bonus_enabled' => 'nullable|boolean',
            'productivity_bonus_rate' => 'nullable|numeric|min:0',
            'bank_name' => 'nullable|string|max:255',
            'bank_account_number' => 'nullable|string|max:255',
            'bank_ifsc_swift' => 'nullable|string|max:255',
            'notes' => 'nullable|string|max:1000',
        ]);

        $profile = PayrollProfile::query()->updateOrCreate(
            ['organization_id' => $actor->organization_id, 'user_id' => $employee->id],
            [
                'currency' => $this->payrollSettings($actor->organization_id)->default_payout_method['currency'] ?? 'INR',
                'payout_method' => 'mock',
                'bank_name' => $data['bank_name'] ?? null,
                'bank_account_number' => $data['bank_account_number'] ?? null,
                'bank_ifsc_swift' => $data['bank_ifsc_swift'] ?? null,
                'payroll_start_date' => $data['payroll_start_date'] ?? now()->toDateString(),
                'payroll_eligible' => $data['status'] === 'active',
                'reimbursements_eligible' => true,
                'is_active' => $data['status'] === 'active',
                'meta' => [
                    'salary_type' => $data['salary_type'],
                    'monthly_salary' => (float) ($data['monthly_salary'] ?? 0),
                    'hourly_rate' => (float) ($data['hourly_rate'] ?? 0),
                    'working_days' => (float) $data['working_days'],
                    'overtime_enabled' => (bool) ($data['overtime_enabled'] ?? false),
                    'overtime_hourly_rate' => (float) ($data['overtime_hourly_rate'] ?? 0),
                    'productivity_bonus_enabled' => (bool) ($data['productivity_bonus_enabled'] ?? false),
                    'productivity_bonus_rate' => (float) ($data['productivity_bonus_rate'] ?? 0),
                    'notes' => $data['notes'] ?? null,
                ],
            ]
        );

        return response()->json($this->profileRow($employee, $profile->fresh()), 201);
    }

    public function runs(Request $request)
    {
        $actor = $this->actor($request);
        if (!$this->canManage($actor)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $month = $this->month($request->get('month'));
        $runs = PayRun::query()
            ->where('organization_id', $actor->organization_id)
            ->when($request->filled('month'), fn ($query) => $query->where('payroll_month', $month))
            ->withCount('items')
            ->latest('payroll_month')
            ->latest('id')
            ->get()
            ->map(fn (PayRun $run) => $this->runRow($run))
            ->values();

        return response()->json(['data' => $runs]);
    }

    public function showRun(Request $request, int $id)
    {
        $actor = $this->actor($request);
        if (!$this->canManage($actor)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $run = PayRun::query()
            ->where('organization_id', $actor->organization_id)
            ->with(['items.user:id,name,email', 'items.payroll'])
            ->findOrFail($id);

        return response()->json([
            'run' => $this->runRow($run),
            'items' => $run->items->map(fn (PayRunItem $item) => $this->itemRow($item))->values(),
        ]);
    }

    public function generateRun(Request $request)
    {
        $actor = $this->actor($request);
        if (!$this->canManage($actor)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $data = $request->validate(['month' => ['required', 'regex:/^\d{4}\-\d{2}$/']]);
        $month = $data['month'];
        $settings = $this->payrollSettings((int) $actor->organization_id);

        $run = DB::transaction(function () use ($actor, $month, $settings) {
            $run = PayRun::query()
                ->where('organization_id', $actor->organization_id)
                ->where('run_code', 'PAY-'.$month)
                ->first();

            if ($run && in_array($run->status, ['approved', 'paid'], true)) {
                abort(422, 'Approved or paid payroll cannot be regenerated.');
            }

            $run = PayRun::query()->updateOrCreate(
                ['organization_id' => $actor->organization_id, 'run_code' => 'PAY-'.$month],
                [
                    'payroll_month' => $month,
                    'status' => 'draft',
                    'currency' => data_get($settings->default_payout_method, 'currency', 'INR'),
                    'generated_by' => $actor->id,
                    'generated_at' => now(),
                ]
            );

            $employees = User::query()
                ->where('organization_id', $actor->organization_id)
                ->where('role', 'employee')
                ->orderBy('name')
                ->get();

            foreach ($employees as $employee) {
                $profile = PayrollProfile::query()
                    ->where('organization_id', $actor->organization_id)
                    ->where('user_id', $employee->id)
                    ->first();
                $attendance = $this->attendance((int) $actor->organization_id, (int) $employee->id, $month);
                $calculation = $this->calculateEmployee($profile, $attendance, $month, (int) $employee->id, (int) $actor->organization_id);
                $warnings = $this->warnings($profile, $attendance, $calculation);
                $payrollStatus = count($warnings) > 0 ? 'draft' : 'review';

                $payroll = Payroll::query()->updateOrCreate(
                    ['organization_id' => $actor->organization_id, 'user_id' => $employee->id, 'payroll_month' => $month],
                    [
                        'basic_salary' => $calculation['base_pay'],
                        'allowances' => round($calculation['overtime'] + $calculation['reimbursement'], 2),
                        'deductions' => $calculation['deductions'],
                        'bonus' => round($calculation['bonus'] + $calculation['productivity_bonus'], 2),
                        'tax' => 0,
                        'gross_salary' => $calculation['gross_pay'],
                        'net_salary' => $calculation['net_pay'],
                        'payroll_status' => $payrollStatus,
                        'payout_method' => 'mock',
                        'payout_status' => 'pending',
                        'attendance_summary' => $attendance,
                        'salary_breakdown' => $calculation,
                        'adjustment_breakdown' => $calculation['adjustments'],
                        'warnings' => $warnings,
                        'generated_by' => $actor->id,
                        'updated_by' => $actor->id,
                    ]
                );

                PayRunItem::query()->updateOrCreate(
                    ['pay_run_id' => $run->id, 'user_id' => $employee->id],
                    [
                        'organization_id' => $actor->organization_id,
                        'payroll_id' => $payroll->id,
                        'payroll_profile_id' => $profile?->id,
                        'payable_days' => $attendance['present_days'] + $attendance['paid_leave_days'],
                        'worked_seconds' => (int) round($attendance['approved_worked_hours'] * 3600),
                        'overtime_seconds' => (int) round($attendance['overtime_hours'] * 3600),
                        'approved_leave_days' => (int) floor((float) $attendance['paid_leave_days']),
                        'approved_time_edit_seconds' => 0,
                        'gross_pay' => $calculation['gross_pay'],
                        'total_deductions' => $calculation['deductions'],
                        'net_pay' => $calculation['net_pay'],
                        'status' => count($warnings) > 0 ? 'exception' : 'ready',
                        'payout_status' => 'pending',
                        'salary_breakdown' => $calculation,
                        'adjustment_breakdown' => $calculation['adjustments'],
                        'attendance_summary' => $attendance,
                        'warnings' => $warnings,
                    ]
                );
            }

            return $this->refreshRunSummary($run);
        });

        return response()->json(['message' => 'Draft payroll generated.', 'run' => $this->runRow($run)]);
    }

    public function approveRun(Request $request, int $id)
    {
        $actor = $this->actor($request);
        if (!$this->canManage($actor)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $run = PayRun::query()->where('organization_id', $actor->organization_id)->findOrFail($id);
        if ($run->items()->where('status', 'exception')->exists()) {
            return response()->json(['message' => 'Resolve exceptions before approval.'], 422);
        }

        DB::transaction(function () use ($run, $actor) {
            $run->update(['status' => 'approved', 'approved_by' => $actor->id, 'approved_at' => now()]);
            $run->items()->update(['status' => 'approved']);
            Payroll::query()
                ->where('organization_id', $run->organization_id)
                ->where('payroll_month', $run->payroll_month)
                ->update(['payroll_status' => 'approved', 'updated_by' => $actor->id]);
        });

        return response()->json(['message' => 'Payroll approved.', 'run' => $this->runRow($this->refreshRunSummary($run))]);
    }

    public function markPaid(Request $request, int $id)
    {
        $actor = $this->actor($request);
        if (!$this->canManage($actor)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $run = PayRun::query()->where('organization_id', $actor->organization_id)->with('items.payroll')->findOrFail($id);
        if (!in_array($run->status, ['approved', 'paid'], true)) {
            return response()->json(['message' => 'Approve payroll before marking it paid.'], 422);
        }

        DB::transaction(function () use ($run, $actor) {
            $run->update(['status' => 'paid', 'paid_by' => $actor->id, 'paid_at' => now()]);
            foreach ($run->items as $item) {
                $item->update(['status' => 'paid', 'payout_status' => 'success']);
                $item->payroll?->update([
                    'payroll_status' => 'paid',
                    'payout_status' => 'success',
                    'paid_at' => now(),
                    'payment_reference' => 'PAY-'.$run->payroll_month.'-'.$item->user_id,
                ]);
                $this->createPayslip($item, $actor->id);
            }
        });

        return response()->json(['message' => 'Payroll marked paid and payslips generated.', 'run' => $this->runRow($this->refreshRunSummary($run))]);
    }

    public function adjustments(Request $request)
    {
        $actor = $this->actor($request);
        if (!$this->canManage($actor)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $month = $this->month($request->get('month'));
        $employees = User::query()->where('organization_id', $actor->organization_id)->where('role', 'employee')->orderBy('name')->get(['id', 'name', 'email']);
        $adjustments = PayrollAdjustment::query()
            ->where('organization_id', $actor->organization_id)
            ->where('effective_month', $month)
            ->with(['user:id,name,email', 'createdBy:id,name,email'])
            ->latest()
            ->get();

        return response()->json(['employees' => $employees, 'data' => $adjustments]);
    }

    public function saveAdjustment(Request $request)
    {
        $actor = $this->actor($request);
        if (!$this->canManage($actor)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $data = $request->validate([
            'user_id' => 'required|integer',
            'month' => ['required', 'regex:/^\d{4}\-\d{2}$/'],
            'type' => 'required|in:bonus,reimbursement,overtime,manual_deduction,lop_correction',
            'amount' => 'required|numeric|min:0',
            'reason' => 'required|string|max:500',
        ]);

        $employee = User::query()->where('organization_id', $actor->organization_id)->where('role', 'employee')->findOrFail((int) $data['user_id']);
        $kind = $data['type'] === 'lop_correction' ? 'manual_deduction' : $data['type'];

        $adjustment = PayrollAdjustment::query()->create([
            'organization_id' => $actor->organization_id,
            'user_id' => $employee->id,
            'title' => ucfirst(str_replace('_', ' ', $data['type'])),
            'description' => $data['reason'],
            'kind' => $kind,
            'source' => 'simple_payroll',
            'effective_month' => $data['month'],
            'amount' => $data['amount'],
            'currency' => data_get($this->payrollSettings((int) $actor->organization_id)->default_payout_method, 'currency', 'INR'),
            'status' => 'approved',
            'created_by' => $actor->id,
            'approved_by' => $actor->id,
            'approved_at' => now(),
            'meta' => ['simple_type' => $data['type']],
        ]);

        return response()->json($adjustment->load(['user:id,name,email', 'createdBy:id,name,email']), 201);
    }

    public function payslips(Request $request)
    {
        $actor = $this->actor($request);
        $query = Payslip::query()
            ->where('organization_id', $actor->organization_id)
            ->with('user:id,name,email')
            ->latest('period_month')
            ->latest('id');

        if (!$this->canManage($actor)) {
            $query->where('user_id', $actor->id)->where('publish_status', 'published');
        } elseif ($request->filled('month')) {
            $query->where('period_month', $request->get('month'));
        }

        return response()->json(['data' => $query->get()]);
    }

    public function showPayslip(Request $request, int $id)
    {
        $actor = $this->actor($request);
        $query = Payslip::query()->where('organization_id', $actor->organization_id)->where('id', $id);
        if (!$this->canManage($actor)) {
            $query->where('user_id', $actor->id)->where('publish_status', 'published');
        }

        return response()->json($query->with('user:id,name,email')->firstOrFail());
    }

    public function downloadPayslipPdf(Request $request, int $id)
    {
        $actor = $this->actor($request);
        $query = Payslip::query()->where('organization_id', $actor->organization_id)->where('id', $id);
        if (!$this->canManage($actor)) {
            $query->where('user_id', $actor->id)->where('publish_status', 'published');
        }
        $payslip = $query->with(['user', 'payroll'])->firstOrFail();

        $html = View::make('payslips.pdf', ['payslip' => $payslip])->render();
        $options = new Options();
        $options->set('isRemoteEnabled', true);
        $dompdf = new Dompdf($options);
        $dompdf->loadHtml($html);
        $dompdf->setPaper('A4');
        $dompdf->render();

        return response($dompdf->output(), 200, [
            'Content-Type' => 'application/pdf',
            'Content-Disposition' => 'attachment; filename="payslip-'.$payslip->period_month.'.pdf"',
        ]);
    }

    public function settings(Request $request)
    {
        $actor = $this->actor($request);
        if (!$this->canManage($actor)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        return response()->json($this->payrollSettings((int) $actor->organization_id));
    }

    public function saveSettings(Request $request)
    {
        $actor = $this->actor($request);
        if (!$this->canManage($actor)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $data = $request->validate([
            'working_days' => 'required|numeric|min:1|max:31',
            'payroll_cycle_day' => 'required|integer|min:1|max:31',
            'currency' => 'required|string|max:8',
            'enable_overtime' => 'nullable|boolean',
            'enable_productivity_bonus' => 'nullable|boolean',
            'company_name' => 'nullable|string|max:255',
        ]);

        $setting = $this->payrollSettings((int) $actor->organization_id);
        $setting->fill([
            'payroll_calendar' => ['working_days' => (float) $data['working_days'], 'payment_day' => (int) $data['payroll_cycle_day']],
            'default_payout_method' => ['method' => 'mock', 'currency' => strtoupper($data['currency'])],
            'overtime_rules' => ['enabled' => (bool) ($data['enable_overtime'] ?? false)],
            'adjustment_rules' => [
                'productivity_bonus_enabled' => (bool) ($data['enable_productivity_bonus'] ?? false),
            ],
            'payslip_branding' => ['company_name' => $data['company_name'] ?: 'CareVance'],
        ])->save();

        return response()->json($setting->fresh());
    }

    private function actor(Request $request): ?User
    {
        return $request->user();
    }

    private function canManage(?User $user): bool
    {
        return $user && in_array($user->role, ['admin', 'manager', 'owner', 'hr', 'super_admin'], true);
    }

    private function month(mixed $value): string
    {
        return is_string($value) && preg_match('/^\d{4}\-\d{2}$/', $value) ? $value : now()->format('Y-m');
    }

    private function payrollSettings(int $organizationId): PayrollSetting
    {
        return PayrollSetting::query()->firstOrCreate(
            ['organization_id' => $organizationId],
            [
                'payroll_calendar' => ['working_days' => 30, 'payment_day' => 1],
                'default_payout_method' => ['method' => 'mock', 'currency' => 'INR'],
                'overtime_rules' => ['enabled' => true],
                'adjustment_rules' => ['productivity_bonus_enabled' => false],
                'payslip_branding' => ['company_name' => 'CareVance'],
            ]
        );
    }

    private function profileRow(User $employee, ?PayrollProfile $profile): array
    {
        $meta = $profile?->meta ?: [];

        return [
            'user' => $employee->only(['id', 'name', 'email', 'role']),
            'profile_id' => $profile?->id,
            'salary_type' => data_get($meta, 'salary_type', 'fixed_monthly'),
            'monthly_salary' => (float) data_get($meta, 'monthly_salary', 0),
            'hourly_rate' => (float) data_get($meta, 'hourly_rate', 0),
            'working_days' => (float) data_get($meta, 'working_days', 30),
            'payroll_start_date' => optional($profile?->payroll_start_date)->toDateString(),
            'status' => $profile && $profile->is_active && $profile->payroll_eligible ? 'active' : 'on_hold',
            'overtime_enabled' => (bool) data_get($meta, 'overtime_enabled', true),
            'overtime_hourly_rate' => (float) data_get($meta, 'overtime_hourly_rate', 0),
            'productivity_bonus_enabled' => (bool) data_get($meta, 'productivity_bonus_enabled', false),
            'productivity_bonus_rate' => (float) data_get($meta, 'productivity_bonus_rate', 0),
            'bank_name' => $profile?->bank_name,
            'bank_account_number' => $profile?->bank_account_number,
            'bank_ifsc_swift' => $profile?->bank_ifsc_swift,
            'notes' => data_get($meta, 'notes'),
        ];
    }

    private function attendance(int $organizationId, int $userId, string $month): array
    {
        $start = Carbon::createFromFormat('Y-m', $month)->startOfMonth();
        $end = $start->copy()->endOfMonth();
        $records = AttendanceRecord::query()
            ->where('organization_id', $organizationId)
            ->where('user_id', $userId)
            ->whereBetween('attendance_date', [$start->toDateString(), $end->toDateString()])
            ->get();
        $workedSeconds = (int) $records->sum('worked_seconds');
        if ($workedSeconds <= 0) {
            $workedSeconds = (int) TimeEntry::query()
                ->where('user_id', $userId)
                ->whereBetween('start_time', [$start->toDateTimeString(), $end->copy()->endOfDay()->toDateTimeString()])
                ->sum('duration');
        }
        $paidLeaveDays = (float) LeaveRequest::query()
            ->where('organization_id', $organizationId)
            ->where('user_id', $userId)
            ->where('status', 'approved')
            ->whereDate('start_date', '<=', $end->toDateString())
            ->whereDate('end_date', '>=', $start->toDateString())
            ->get()
            ->sum(fn (LeaveRequest $leave) => method_exists($leave, 'effectiveUnitsInRange') ? $leave->effectiveUnitsInRange($start, $end) : 1);

        $shiftSeconds = max(1, (int) env('ATTENDANCE_SHIFT_SECONDS', 8 * 3600));

        return [
            'period_start' => $start->toDateString(),
            'period_end' => $end->toDateString(),
            'present_days' => $records->filter(fn (AttendanceRecord $record) => !empty($record->check_in_at))->count(),
            'paid_leave_days' => $paidLeaveDays,
            'approved_worked_hours' => round($workedSeconds / 3600, 2),
            'overtime_hours' => round($records->sum(fn (AttendanceRecord $record) => max(0, (int) $record->worked_seconds - $shiftSeconds)) / 3600, 2),
            'records_count' => $records->count(),
            'pending_leave_requests' => LeaveRequest::query()
                ->where('organization_id', $organizationId)
                ->where('user_id', $userId)
                ->where('status', 'pending')
                ->whereDate('start_date', '<=', $end->toDateString())
                ->whereDate('end_date', '>=', $start->toDateString())
                ->count(),
        ];
    }

    private function calculateEmployee(?PayrollProfile $profile, array $attendance, string $month, int $userId, int $organizationId): array
    {
        $setting = $this->payrollSettings($organizationId);
        $meta = $profile?->meta ?: [];
        $workingDays = max(1, (float) data_get($meta, 'working_days', data_get($setting->payroll_calendar, 'working_days', 30)));
        $adjustments = $this->adjustmentInputs($organizationId, $userId, $month);

        $result = $this->calculator->calculateSimplePayroll([
            'salary_type' => data_get($meta, 'salary_type', 'fixed_monthly'),
            'monthly_salary' => (float) data_get($meta, 'monthly_salary', 0),
            'hourly_rate' => (float) data_get($meta, 'hourly_rate', 0),
            'working_days' => $workingDays,
            'overtime_enabled' => (bool) data_get($meta, 'overtime_enabled', data_get($setting->overtime_rules, 'enabled', true)),
            'overtime_hourly_rate' => (float) data_get($meta, 'overtime_hourly_rate', data_get($meta, 'hourly_rate', 0)),
            'productivity_bonus_enabled' => (bool) data_get($meta, 'productivity_bonus_enabled', data_get($setting->adjustment_rules, 'productivity_bonus_enabled', false)),
            'productivity_bonus_rate' => (float) data_get($meta, 'productivity_bonus_rate', 0),
        ], array_merge($adjustments['inputs'], [
            'approved_worked_hours' => $attendance['approved_worked_hours'],
            'overtime_hours' => $attendance['overtime_hours'],
            'approved_productive_hours' => $this->productiveHours($userId, $month),
            'unpaid_leave_days' => max(0, $workingDays - $attendance['present_days'] - $attendance['paid_leave_days']),
        ]));

        $result['adjustments'] = $adjustments;

        return $result;
    }

    private function adjustmentInputs(int $organizationId, int $userId, string $month): array
    {
        $inputs = ['bonus' => 0.0, 'reimbursement' => 0.0, 'manual_deduction' => 0.0, 'other_deduction' => 0.0];
        $items = PayrollAdjustment::query()
            ->where('organization_id', $organizationId)
            ->where('user_id', $userId)
            ->where('effective_month', $month)
            ->whereIn('status', ['approved', 'applied'])
            ->get()
            ->map(function (PayrollAdjustment $adjustment) use (&$inputs) {
                $type = (string) data_get($adjustment->meta, 'simple_type', $adjustment->kind);
                $amount = (float) $adjustment->amount;
                if ($type === 'bonus' || $type === 'overtime') {
                    $inputs['bonus'] += $amount;
                } elseif ($type === 'reimbursement') {
                    $inputs['reimbursement'] += $amount;
                } elseif ($type === 'manual_deduction') {
                    $inputs['manual_deduction'] += $amount;
                } else {
                    $inputs['other_deduction'] += $amount;
                }

                return ['id' => $adjustment->id, 'type' => $type, 'amount' => $amount, 'reason' => $adjustment->description];
            })
            ->values()
            ->all();

        return ['inputs' => $inputs, 'items' => $items];
    }

    private function productiveHours(int $userId, string $month): float
    {
        $start = Carbon::createFromFormat('Y-m', $month)->startOfMonth();
        $end = $start->copy()->endOfMonth();
        $seconds = (int) Activity::query()
            ->where('user_id', $userId)
            ->where('classification', 'productive')
            ->whereBetween('recorded_at', [$start->toDateTimeString(), $end->copy()->endOfDay()->toDateTimeString()])
            ->sum('duration');

        return round($seconds / 3600, 2);
    }

    private function warnings(?PayrollProfile $profile, array $attendance, array $calculation): array
    {
        $warnings = [];
        if (!$profile) {
            $warnings[] = 'Salary profile missing';
        }
        if ($profile && (!$profile->is_active || !$profile->payroll_eligible)) {
            $warnings[] = 'Salary profile on hold';
        }
        if ($attendance['records_count'] <= 0 && $attendance['approved_worked_hours'] <= 0) {
            $warnings[] = 'No attendance record';
        }
        if ($attendance['pending_leave_requests'] > 0) {
            $warnings[] = 'Pending leave approval';
        }

        return array_values(array_unique(array_merge($warnings, $calculation['warnings'] ?? [])));
    }

    private function refreshRunSummary(PayRun $run): PayRun
    {
        $items = $run->items()->get();
        $run->summary = [
            'employees_count' => $items->count(),
            'gross_payroll' => round($items->sum('gross_pay'), 2),
            'total_deductions' => round($items->sum('total_deductions'), 2),
            'net_payroll' => round($items->sum('net_pay'), 2),
            'exceptions_count' => $items->where('status', 'exception')->count(),
        ];
        $run->warnings = $items->filter(fn (PayRunItem $item) => !empty($item->warnings))->map(fn (PayRunItem $item) => ['user_id' => $item->user_id, 'warnings' => $item->warnings])->values()->all();
        if (!in_array($run->status, ['approved', 'paid', 'cancelled'], true)) {
            $run->status = $items->where('status', 'exception')->count() > 0 ? 'draft' : 'review';
        }
        $run->save();

        return $run->fresh();
    }

    private function summaryForRun(?PayRun $run): array
    {
        $summary = $run?->summary ?: [];

        return [
            'employees' => (int) ($summary['employees_count'] ?? 0),
            'gross_pay' => (float) ($summary['gross_payroll'] ?? 0),
            'deductions' => (float) ($summary['total_deductions'] ?? 0),
            'net_pay' => (float) ($summary['net_payroll'] ?? 0),
            'exceptions' => (int) ($summary['exceptions_count'] ?? 0),
        ];
    }

    private function runRow(?PayRun $run): ?array
    {
        if (!$run) {
            return null;
        }

        $summary = $this->summaryForRun($run);

        return [
            'id' => $run->id,
            'month' => $run->payroll_month,
            'status' => $run->status,
            'employees' => $summary['employees'],
            'gross_pay' => $summary['gross_pay'],
            'deductions' => $summary['deductions'],
            'net_pay' => $summary['net_pay'],
            'exceptions' => $summary['exceptions'],
            'generated_at' => optional($run->generated_at)->toIso8601String(),
        ];
    }

    private function itemRow(PayRunItem $item): array
    {
        return [
            'id' => $item->id,
            'employee' => $item->user?->only(['id', 'name', 'email']),
            'salary_type' => data_get($item->salary_breakdown, 'salary_type', 'fixed_monthly'),
            'present_days' => (float) data_get($item->attendance_summary, 'present_days', 0),
            'paid_leave_days' => (float) data_get($item->attendance_summary, 'paid_leave_days', 0),
            'lop_days' => (float) data_get($item->salary_breakdown, 'lop_deduction', 0) > 0 ? round(((float) data_get($item->salary_breakdown, 'lop_deduction', 0)) / max(1, (float) data_get($item->salary_breakdown, 'per_day_salary', 1)), 2) : 0,
            'approved_worked_hours' => (float) data_get($item->attendance_summary, 'approved_worked_hours', 0),
            'overtime_hours' => (float) data_get($item->attendance_summary, 'overtime_hours', 0),
            'gross_pay' => (float) $item->gross_pay,
            'deductions' => (float) $item->total_deductions,
            'net_pay' => (float) $item->net_pay,
            'status' => $item->status,
            'warnings' => $item->warnings ?: [],
            'breakdown' => $item->salary_breakdown ?: [],
        ];
    }

    private function createPayslip(PayRunItem $item, int $actorId): Payslip
    {
        $payroll = $item->payroll;
        $salaryType = (string) data_get($item->salary_breakdown, 'salary_type', 'fixed_monthly');
        $basicSalary = in_array($salaryType, ['fixed_monthly', 'hybrid'], true)
            ? (float) data_get($item->salary_breakdown, 'monthly_salary', 0)
            : (float) data_get($item->salary_breakdown, 'base_pay', 0);

        return Payslip::query()->updateOrCreate(
            ['organization_id' => $item->organization_id, 'user_id' => $item->user_id, 'period_month' => $item->payRun->payroll_month],
            [
                'payroll_id' => $payroll?->id,
                'pay_run_id' => $item->pay_run_id,
                'currency' => $item->payRun->currency ?: 'INR',
                'basic_salary' => round($basicSalary, 2),
                'total_allowances' => round((float) data_get($item->salary_breakdown, 'overtime', 0) + (float) data_get($item->salary_breakdown, 'bonus', 0) + (float) data_get($item->salary_breakdown, 'reimbursement', 0) + (float) data_get($item->salary_breakdown, 'productivity_bonus', 0), 2),
                'total_deductions' => (float) $item->total_deductions,
                'net_salary' => (float) $item->net_pay,
                'payment_status' => 'paid',
                'publish_status' => 'published',
                'allowances' => [
                    ['name' => 'Overtime', 'computed_amount' => (float) data_get($item->salary_breakdown, 'overtime', 0)],
                    ['name' => 'Bonus', 'computed_amount' => (float) data_get($item->salary_breakdown, 'bonus', 0)],
                    ['name' => 'Reimbursement', 'computed_amount' => (float) data_get($item->salary_breakdown, 'reimbursement', 0)],
                    ['name' => 'Productivity Bonus', 'computed_amount' => (float) data_get($item->salary_breakdown, 'productivity_bonus', 0)],
                ],
                'deductions' => [
                    ['name' => 'LOP Deduction', 'computed_amount' => (float) data_get($item->salary_breakdown, 'lop_deduction', 0)],
                    ['name' => 'Manual Deduction', 'computed_amount' => (float) data_get($item->salary_breakdown, 'manual_deduction', 0)],
                    ['name' => 'Other Deduction', 'computed_amount' => (float) data_get($item->salary_breakdown, 'other_deduction', 0)],
                ],
                'breakdown' => $item->salary_breakdown,
                'generated_by' => $actorId,
                'generated_at' => now(),
                'issued_at' => now(),
                'published_at' => now(),
                'paid_at' => now(),
                'paid_by' => $actorId,
            ]
        );
    }
}

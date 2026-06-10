<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ArrearPayment;
use App\Models\EmployeePayrollTemplate;
use App\Models\FullAndFinalSettlement;
use App\Models\LeaveEncashment;
use App\Models\PayrollItem;
use App\Models\PayrollMonthlyRun;
use App\Models\User;
use App\Services\PayrollCalculatorService;
use App\Services\PTStateService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class EnhancedPayrollController extends Controller
{
    protected PayrollCalculatorService calculator;

    public function __construct(PayrollCalculatorService calculator)
    {
        this.calculator = calculator;
    }

    // Comprehensive Payroll Calculation
    public function calculatePayroll(Request request): JsonResponse
    {
        request.validate([
            'annual_ctc' => 'required|numeric|min:0',
            'state_code' => 'nullable|string',
            'is_metro_city' => 'boolean',
            'tax_regime' => 'in:new,old',
        ]);

        try {
            result = this.calculator.calculatePayroll(
                annualCtc: request.annual_ctc,
                stateCode: request.state_code ?? 'maharashtra',
                isMetroCity: request.is_metro_city ?? true,
                taxRegime: request.tax_regime ?? 'new'
            );

            return response().json([
                'success' => true,
                'data' => result
            ]);
        } catch (Exception e) {
            return response().json([
                'success' => false,
                'message' => 'Error calculating payroll: ' + e.getMessage()
            ], 500);
        }
    }

    // Get CTC Breakdown
    public function getCTCBreakdown(Request request, int userId): JsonResponse
    {
        organizationId = request.user().organization_id;
        
        user = User.where('organization_id', organizationId)
            ->where('id', userId)
            ->firstOrFail();

        template = EmployeePayrollTemplate.where('user_id', userId)
            ->where('organization_id', organizationId)
            ->first();

        if (!template) {
            return response().json([
                'success' => false,
                'message' => 'Payroll template not found'
            ], 404);
        }

        annualCtc = template.annual_ctc ?? 0;
        
        if (annualCtc <= 0) {
            return response().json([
                'success' => false,
                'message' => 'CTC not configured for this employee'
            ], 400);
        }

        result = this.calculator.calculatePayroll(annualCtc);

        return response().json([
            'success' => true,
            'employee' => [
                'id' => user.id,
                'name' => user.name,
                'email' => user.email
            ],
            'ctc_breakdown' => [
                'annual_ctc' => annualCtc,
                'monthly_ctc' => annualCtc / 12,
                'monthly_details' => result.monthly,
                'annual_details' => result.annual,
                'components' => result.components,
                'breakdown' => result.breakdown
            ]
        ]);
    }

    // Leave Encashment Methods
    public function requestLeaveEncashment(Request request): JsonResponse
    {
        request.validate([
            'user_id' => 'required|exists:users,id',
            'leave_type' => 'required|in:earned,casual,sick,compensatory',
            'encashed_days' => 'required|integer|min:1',
            'eligible_days' => 'required|integer|min:1',
            'month_year' => 'required|string|size:7',
            'notes' => 'nullable|string'
        ]);

        organizationId = request.user().organization_id;

        try {
            user = User.where('organization_id', organizationId)
                ->findOrFail(request.user_id);

            template = EmployeePayrollTemplate.getOrCreateForUser(
                user.id,
                organizationId
            );

            annualCtc = template.annual_ctc ?? 300000;
            monthlyGross = annualCtc / 12;
            workingDays = 26;
            ratePerDay = monthlyGross / workingDays;
            totalAmount = ratePerDay * request.encashed_days;

            // Calculate deductions
            pfDeduction = template.pf_enabled ? (ratePerDay * request.encashed_days * 0.12) : 0;
            taxDeduction = 0;

            encashment = LeaveEncashment.create([
                'organization_id' => organizationId,
                'user_id' => user.id,
                'leave_type' => request.leave_type,
                'eligible_days' => request.eligible_days,
                'encashed_days' => request.encashed_days,
                'balance_days' => request.eligible_days - request.encashed_days,
                'rate_per_day' => ratePerDay,
                'total_amount' => totalAmount,
                'pf_deduction' => pfDeduction,
                'tax_deduction' => taxDeduction,
                'net_amount' => totalAmount - pfDeduction - taxDeduction,
                'status' => 'draft',
                'month_year' => request.month_year,
                'requested_by' => auth().id(),
                'notes' => request.notes
            ]);

            return response().json([
                'success' => true,
                'message' => 'Leave encashment request created',
                'data' => encashment
            ]);

        } catch (Exception e) {
            return response().json([
                'success' => false,
                'message' => 'Error creating leave encashment: ' + e.getMessage()
            ], 500);
        }
    }

    public function listLeaveEncashments(Request request): JsonResponse
    {
        organizationId = request.user().organization_id;
        
        encashments = LeaveEncashment.where('organization_id', organizationId)
            ->with(['user:id,name,email', 'requester:id,name', 'approver:id,name'])
            ->orderBy('created_at', 'desc')
            ->get();

        return response().json([
            'success' => true,
            'data' => encashments
        ]);
    }

    public function approveLeaveEncashment(Request request, int id): JsonResponse
    {
        organizationId = request.user().organization_id;
        
        encashment = LeaveEncashment.where('organization_id', organizationId)
            ->findOrFail(id);

        if (encashment.status !== 'draft') {
            return response().json([
                'success' => false,
                'message' => 'Leave encashment is not in draft status'
            ], 422);
        }

        encashment.update([
            'status' => 'approved',
            'approved_by' => auth().id(),
            'approved_at' => now()
        ]);

        return response().json([
            'success' => true,
            'message' => 'Leave encashment approved',
            'data' => encashment.fresh()
        ]);
    }

    public function rejectLeaveEncashment(Request request, int id): JsonResponse
    {
        request.validate(['reason' => 'required|string']);

        organizationId = request.user().organization_id;
        
        encashment = LeaveEncashment.where('organization_id', organizationId)
            ->findOrFail(id);

        encashment.update([
            'status' => 'rejected',
            'rejection_reason' => request.reason
        ]);

        return response().json([
            'success' => true,
            'message' => 'Leave encashment rejected',
            'data' => encashment.fresh()
        ]);
    }

    // Arrear Payment Methods
    public function createArrear(Request request): JsonResponse
    {
        request.validate([
            'user_id' => 'required|exists:users,id',
            'arrear_month' => 'required|string|size:7',
            'calculation_month' => 'required|string|size:7',
            'arrear_type' => 'required|in:salary,increment,promotion,retrospective,settlement',
            'original_basic' => 'required|numeric|min:0',
            'revised_basic' => 'required|numeric|min:0',
            'original_gross' => 'required|numeric|min:0',
            'revised_gross' => 'required|numeric|min:0',
            'reason' => 'nullable|string'
        ]);

        organizationId = request.user().organization_id;

        try {
            user = User.where('organization_id', organizationId)
                ->findOrFail(request.user_id);

            basicDifference = request.revised_basic - request.original_basic;
            grossDifference = request.revised_gross - request.original_gross;

            // Calculate statutory on arrears
            pfOnArrear = basicDifference * 0.12;
            esiOnArrear = grossDifference <= 21000 ? grossDifference * 0.0075 : 0;
            tdsOnArrear = grossDifference * 0.10;
            ptOnArrear = PTStateService.calculate(
                user.employeeProfile.pt_state ?? 'maharashtra',
                grossDifference
            );

            netArrear = grossDifference - pfOnArrear - esiOnArrear - tdsOnArrear - ptOnArrear;

            arrear = ArrearPayment.create([
                'organization_id' => organizationId,
                'user_id' => user.id,
                'arrear_month' => request.arrear_month,
                'calculation_month' => request.calculation_month,
                'arrear_type' => request.arrear_type,
                'original_basic' => request.original_basic,
                'revised_basic' => request.revised_basic,
                'basic_difference' => basicDifference,
                'original_gross' => request.original_gross,
                'revised_gross' => request.revised_gross,
                'gross_difference' => grossDifference,
                'pf_on_arrear' => pfOnArrear,
                'esi_on_arrear' => esiOnArrear,
                'tds_on_arrear' => tdsOnArrear,
                'pt_on_arrear' => ptOnArrear,
                'net_arrear_amount' => netArrear,
                'status' => 'draft',
                'reason' => request.reason,
                'requested_by' => auth().id()
            ]);

            return response().json([
                'success' => true,
                'message' => 'Arrear payment created',
                'data' => arrear
            ]);

        } catch (Exception e) {
            return response().json([
                'success' => false,
                'message' => 'Error creating arrear: ' + e.getMessage()
            ], 500);
        }
    }

    public function listArrears(Request request): JsonResponse
    {
        organizationId = request.user().organization_id;
        
        arrears = ArrearPayment.where('organization_id', organizationId)
            ->with(['user:id,name,email'])
            ->orderBy('created_at', 'desc')
            ->get();

        return response().json([
            'success' => true,
            'data' => arrears
        ]);
    }

    public function approveArrear(Request request, int id): JsonResponse
    {
        organizationId = request.user().organization_id;
        
        arrear = ArrearPayment.where('organization_id', organizationId)
            ->findOrFail(id);

        arrear.update([
            'status' => 'approved',
            'approved_by' => auth().id(),
            'approved_at' => now()
        ]);

        return response().json([
            'success' => true,
            'message' => 'Arrear approved',
            'data' => arrear.fresh()
        ]);
    }

    public function rejectArrear(Request request, int id): JsonResponse
    {
        request.validate(['reason' => 'required|string']);

        organizationId = request.user().organization_id;
        
        arrear = ArrearPayment.where('organization_id', organizationId)
            ->findOrFail(id);

        arrear.update([
            'status' => 'rejected',
            'rejection_reason' => request.reason
        ]);

        return response().json([
            'success' => true,
            'message' => 'Arrear rejected',
            'data' => arrear.fresh()
        ]);
    }

    // Full & Final Settlement Methods
    public function createFnFSettlement(Request request): JsonResponse
    {
        request.validate([
            'user_id' => 'required|exists:users,id',
            'resignation_date' => 'required|date',
            'last_working_date' => 'required|date|after_or_equal:resignation_date',
            'exit_type' => 'required|in:resignation,termination,retirement,death,layoff',
            'notice_period_days' => 'required|integer|min:0',
            'served_days' => 'required|integer|min:0',
            'earned_leave_balance' => 'required|integer|min:0',
            'years_of_service' => 'required|numeric|min:0',
            'is_gratuity_eligible' => 'boolean'
        ]);

        organizationId = request.user().organization_id;

        try {
            user = User.where('organization_id', organizationId)
                ->findOrFail(request.user_id);

            template = EmployeePayrollTemplate.getOrCreateForUser(
                user.id,
                organizationId
            );

            basicSalary = (template.annual_ctc ?? 300000) * (template.basic_percentage ?? 40) / 100 / 12;

            // Calculate components
            shortfallDays = max(0, request.notice_period_days - request.served_days);
            noticePayRecovery = shortfallDays > 0 ? (basicSalary / 30) * shortfallDays : 0;

            monthlyGross = (template.annual_ctc ?? 300000) / 12;
            leaveEncashment = this.calculator.calculateLeaveEncashment(
                request.earned_leave_balance,
                monthlyGross
            );

            gratuityAmount = request.is_gratuity_eligible && request.years_of_service >= 5
                ? this.calculator.calculateGratuityForSettlement(basicSalary, request.years_of_service)
                : 0;

            // Calculate current month salary (pro-rated)
            lastWorkingDate = \Carbon\Carbon.parse(request.last_working_date);
            daysInMonth = lastWorkingDate.daysInMonth;
            daysWorked = lastWorkingDate.day;
            currentMonthSalary = (monthlyGross / daysInMonth) * daysWorked;

            // Calculate outstanding loans
            activeLoan = \App\Models\EmployeeLoan.where('user_id', user.id)
                ->where('status', 'approved')
                ->where('remaining_amount', '>', 0)
                ->first();
            loanRecovery = activeLoan ? activeLoan.remaining_amount : 0;

            settlement = FullAndFinalSettlement.create([
                'organization_id' => organizationId,
                'user_id' => user.id,
                'resignation_date' => request.resignation_date,
                'last_working_date' => request.last_working_date,
                'settlement_date' => now(),
                'exit_type' => request.exit_type,
                'notice_period_days' => request.notice_period_days,
                'served_days' => request.served_days,
                'shortfall_days' => shortfallDays,
                'notice_pay_recovery' => noticePayRecovery,
                'basic_salary' => basicSalary,
                'current_month_salary' => currentMonthSalary,
                'earned_leave_balance' => request.earned_leave_balance,
                'leave_encashment' => leaveEncashment,
                'years_of_service' => request.years_of_service,
                'gratuity_amount' => gratuityAmount,
                'is_gratuity_eligible' => request.is_gratuity_eligible ?? false,
                'loan_recovery' => loanRecovery,
                'status' => 'draft',
                'prepared_by' => auth().id()
            ]);

            settlement.calculateNetSettlement();
            settlement.save();

            return response().json([
                'success' => true,
                'message' => 'F&F settlement created',
                'data' => settlement.fresh()
            ]);

        } catch (Exception e) {
            return response().json([
                'success' => false,
                'message' => 'Error creating F&F settlement: ' + e.getMessage()
            ], 500);
        }
    }

    public function listFnFSettlements(Request request): JsonResponse
    {
        organizationId = request.user().organization_id;
        
        settlements = FullAndFinalSettlement.where('organization_id', organizationId)
            ->with(['user:id,name,email', 'preparer:id,name', 'approver:id,name'])
            ->orderBy('created_at', 'desc')
            ->get();

        return response().json([
            'success' => true,
            'data' => settlements
        ]);
    }

    public function getFnFSettlement(Request request, int id): JsonResponse
    {
        organizationId = request.user().organization_id;
        
        settlement = FullAndFinalSettlement.where('organization_id', organizationId)
            ->with(['user:id,name,email', 'preparer:id,name', 'approver:id,name'])
            ->findOrFail(id);

        return response().json([
            'success' => true,
            'data' => settlement
        ]);
    }

    public function approveFnFSettlement(Request request, int id): JsonResponse
    {
        organizationId = request.user().organization_id;
        
        settlement = FullAndFinalSettlement.where('organization_id', organizationId)
            ->findOrFail(id);

        if (!in_array(settlement.status, ['draft', 'pending'])) {
            return response().json([
                'success' => false,
                'message' => 'Settlement cannot be approved in current status'
            ], 422);
        }

        settlement.update([
            'status' => 'approved',
            'approved_by' => auth().id(),
            'approved_at' => now()
        ]);

        return response().json([
            'success' => true,
            'message' => 'F&F settlement approved',
            'data' => settlement.fresh()
        ]);
    }

    public function rejectFnFSettlement(Request request, int id): JsonResponse
    {
        request.validate(['reason' => 'required|string']);

        organizationId = request.user().organization_id;
        
        settlement = FullAndFinalSettlement.where('organization_id', organizationId)
            ->findOrFail(id);

        settlement.update([
            'status' => 'rejected',
            'rejection_reason' => request.reason
        ]);

        return response().json([
            'success' => true,
            'message' => 'F&F settlement rejected',
            'data' => settlement.fresh()
        ]);
    }

    public function processFnFPayment(Request request, int id): JsonResponse
    {
        request.validate([
            'payment_method' => 'required|in:bank_transfer,cash,cheque',
            'payment_reference' => 'nullable|string'
        ]);

        organizationId = request.user().organization_id;
        
        settlement = FullAndFinalSettlement.where('organization_id', organizationId)
            ->findOrFail(id);

        if (settlement.status !== 'approved') {
            return response().json([
                'success' => false,
                'message' => 'Settlement must be approved before payment'
            ], 422);
        }

        settlement.update([
            'status' => 'paid',
            'payment_method' => request.payment_method,
            'payment_reference' => request.payment_reference,
            'paid_at' => now()
        ]);

        return response().json([
            'success' => true,
            'message' => 'F&F payment processed',
            'data' => settlement.fresh()
        ]);
    }
}

# CareVance HRMS Payroll — Trust & Governance Fixes

Implementation-ready plan. Stages are ordered; commit + verify end-to-end after each.
Do NOT change calculation accuracy, statutory filing generation, or API contracts
beyond what is specified. Backend: Laravel. Frontend: React/TS.

---

## Grounding facts (verified in code)
- Org payroll settings = `Organization.settings` JSON, key `payroll` (no dedicated table).
  Mutated by `PayrollSettingsController` (`getSettings`/`updateSettings`/`resetSettings`).
- Run approval: `PayrollDepartmentController::approvePayrollRun` (line 2593), `releasePayrollRun` (2639),
  disburse transition ~line 3249 (`status='disbursed'`, `disbursed_by`, `writeRunAudit`).
- FBP exemption bug: `FbpService::calculateTaxExemptions` (116–146) computes
  `$exempt = min($approved, $maxExempt)` but `$taxable = $component->is_taxable ? $approved : 0`
  (exemption never subtracted). Per-payslip, `PayrollAutoProcessService::autoSyncFbp` (282) adds the
  full approved FBP sum to earnings; tax via `calculateNewRegimeTax($annualProjected, $exemptionMap)`.
- Notifications: `App\Models\Notification` + `NotificationController`; `PayslipDeliveryService` (134)
  already creates in-app notifications — reuse for payslip publish.
- Reversal: `BankIntegrationService::initiatePaymentReversal` (206) + `PaymentReversal` model exist;
  no UI. `PayrollFilingController::initiatePaymentReversal` (397) exists.
- Frontend: `ProcessAndPayModal` (one atomic `processAndPay`); `PayrollDashboard` has 4 `MetricCard`s
  (200–221), `RecentRuns` (309), "How to process payroll" help text (295); `SetupCompliance` stores
  `payroll.compliance` boolean toggles only (no due dates).

---

## STAGE 1 — FBP taxability bug (real money, first)
**Files:** `backend/app/Services/FbpService.php`; trace `PayrollAutoProcessService::autoSyncFbp` (282),
`PayrollCalculatorService::getApprovedTaxDeductionMap` / `calculateNewRegimeTax`, `SalaryCalculationService::calculateTds`.

1. Fix `FbpService::calculateTaxExemptions` (line 131):
   `taxable = is_taxable ? max(0, approved - exempt) : 0;` where `exempt = min(approved, max_exempt_limit)`.
   Keep `exempt_amount` in the result for transparency.
2. Ensure the **per-payslip** taxable FBP is netted the same way: feed the FBP exemption into the tax
   `exemptionMap` (or subtract it from the FBP portion of income) so only the excess over `max_exempt_limit`
   is taxed. Verify the claim amount path (`FbpClaim` approved amounts, `getMonthlyFbpAmount`) matches the
   exemption logic. LTA and any other `is_taxable` FBP components follow the same pattern automatically.
3. **Tests** (new `backend/tests/Unit/FbpTaxExemptionTest.php`, mirror `tests/Unit/PayrollAccuracyTest.php`):
   (a) claim ≤ limit → taxable FBP = 0; (b) claim > limit → taxable = claim − limit. Also a test that
   food coupons (is_taxable=false) remain fully exempt.

**Risk:** Only alter FBP exemption handling. Recompute affects a run only while still draft; do not
rewrite already-disbursed runs.

---

## STAGE 2 — Real maker-checker enforcement
**Backend files:** `PayrollDepartmentController.php`, `PayrollSettingsController.php`;
`backend/database/migrations` (JSON — no new table needed; optional accessor).

1. Add `require_second_approver` to `payroll` settings:
   - `PayrollSettingsController::DEFAULT_SETTINGS` add `'requireSecondApprover' => null` (null = derive).
   - Validator: add `'requireSecondApprover' => 'nullable|boolean'`.
   - Helper `shouldRequireSecondApprover(Organization $org)`: returns the stored boolean when set;
     otherwise `User::where('organization_id',$org->id)->whereIn('role',['admin','super_admin'])->count() >= 3`.
2. `approvePayrollRun` (2593): after the `locked` status check, if `shouldRequireSecondApprover($org)`
   and `auth()->id() === $run->locked_by` → `422` `"A different admin must approve this run."`
3. `releasePayrollRun` (2639): if `shouldRequireSecondApprover($org)` and
   `auth()->id() === $run->approved_by` → `422` `"A different admin must release this run."`
   (check live admin count at approval/release time, not signup).
4. Confirm/use lock endpoint (`lockPayrollRun`, sets `locked_by` ~2303/2315) as the "Process & Lock" action.

**Frontend files:** `ProcessAndPayModal.tsx`, `PayrollDashboard.tsx`.
1. Split the single `processAndPay` atomic flow into staged actions:
   - **Process & Lock** → calc + lock (available to whoever starts it).
   - **Approve** → separate; if `require_second_approver` ON and `currentUser === locked_by`, disable
     with tooltip "Waiting for a different admin to approve."
   - **Release** → enabled only once `approved_by` is set and (setting OFF, or approved_by ≠ current user).
   - **Confirm Upload & Mark Disbursed** → unchanged.
2. Keep `LifecycleRow` exactly as-is; feed it the real separated per-stage actions/states.
3. Update "How to process payroll" help text (line 295) to describe the actually-enforced flow
   (e.g., "Lock → approve by a different admin → release → disburse"); do NOT claim a 4-person review
   when the setting is off.

---

## STAGE 3 — Payslip publish notification
**Backend:** `PayrollDepartmentController` disburse method (~3249); new `notifyPayslips(Run $id)` method;
migration adding `payslips_notified_at` + `payslips_notified_status` ('sent'|'failed'|null) to
`payroll_monthly_runs`.
1. On disburse success, dispatch to every employee in the run: in-app `Notification::create(...)` (reuse
   `PayslipDeliveryService` pattern) + email (reuse existing mailer). Message:
   "Your payslip for {Month YYYY} is ready."
2. Record `payslips_notified_at`/`status`; on failure mark 'failed' and allow retry.
3. New `notifyPayslips` endpoint (resend) reusing the same dispatch.

**Frontend:** `PayrollRunDetailModal.tsx`, `PayrollDashboard.tsx` (`RecentRuns`, 288/309).
1. Show "Notify employees" status (Sent / Not sent) + Resend action on run detail.
2. Show the same Sent/Not-sent pill inline in `RecentRuns` rows.

---

## STAGE 4 — Surface the reversal flow
**Backend:** new `reversePayment` method (in `PayrollDepartmentController` or reuse
`PayrollFilingController::initiatePaymentReversal` 397) calling `BankIntegrationService::initiatePaymentReversal`.
Gate: admin role, run `status === 'disbursed'`, `reason` required (validated). Persists `PaymentReversal`.
**Frontend:** `PayrollRunDetailModal.tsx`.
1. Add "Reverse this payment" action: visible only for disbursed runs, admin-only, requires a reason field.
2. Show reversal status/history (from `PaymentReversal`) on the run detail view once used.

---

## STAGE 5 — Compliance due-date visibility
**Frontend:** new `ComplianceDueDateRail` component in `PayrollDashboard.tsx` (Overview).
**Source:** derive upcoming due dates from the statutory schedule, filtered by enabled compliances in
`payroll_settings.compliance` + org state (`defaultState` for PT):
- PF & ESI: monthly, by 15th.
- TDS: monthly, by 7th.
- PT: state-specific (default last working day).
- LWF: annual.
Each rendered as a pill with days-remaining, color shift neutral → warning (≤7d) → danger (≤3d / overdue).
Optional: allow org overrides via `payroll_settings.compliance_due_dates` (extend `SetupCompliance.tsx`).

---

## STAGE 6 — Overview dashboard upgrades (`PayrollDashboard.tsx`)
a) **Metric deltas:** add `delta` prop to `MetricCard` (`frontend/src/components/dashboard/MetricCard.tsx`);
   compute MoM ↑/↓ % for Total Net Pay, Total Employees, Pending, Paid from the prior month's entry in `runs`.
b) **Needs Attention always-on:** render even when `pendingCount === 0`. Pull categorized live counts from the
   same checks the Pre-Payroll Checklist runs: missing bank details, missing PAN/UAN, unassigned employees,
   pending FBP declarations. Each is a `QuickActionCard` with a live count badge + direct resolve link.
   (Backend: extend dashboard payload or add an endpoint reusing Pre-Payroll Checklist logic.)
c) **RecentRuns approver names:** show `locked_by_name` / `approved_by_name` / `released_by_name` inline per row
   (run already returns `approved_by_name` at 1928; ensure `locked_by_name`/`released_by_name` are included in
   the runs payload and rendered in `RecentRuns`).

---

## ACCEPTANCE CHECK (run after all stages)
- Single admin cannot self-approve when `require_second_approver` is on (422).
- Food-coupon claims within exemption confirmed untaxed via new unit tests.
- Disbursing a run notifies employees; Sent/Not-sent status visible on detail + Recent Runs.
- Disbursed run reversible from UI with reason logged.
- Overview shows upcoming compliance due dates without navigation.
- Metric cards show MoM comparison, not just raw numbers.
- "Needs Attention" surfaces real blockers at all times.

## OPEN QUESTIONS (confirm during refinement)
1. **"Admin" for the 3+ threshold** — recommend counting `role in ['admin','super_admin']`
   (strict payroll admins). Confirm vs custom strict-admin roles.
2. **`processAndPay` atomic** — keep as a single-admin "quick run" shortcut, or remove entirely in favor of
   the 4 staged buttons? Recommend keep for orgs where `require_second_approver` is off.
3. **Compliance exact due dates** — confirm the standard monthly/annual statutory dates above; allow state
   overrides (PT/LWF). Some acts are state-specific.
4. **Payslip email channel** — confirm `PayslipDeliveryService` can be triggered at disburse (it already
   creates in-app `Notification` at 134; verify it also sends email or wire `Mail::send`).
5. **Recompute scope (Stage 1)** — FBP fix applies to draft/future runs only; do not alter disbursed history.

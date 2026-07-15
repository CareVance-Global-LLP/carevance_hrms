# Fix: "Set CTC & Process" button does nothing in Run Payroll

## Root cause
In `frontend/src/pages/payroll/tabs/RunPayrollTab.tsx:185`, `PayGroupEmployees` is rendered with
`onSelectEmployee={noop}`. The employee card's action button (`PayGroupEmployees.tsx:190-202`)
always calls `onProcess` → `onSelectEmployee(employee.id)` (`PayGroupEmployees.tsx:590-593`).
Because that handler is a no-op in the Run flow, **clicking "Set CTC & Process" (and "Process
Payroll" when CTC is set) does nothing**.

The main Payroll page (`Payroll.tsx:309`) wires `onSelectEmployee` to open the employee wizard,
so only the `/payroll/run` ("Run Payroll") flow is broken.

(For context: `DepartmentEmployees.tsx` is unused dead code — not in scope.)

## Chosen approach
Add a **self-contained inline "Set CTC" modal** inside `PayGroupEmployees` that implements the full
"Set CTC & Process" flow without relying on the parent's `onSelectEmployee`. This matches the
in-product help text ("click Set CTC & Process to enter it inline").

## Changes

### 1. `frontend/src/components/payroll/PayGroupEmployees.tsx`
- Import `useQueryClient` from `@tanstack/react-query` (already imports `useQuery`).
- Add local state: `ctcModalEmployee: any | null` and `ctcInput: string`.
- Split the card's `onProcess` behavior:
  - If `!hasCTC` ("Set CTC & Process"): `e.stopPropagation(); setCtcModalEmployee(employee);`
    instead of calling `onSelectEmployee`.
  - If `hasCTC` ("Process Payroll"): keep calling `onSelectEmployee` (preserves existing wizard
    navigation on the main Payroll page).
- Add a new local `SetCtcModal` (rendered at bottom of the component, only when
  `ctcModalEmployee` is set):
  - Header showing employee name + "Set CTC & Process".
  - Annual CTC number input (validate `> 0`; show inline error otherwise).
  - Buttons: "Cancel" (closes modal) and primary "Set & Process".
  - On submit:
    1. `await payrollApi.quickSaveCtc(emp.id, { annual_ctc: Number(ctcInput), month_year })` — uses
       existing `PATCH /payroll/employees/{id}/ctc` (`api.ts:1796`).
    2. On success, process the employee via
       `await payrollApi.processScoped({ month_year, scope: 'single', user_ids: [emp.id] })`
       (existing `POST /payroll/auto/process-scoped`, `api.ts:1804`).
    3. `queryClient.invalidateQueries({ queryKey: ['payroll','pay-group', payGroupId, ...] })` so the
       card refreshes to "Paid"/"Processed".
    4. Close modal; surface errors via `alert`/`useToast` (component already imports pattern from
       DepartmentEmployees). Keep a `Loader2` spinner on the button while saving.
- Use the component's existing `monthYear` prop for both API calls.

### 2. `frontend/src/pages/payroll/tabs/RunPayrollTab.tsx` (parity fix)
The "Process Payroll" button (CTC already set) still routes through `onSelectEmployee`, which is
`noop` here, so it is also dead. Replace the `noop` with a real handler that navigates to the
working employee wizard:
- Add `useNavigate` from `react-router-dom`.
- `onSelectEmployee={(id) => navigate(`/payroll?view=employee&emp=${id}&step=0`)}`.
This reuses the already-working `EmployeePayrollWizard` and leaves the main Payroll page untouched.

## Boundaries / risks
- Do not modify `DepartmentEmployees.tsx` (unused) unless desired for parity — out of scope.
- Keep `onSelectEmployee` semantics unchanged for the main Payroll page so existing navigation keeps
  working.
- `quickSaveCtc` and `processScoped` already exist and are used elsewhere — no backend changes.

## Validation
1. `npm run lint` and TypeScript typecheck pass.
2. Manual: `/payroll/run` → Assign & Review step → select a pay group → find an employee showing
   "CTC not set" → click **Set CTC & Process** → modal opens → enter CTC → click **Set & Process**
   → confirm CTC saved, payroll processed, and the card updates (status no longer "pending"/"CTC not
   set").
3. Manual: for an employee that already has CTC, "Process Payroll" navigates to the employee wizard.
4. Manual: confirm the main Payroll dashboard "Set CTC & Process" still opens the wizard as before.

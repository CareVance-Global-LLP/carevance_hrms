# Payroll Dashboard Charts

## Problem

The `PayrollDashboard.tsx` file has a `<PayrollCharts />` component call (line ~321) but the component is **not defined**. Build will fail with "PayrollCharts is not defined". The Recharts imports exist (line 2-6) but the component body is missing.

The user needs 4 interactive chart tabs added to the payroll dashboard:
1. Department Split — donut chart of net pay distribution
2. Statutory Breakdown — donut chart of PF/ESI/PT/TDS/LWF
3. Monthly Payroll Trend — bar chart of last 6 months
4. Earnings vs Deductions — stacked horizontal bar

## Key Constraints

- **No `PayGroup.employees` array**: The `PayGroup` type (line 1115 of types/index.ts) has no `employees` property. It only has `employee_count`, `processed_count`, `paid_count`, `total_net_pay`, `name`, `id`, etc.
- **Statutory data from `runs` not `payGroups`**: Statutory deductions (PF, ESI, PT, TDS, LWF) are at the `PayrollMonthlyRun` level (`total_pf_employee`, `total_esi_employee`, `total_pt`, etc.) NOT in pay groups.
- **Recharts already imported** (line 2-6): `PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer` —无需重复导入.
- **`useState` and `useMemo` already imported** (line 1): `{ useState, useMemo } from 'react'`
- **`<PayrollCharts />` already called** (line ~321): Must define the component.

## Solution Step-by-Step

### Step 1: Add `PayrollCharts` component definition

Insert after the `RecentRuns` function (after line 527, before the final closing brace). The component must:

1. Accept props: `payGroups`, `runs`, `summaryStats` (same as current call site)
2. Use `useState` to track active tab
3. Use `useMemo` for all 4 data transformations
4. Render tab bar + chart/sidebar grid layout
5. Handle empty states gracefully

### Step 2: Department Split (donut chart)

Aggregate `payGroups` by `pg.name` using `total_net_pay` and `employee_count`. Since PayGroup has no `employees[]` array, use the pay group name as the department label.

### Step 3: Statutory Breakdown (donut chart)

Read from `runs` array. Find the latest run (by `month_year`) that has statutory totals. Fields on `PayrollMonthlyRun` to use:
- `total_pf_employee` (or `total_pf` if employee version is null)
- `total_esi_employee`
- `total_pt`
- `total_tds`
- `total_lwf`

If no run has these fields (they might be `0` or `null`), show empty state: "Process payroll to generate statutory deductions."

### Step 4: Monthly Trend (bar chart)

Take `runs`, filter for `total_net_pay > 0`, sort by `month_year`, take last 6. Map `month_year` string like "2026-06" to label "Jun 2026". Use `total_net_pay` for bar height.

### Step 5: Earnings vs Deductions (stacked horizontal bar)

Compute gross from statutory.gross, netPay from statutory.netPay, and each deduction from the statutory breakdown. Render a single stacked horizontal bar chart.

### Step 6: Empty States

Each chart tab MUST have a fallback when data is missing:
- Department: "No pay groups created for this month."
- Statutory: "Process payroll to generate statutory data."
- Trend: "No payroll runs yet. Start by processing a pay group."
- Breakdown: "Insufficient data. Run payroll first."

### Step 7: Sidebar Panels

Right sidebar (1/3 width) shows details for each tab:
- Department: List of pay groups with color dots, employee count, total net pay
- Statutory: Gross, each deduction with color, total deductions, net pay
- Trend: Months shown, average, highest, lowest
- Breakdown: Gross, total deductions, deduction %, net pay

### Step 8: Currency formatting

Use existing `formatCurrency` helper from the file (already defined at line 52-54). Do not create a new formatter.

### Step 9: Place PayrollCharts after summary cards

The call is already at line ~321, after the 4 MetricCards and before Quick Actions. Do NOT move it.

### Step 10: Ensure build passes

After adding the component, run `npm run build` in `D:\Caretime\frontend` and verify no TypeScript errors. Common issues:
- Type `any` on `payGroups` prop — may need to cast `PayGroup[]` or use `any[]` depending on strictness
- Missing `children` on `SurfaceCard` — use `className` only, do not pass children if not supported
- Recharts CSS conflicts — none expected since already used in 4 other files

## Data Shape Reference

```
PayGroup (no .employees array!):
  id, name, code, pay_frequency, pay_day, pay_day_type,
  description, is_active, employee_count, processed_count,
  paid_count, total_net_pay

PayrollMonthlyRun (has statutory totals):
  id, month_year, status, total_employees, total_gross,
  total_deductions, total_net_pay, total_pf_employee,
  total_esi_employee, total_pt, total_tds, total_lwf
```

## Visual Layout Reference

```
┌─────────────────────────────────────────────────────────────┐
│  [Metric Cards row: Net Pay, Employees, Pending, Paid]    │
├─────────────────────────────────────────────────────────────┤
│  [PayrollCharts component]                                  │
│  ┌─────────────────────────┬────────────────────────────┐  │
│  │ Tab: Dept | Stat | Trend│                            │  │
│  │ ─────────────────────────┤                            │  │
│  │                          │  ┌──────────────────────┐  │  │
│  │  🍩 Donut Chart          │  │ Department Details   │  │  │
│  │  (colored segments)      │  │ ● Sales     ₹45K     │  │  │
│  │                          │  │ ● HR        ₹80K     │  │  │
│  │                          │  │ ● Finance  ₹1.5L     │  │  │
│  │                          │  │                      │  │  │
│  │                          │  └──────────────────────┘  │  │
│  └─────────────────────────┴────────────────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│  Quick Actions (existing)                                  │
├─────────────────────────────────────────────────────────────┤
│  Pay Groups (existing)                                      │
├─────────────────────────────────────────────────────────────┤
│  Recent Runs (existing)                                    │
└─────────────────────────────────────────────────────────────┘
```

## Key Design Decisions

1. **Pay group name as department label** — since PayGroup has no `department` or `employees[]`, grouping by pay group name is the only viable option without backend changes.
2. **Statutory data from latest run** — not from pay groups, since deductions are per-run not per-group.
3. **Donut (not pie)** — inner radius 60, outer 110, padding angle 2 for gap
4. **Right sidebar details** — numbers clearer than hover-only tooltips
5. **4 tabs with 2-col grid** — left chart takes 2/3, right sidebar takes 1/3 on lg screens
6. **ResponsiveContainer** — charts resize with parent container
7. **Filter zero-value deductions** — hide PF/ESI/PT/TDS/LWF if their value is 0
8. **Empty state for each tab** — never show "Loading..." forever, always have fallback

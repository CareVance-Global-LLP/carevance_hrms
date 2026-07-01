# 🎯 FOCUSED PROMPT — Payroll Run History + Run Detail Redesign

> **Goal:** Redesign ONLY Payroll Run History and Payroll Run Detail pages to be clean, user-friendly, and Keka-inspired. Fix ₹NaN bug. Convert modal to full page with tabs.

---

## 📸 CURRENT STATE (From Screenshots)

### Payroll Run History — Problems
1. Plain list of months — no visual hierarchy, no cards
2. Each row is just text: "August 2026 · Run #10 · 7 employees · ₹10,704 · DISBURSED"
3. No filtering, no search, no date range picker
4. "How to process payroll" info box feels out of place
5. Pay Group cards (Team Care, Lazy) are basic — no hover, no visual polish
6. Status badges are just colored text, not proper pill badges

### Payroll Run Detail Modal — Problems
1. **₹NaN BUG** — Gross, Deductions, Net Pay show ₹NaN
2. Cramped modal — everything stacked vertically, no breathing room
3. No tabs — lifecycle stepper, checklist, summary all crammed together
4. Checklist items are basic — no visual progress bar
5. Summary cards at bottom are too small
6. No employee payslip list visible
7. No action buttons visible (Lock, Approve, Release, Disburse)

---

## 🎯 DESIGN SPEC — Payroll Run History Page

### Page Layout
```
┌─────────────────────────────────────────────────────────────┐
│  Payroll Run History                          [New Run] [Export] │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐          │
│  │ Total   │ │ Disbursed│ │ Pending │ │ Failed  │          │
│  │ Runs: 5 │ │ Runs: 3 │ │ Runs: 1 │ │ Runs: 1 │          │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘          │
├─────────────────────────────────────────────────────────────┤
│  Filters: [Period ▼] [Status ▼] [Search...]                │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 🟢 August 2026                                      │   │
│  │ Run #10 · 7 employees                               │   │
│  │ Gross: ₹1,25,000 · Deductions: ₹18,296 · Net: ₹1,07,04 │
│  │ [View Details] [Disburse]                            │   │
│  │ Status: DISBURSED · Disbursed 2 days ago             │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 🟡 July 2026                                        │   │
│  │ Run #7 · 0 employees                                │   │
│  │ Gross: ₹0 · Deductions: ₹0 · Net: ₹0               │   │
│  │ [View Details]                                       │   │
│  │ Status: DISBURSED                                    │   │
│  └─────────────────────────────────────────────────────┘   │
│  ... more runs ...                                          │
└─────────────────────────────────────────────────────────────┘
```

### Run Card Design
```tsx
// Each run as a clean card with hover effect
<div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm hover:shadow-md transition-all cursor-pointer group">
  {/* Header Row */}
  <div className="flex items-center justify-between mb-3">
    <div className="flex items-center gap-3">
      <StatusBadge status={run.status} />
      <div>
        <h3 className="text-lg font-semibold text-slate-900">{formatMonth(run.month_year)}</h3>
        <p className="text-sm text-slate-500">Run #{run.id} · {run.employee_count} employees</p>
      </div>
    </div>
    <div className="text-right">
      <p className="text-xl font-bold text-slate-900">{formatCurrency(run.total_net)}</p>
      <p className="text-xs text-slate-400">Net Pay</p>
    </div>
  </div>
  
  {/* Amount Breakdown */}
  <div className="grid grid-cols-3 gap-4 py-3 border-t border-slate-100">
    <div>
      <p className="text-xs text-slate-400">Gross</p>
      <p className="text-sm font-semibold text-slate-700">{formatCurrency(run.total_gross)}</p>
    </div>
    <div>
      <p className="text-xs text-slate-400">Deductions</p>
      <p className="text-sm font-semibold text-slate-700">{formatCurrency(run.total_deductions)}</p>
    </div>
    <div>
      <p className="text-xs text-slate-400">Net Pay</p>
      <p className="text-sm font-semibold text-emerald-600">{formatCurrency(run.total_net)}</p>
    </div>
  </div>
  
  {/* Footer Row */}
  <div className="flex items-center justify-between pt-3 border-t border-slate-100">
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-400">
        {run.disbursed_at ? `Disbursed ${formatRelativeTime(run.disbursed_at)}` : `Created ${formatRelativeTime(run.created_at)}`}
      </span>
    </div>
    <div className="flex items-center gap-2">
      <Button variant="ghost" size="sm" onClick={() => navigate(`/payroll/runs/${run.id}`)}>
        View Details →
      </Button>
      {run.status === 'released' && (
        <Button variant="primary" size="sm" onClick={() => handleDisburse(run.id)}>
          Disburse
        </Button>
      )}
    </div>
  </div>
</div>
```

### Status Badge Component
```tsx
// Pill badges with colored dots
function StatusBadge({ status }) {
  const config = {
    draft: { color: 'slate', label: 'Draft', dot: 'bg-slate-400' },
    locked: { color: 'blue', label: 'Locked', dot: 'bg-blue-500' },
    approved: { color: 'amber', label: 'Approved', dot: 'bg-amber-500' },
    released: { color: 'purple', label: 'Released', dot: 'bg-purple-500' },
    disbursed: { color: 'emerald', label: 'Disbursed', dot: 'bg-emerald-500' },
    processing: { color: 'blue', label: 'Processing', dot: 'bg-blue-500' },
  };
  
  const c = config[status] || config.draft;
  
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-${c.color}-100 text-${c.color}-700`}>
      <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
      {c.label}
    </span>
  );
}
```

---

## 🎯 DESIGN SPEC — Payroll Run Detail Page (Full Page, Not Modal)

### Page Layout
```
┌─────────────────────────────────────────────────────────────┐
│  ← Back    Payroll Run Detail              [Status: Approved] │
│            2026-06 · Run #1 · 2/7 employees                   │
├─────────────────────────────────────────────────────────────┤
│  [Summary] [Payslips] [Compliance] [Bank File] [Audit]     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Lifecycle Stepper                                   │   │
│  │  ●────────●────────●────────●────────○               │   │
│  │  Draft   Locked  Approved Released Disbursed         │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Pre-flight Checklist                    17%        │   │
│  │  ████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░           │   │
│  │                                                     │   │
│  │  ✅ Leave, Attendance & Payable Units                │   │
│  │     2 of 7 expected employees have attendance       │   │
│  │     finalized                                        │   │
│  │                                                     │   │
│  │  ○ New Joinees & Exits                              │   │
│  │     No joiners or exits in 2026-06                  │   │
│  │                                                     │   │
│  │  ○ Bonus, Salary Revisions & Overtime               │   │
│  │     No bonuses, revisions, or overtime this month   │   │
│  │                                                     │   │
│  │  ○ Reimbursement, Adhoc Payment, Deductions         │   │
│  │     No pending reimbursements                       │   │
│  │                                                     │   │
│  │  ○ Salaries on Hold & Arrears                       │   │
│  │     No salary holds or arrears this month           │   │
│  │                                                     │   │
│  │  ○ Override (PT, ESI, TDS, LWF)                     │   │
│  │     Manual override tracking is not yet enabled     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Summary                                            │   │
│  │                                                     │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐  │   │
│  │  │Employees│ │  Gross  │ │Deductions│ │ Net Pay │  │   │
│  │  │    2    │ │ ₹1,00,000│ │ ₹18,000 │ │ ₹82,000│  │   │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘  │   │
│  │                                                     │   │
│  │  Earnings Breakdown          Deductions Breakdown   │   │
│  │  ┌──────────────────┐       ┌──────────────────┐   │   │
│  │  │ Basic    ₹50,000 │       │ PF       ₹6,000  │   │   │
│  │  │ HRA      ₹20,000 │       │ ESI      ₹1,500  │   │   │
│  │  │ Special  ₹25,000 │       │ PT         ₹200  │   │   │
│  │  │ Conv.     ₹1,600 │       │ TDS     ₹10,300  │   │   │
│  │  │ Medical    ₹3,400 │       │                  │   │   │
│  │  └──────────────────┘       └──────────────────┘   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Action Bar                                         │   │
│  │  [Lock Run] [Process Remaining] [Unlock (Admin)]    │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Tab Contents

#### Tab 1: Summary
- 4 amount cards (Employees, Gross, Deductions, Net Pay)
- Earnings breakdown grid (Basic, HRA, Special, Conv, Medical)
- Deductions breakdown grid (PF, ESI, PT, TDS)
- Disbursement status card
- Action bar (Lock/Unlock/Approve/Release/Disburse based on state)

#### Tab 2: Payslips
- Grid of employee payslip cards (3 columns on desktop)
- Each card: Avatar, Name, Dept, Gross/Deductions/Net, Status badge
- Search/filter by employee name
- Click to expand full payslip details

#### Tab 3: Compliance
- Pre-flight checklist with 6 items
- Each item: Icon, Title, Description, Status (✅/○)
- Progress bar showing completion percentage
- "Review all employees" link

#### Tab 4: Bank File
- Generate bank file button
- Missing bank details list
- Bank format selector (HDFC/ICICI/SBI)
- Download/upload buttons

#### Tab 5: Audit
- Activity timeline with timestamps
- Who did what and when
- Filter by action type

---

## 🐛 BUG FIX — ₹NaN

### Root Cause
The `formatCurrency` function is receiving `undefined` or `null` values because the API response structure doesn't match what the component expects.

### Fix
```tsx
// ❌ CURRENT: Crashes on null/undefined
function formatCurrency(amount: number): string {
  return '₹' + Number(amount || 0).toLocaleString('en-IN');
}

// ✅ FIX: Safe formatting
function formatCurrency(amount: number | null | undefined): string {
  const value = Number(amount ?? 0);
  if (isNaN(value)) return '₹0';
  return '₹' + value.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

// Also fix the data extraction:
// ❌ CURRENT: May get undefined
const totals = {
  gross: items.reduce((s, i) => s + (i.gross_salary || 0), 0),
};

// ✅ FIX: Safe extraction with fallback
const totals = {
  gross: items.reduce((s, i) => s + Number(i.gross_salary ?? i.basic_salary ?? 0), 0),
  deductions: items.reduce((s, i) => s + Number(i.total_deductions ?? 0), 0),
  net: items.reduce((s, i) => s + Number(i.net_pay ?? 0), 0),
};
```

---

## 🎨 CSS STYLES TO ADD

```css
/* Run History Card */
.run-card {
  @apply rounded-2xl border border-slate-100 bg-white p-5 shadow-sm 
         hover:shadow-md transition-all cursor-pointer;
}

/* Run Detail Page */
.run-detail-page {
  @apply min-h-screen bg-slate-50;
}

.run-detail-container {
  @apply mx-auto max-w-7xl p-6 space-y-6;
}

/* Tab Navigation */
.tab-nav {
  @apply border-b border-slate-200;
}

.tab-button {
  @apply flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium 
         transition-colors;
}

.tab-button-active {
  @apply border-[#5D969D] text-[#5D969D];
}

.tab-button-inactive {
  @apply border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300;
}

/* Status Badge */
.status-badge {
  @apply inline-flex items-center gap-1.5 px-3 py-1 rounded-full 
         text-xs font-medium;
}

/* Amount Card */
.amount-card {
  @apply rounded-2xl border border-slate-100 bg-white p-5 shadow-sm;
}

/* Checklist Item */
.checklist-item {
  @apply flex items-start gap-3 p-4 rounded-xl border border-slate-100 
         bg-white hover:border-slate-200 transition-colors;
}

.checklist-item-complete {
  @apply border-emerald-200 bg-emerald-50;
}

/* Action Bar */
.action-bar {
  @apply rounded-2xl border border-blue-200 bg-blue-50/40 p-5;
}
```

---

## 📋 IMPLEMENTATION CHECKLIST

### Payroll Run History
- [ ] Convert plain list to card-based layout
- [ ] Add status badges (pill style with dots)
- [ ] Add amount breakdown (Gross/Deductions/Net)
- [ ] Add hover effect on cards
- [ ] Add "View Details" and "Disburse" buttons
- [ ] Add relative time display ("2 days ago")
- [ ] Add filters (Period, Status, Search)
- [ ] Add summary cards at top (Total Runs, Disbursed, Pending, Failed)

### Payroll Run Detail
- [ ] Convert modal to full page
- [ ] Add tab navigation (Summary, Payslips, Compliance, Bank File, Audit)
- [ ] Fix ₹NaN bug in summary cards
- [ ] Add lifecycle stepper with visual progress
- [ ] Add pre-flight checklist with progress bar
- [ ] Add earnings/deductions breakdown grids
- [ ] Add action bar with context-sensitive buttons
- [ ] Add employee payslip cards in grid

### Bug Fixes
- [ ] Fix ₹NaN in Gross/Deductions/Net Pay
- [ ] Fix missing bank details warning
- [ ] Fix action buttons not visible in modal

---

## 🎯 BEFORE vs AFTER

| Element | Before (Current) | After (Keka Style) |
|---------|------------------|-------------------|
| **Run History** | Plain text list | Card-based with hover |
| **Status** | Colored text | Pill badges with dots |
| **Amounts** | Just net pay | Gross/Deductions/Net breakdown |
| **Run Detail** | Cramped modal | Full page with tabs |
| **Checklist** | Basic list | Visual progress bar |
| **Summary** | ₹NaN bug | Proper formatted amounts |
| **Actions** | Not visible | Clear action bar |
| **Spacing** | Tight | Generous padding |

---

**Last Updated:** June 30, 2026
**Version:** 1.0 (Focused on Run History + Run Detail only)

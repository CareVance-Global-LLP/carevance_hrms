# Plan: Convert Step 5 (Loans & Advances) to TableVirtuoso

## Goal
Convert the `renderLoansStep` function in `BulkPayrollMatrix.tsx` from a plain `<table>` to a `TableVirtuoso` component, matching the pattern used in Steps 1-4. Step 6 (Preview) remains a plain `<table>`.

## Context
- `BulkPayrollMatrix.tsx` has 6 wizard steps for bulk payroll processing
- Steps 1-4 already use `TableVirtuoso` with `tableMinHeight` for virtual scrolling
- Step 5 (Loans & Advances) currently uses a plain `<table>` — inconsistent with Steps 1-4
- Step 6 (Preview & Process) should remain a plain `<table>` as it's a summary/preview step
- The `TableVirtuoso` component is already imported from `react-virtuoso`

## Changes

### 1. Flatten loans data for `TableVirtuoso`
The current Step 5 has a "grouped rows" pattern where the first loan row for an employee shows the employee cell (Emp ID, Name, Dept), and subsequent rows for the same employee use `<td colSpan={3}></td>`. `TableVirtuoso` renders flat rows via `itemContent`, so the data must be flattened.

Add a `useMemo` to create a flat array of loan rows:
```ts
const loanRowEntries = useMemo(() => {
  const entries: Array<{ empId: number; isFirst: boolean; loan: any }> = [];
  employees.forEach((emp) => {
    const loans = loansData?.[emp.id] ?? [];
    if (loans.length === 0) {
      entries.push({ empId: emp.id, isFirst: true, loan: null });
    } else {
      loans.forEach((loan, li) => {
        entries.push({ empId: emp.id, isFirst: li === 0, loan });
      });
    }
  });
  return entries;
}, [employees, loansData]);
```

### 2. Replace `<table>` with `<TableVirtuoso>` in `renderLoansStep`
- Replace `<table className="w-full border-collapse text-sm">` with `<TableVirtuoso style={{ height: '100%', minHeight: tableMinHeight }} totalCount={loanRowEntries.length}>`
- Move the `<thead>` into `fixedHeaderContent`
- Move the `<tfoot>` totals into `fixedFooterContent`
- Move the `<tbody>` content into `itemContent`
- Use `renderEmployeeCell(emp)` for `isFirst` rows, and `<td colSpan={3}></td>` for non-first rows
- Show "No active loans" message in the loan name cell for empty loan entries

### 3. Add `tableMinHeight` to Step 5
The `tableMinHeight` `useMemo` already exists (line 103) and is used by Steps 1-4. Step 5 will use the same value.

### 4. Keep Step 6 as plain `<table>`
No changes to `renderReviewStep` — it remains a plain `<table>` as the preview step.

## Files to Modify
- `D:\Caretime\frontend\src\components\payroll\BulkPayrollMatrix.tsx`

## Verification
- Confirm Step 5 renders with virtual scrolling like Steps 1-4
- Confirm employee grouping (first row shows employee cell, subsequent rows show empty spanning cells) works correctly
- Confirm totals footer is sticky/fixed at the bottom
- Confirm Step 6 remains unchanged as plain `<table>`
- Confirm `tableMinHeight` is applied consistently across all 5 `TableVirtuoso` instances
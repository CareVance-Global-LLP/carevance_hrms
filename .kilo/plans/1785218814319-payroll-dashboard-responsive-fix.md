# Plan: Fix Payroll Dashboard Whitespace on Window Resize

## Problem
When the user maximizes/minimizes the browser window, the Payroll overview page leaves increased whitespace on the sides instead of scaling/filling the available width.

## Root Cause
`D:\Caretime\frontend\src\components\payroll\PayrollDashboard.tsx:175` uses `max-w-7xl mx-auto`, which caps content horizontally at `1280px` and centers it. Wider viewports show empty space instead of utilizing available width.

Secondary issue: `ComplianceStatusBoard.tsx:246` has `w-[132px] shrink-0` on the action column, which can cause horizontal clipping on narrow viewports.

## Proposed Changes

### 1. `frontend/src/components/payroll/PayrollDashboard.tsx`
- **Line 175**: Remove `max-w-7xl mx-auto` from the root wrapper so the dashboard stretches full width.
- **Lines 184, ~240, ~280, ~330**: Update grid column classes from fixed breakpoints to fluid/fill widths:
  - Quick stats grid: `grid-cols-1 md:grid-cols-2 xl:grid-cols-4`
  - Compliance + Pay Groups/Runs grids: `grid-cols-1 xl:grid-cols-3`
  - These ensure more columns appear on very wide screens rather than leaving whitespace.

### 2. `frontend/src/components/payroll/ComplianceStatusBoard.tsx`
- **Line 246**: Remove hardcoded `w-[132px] shrink-0` from the action column. Use `whitespace-nowrap` and let the column size naturally, or use `min-w-[132px]` instead of fixed width.

## Validation
- Open Payroll overview at 1366px, 1920px, and 2560px widths
- Confirm content fills width without horizontal scroll
- Confirm Compliance Status action buttons don't clip on narrow viewports

## Out of Scope
- MonthTimeline, MetricCard, and child components don't need width changes unless they have internal hardcoded widths.
- No backend changes required.

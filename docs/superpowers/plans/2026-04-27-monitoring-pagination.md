# Monitoring Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce report load for heavy employees by serving timeline and recent screenshot data in small pages instead of eagerly loading large histories.

**Architecture:** Keep the backend API contract close to the current shape, but make timeline consumption page-based and make employee insights accept an explicit recent screenshot limit. Update the frontend workspaces to request only the first page by default and let the user move through additional pages on demand.

**Tech Stack:** Laravel, PHPUnit, React, TanStack Query, Vitest

---

### Task 1: Add failing backend tests for recent screenshot limiting

**Files:**
- Modify: `backend/tests/Feature/ReportWorkingTimeTest.php`
- Modify: `backend/app/Http/Controllers/Api/ReportController.php`

- [ ] **Step 1: Write the failing test**

Add a feature test that creates more than 10 screenshots for one employee, calls `/api/reports/employee-insights?...&recent_screenshot_limit=10`, and asserts the response returns only 10 recent screenshots in descending order.

- [ ] **Step 2: Run test to verify it fails**

Run: `php artisan test tests/Feature/ReportWorkingTimeTest.php --filter=recent_screenshot_limit`
Expected: FAIL because the endpoint currently hardcodes a higher screenshot limit.

- [ ] **Step 3: Write minimal implementation**

Update `employeeInsights()` to validate and honor `recent_screenshot_limit`, clamped to a safe max.

- [ ] **Step 4: Run test to verify it passes**

Run: `php artisan test tests/Feature/ReportWorkingTimeTest.php --filter=recent_screenshot_limit`
Expected: PASS

### Task 2: Add failing frontend tests for paginated timeline fetching

**Files:**
- Modify: `frontend/src/pages/ReportsWorkspace.test.tsx`
- Modify: `frontend/src/pages/ReportsWorkspace.tsx`
- Modify: `frontend/src/services/api.ts`

- [ ] **Step 1: Write the failing test**

Add a test asserting timeline mode uses `activityApi.getAll()` with `page` and `per_page: 10`, and renders pagination controls instead of calling `getAllPages()`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- ReportsWorkspace.test.tsx`
Expected: FAIL because the page currently calls `getAllPages()` and has no timeline pagination controls.

- [ ] **Step 3: Write minimal implementation**

Switch timeline mode to page-based fetching, add 10-row paging state, disable aggressive auto-refresh for historical timeline queries, and render previous/next controls.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- ReportsWorkspace.test.tsx`
Expected: PASS

### Task 3: Add failing frontend tests for recent screenshot limit usage

**Files:**
- Modify: `frontend/src/pages/MonitoringWorkspace.test.tsx`
- Modify: `frontend/src/pages/MonitoringWorkspace.tsx`
- Modify: `frontend/src/services/api.ts`

- [ ] **Step 1: Write the failing test**

Add a test asserting screenshot-related employee insights requests include `recent_screenshot_limit: 10`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- MonitoringWorkspace.test.tsx`
Expected: FAIL because the client currently does not send an explicit recent screenshot limit.

- [ ] **Step 3: Write minimal implementation**

Pass `recent_screenshot_limit: 10` from screenshot and monitoring views that only need recent previews.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- MonitoringWorkspace.test.tsx`
Expected: PASS

### Task 4: Verify the focused regression set

**Files:**
- Modify: `backend/tests/Feature/ReportWorkingTimeTest.php`
- Modify: `frontend/src/pages/ReportsWorkspace.test.tsx`
- Modify: `frontend/src/pages/MonitoringWorkspace.test.tsx`

- [ ] **Step 1: Run backend verification**

Run: `php artisan test tests/Feature/ReportWorkingTimeTest.php tests/Feature/ActivityTimelineProcessingTest.php tests/Feature/ScreenshotSecurityTest.php`
Expected: PASS

- [ ] **Step 2: Run frontend verification**

Run: `npm test -- ReportsWorkspace.test.tsx MonitoringWorkspace.test.tsx`
Expected: PASS

- [ ] **Step 3: Summarize residual risk**

Note that `reports/overall` still has larger in-memory analytics work and should be optimized in a follow-up if the dashboard error persists after pagination.

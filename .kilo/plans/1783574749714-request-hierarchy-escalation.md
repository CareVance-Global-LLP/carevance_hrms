# Plan: Hierarchy-wise Transfer/Escalation for Leave & Time-Edit Requests

## Goal
Modify the **existing** Leave Request (`LeaveRequest`) and Attendance Time-Edit Request
(`AttendanceTimeEditRequest`) flows so that:
1. A **pending** request already routes hierarchy-wise (handled by `ApprovalRoutingService`).
2. When the immediate upper-hierarchy reviewer is unavailable, the **employee can manually transfer/escalate** the request to the **next higher hierarchy level**.
3. **Admins are notified** "employee X messaged/transferred to hierarchy Y" (on submit and on transfer).

This reuses `ApprovalRoutingService`, so **custom-role `hierarchy_level` (upper/lower) is respected automatically** — no new hierarchy logic needed.

Scope: **leave** + **time-edit** only. **Not** payroll (per request). No new "tracker request" entity is created — the existing two request types get the transfer capability.

## Context (verified in code)
- `ApprovalRoutingService` (`backend/app/Services/Approvals/ApprovalRoutingService.php`):
  - `userHierarchyLevel()` uses `customRole.hierarchy_level` (fallback super_admin=0, admin=10, manager=50, employee=100, default=999).
  - `reviewerUserIds($requester)` → direct reporting manager + nearest higher-ranked in same department/group + all org admins (level<100).
  - `canReview($reviewer,$requester)` → must be higher rank (lower level) and in same org.
  - `organizationAdminIds()` → all level<=10 users.
- Both controllers already: submit → `sendToUsers(...)` to reviewers → `reviewableRequesterIds()` for inbox visibility → approve/reject + audit.
- Models have `user_id`, `reviewed_by`, `status`, `review_note`; `reviewer` relation = `reviewed_by` (null until final action). No persistent "current assigned reviewer" field today.
- Routes: `backend/routes/api/protected/attendance.php` (leave + time-edit). Approve/reject are under `role:admin,manager` group; submission is open to the employee.
- Frontend: `services/api.ts` has `leave-requests` + `attendance-time-edit-requests` functions (create/approve/reject). UI lives in `pages/Attendance.tsx` (leave) and time-edit list, plus `pages/ApprovalInbox.tsx` (manager/admin inbox), `lib/notificationDisplay.tsx`.

## Changes

### 1. DB migration (both tables)
Add to `leave_requests` and `attendance_time_edit_requests`:
- `escalated_to_user_id` : `nullable integer unsigned` (FK `users.id`) — current escalation target (primary).
- `escalation_history` : `nullable json` — array of `{ from_user_id, to_user_id, to_level, note, by_user_id, at }`.
Keep `reviewed_by` for the final actor. (First action by any eligible higher-up wins.)

### 2. `ApprovalRoutingService` — new method
Add `escalationTargetIds(User $requester, ?int $excludeUserId = null): Collection`:
- Candidates = org users where `userHierarchyLevel($c) < userHierarchyLevel($requester)` (higher rank) AND `canReview($c, $requester)` is true.
- If `$excludeUserId` provided, also require `userHierarchyLevel($c) < userHierarchyLevel(excludedUser)` (strictly higher than the skipped reviewer) and exclude that id.
- Return the **nearest level(s)** (mirror `nearestHigherRankedReviewerIds` sort-by-desc-level / filter-first-level) as user ids.
Reuses `userHierarchyLevel` → custom-role aware by construction.

### 3. Controllers — new `transfer()` action
Add to **`LeaveRequestController`** and **`AttendanceTimeEditRequestController`**:
- `transfer(Request $request, int $id)`: validate optional `note` (max 2000).
- Auth: `currentUser` must be the requester (`user_id === currentUser->id`) **or** an admin. Status must be `pending`.
- Compute `escalationTargetIds($requester, $item->escalated_to_user_id ?? immediateReviewerId)`. If empty → `422` "No higher hierarchy available to escalate to."
- Update `escalated_to_user_id` + append `escalation_history`.
- Notify new reviewer(s) via `sendToUsers` (type `leave_request`/`time_edit`, route `/approval-inbox`, meta includes `request_id`, `employee_id`, `escalated: true`).
- Notify **all org admins** via `organizationAdminIds($requester)` with message:
  `"{requester name} transferred a {kind} request to {reviewerLabel}: {names}."` (satisfies "admin notified employee messaged this hierarchy").
- `auditLogService->log(action: 'leave.escalated' / 'attendance.time_edit_escalated', ...)`.
- Return updated item (with `withApprovalDestination`).

### 4. Submission admin notification (both `store()` methods)
On submit, in addition to existing reviewer notification, explicitly notify all org admins:
`"{requester name} submitted a {kind} request to {reviewerLabel}: {names}."`
(Reuses `organizationAdminIds($requester)` + `reviewerLabel`/`reviewerUserIds`.) This makes the "admin gets notified" behavior explicit on creation, not only on transfer.

### 5. `index()` visibility / `withApprovalDestination`
Include `escalated_to_user_id`, `escalation_history`, and a computed `current_reviewer_names` so the UI can show "Escalated to: …" and history. No change to `reviewableRequesterIds()` (higher-ups already see it; first approver wins).

### 6. Routes (`backend/routes/api/protected/attendance.php`)
Add (NOT in the `role:admin,manager` group — requester triggers it; controller enforces ownership):
```
Route::post('/leave-requests/{id}/transfer', [LeaveRequestController::class, 'transfer']);
Route::post('/attendance-time-edit-requests/{id}/transfer', [AttendanceTimeEditRequestController::class, 'transfer']);
```

### 7. Frontend
- `services/api.ts`: add `transferLeaveRequest(id, { note })` → `POST /leave-requests/{id}/transfer`; add `transferTimeEditRequest(id, { note })` → `POST /attendance-time-edit-requests/{id}/transfer`.
- Employee request cards (leave list in `pages/Attendance.tsx`; time-edit pending list): when `status === 'pending'` and an escalation target is available, show a **"Transfer / Escalate"** button. On click → confirm + optional note → call API → refresh. Show "Escalated to: Name" + expandable history.
- `pages/ApprovalInbox.tsx`: render an "Escalated" badge and current reviewer for escalated items; reviewers keep Approve/Reject (first action wins).
- `lib/notificationDisplay.tsx`: ensure the new admin notification (meta `route: '/approval-inbox'`) deep-links correctly (already handled by existing logic).

## Hierarchy / custom-role handling
No new hierarchy code — `userHierarchyLevel()` already reads `customRole.hierarchy_level`, so "upper vs lower" is enforced everywhere (submit routing, `canReview`, and new `escalationTargetIds`). Verify `CustomRole` has `hierarchy_level` (confirmed used in `userHierarchyLevel` and `withApprovalDestination`).

## Validation
- New Feature test (`backend/tests/Feature/`): employee (level 100) submits leave → reviewer = manager (level 50). Manager "unavailable" → employee calls `transfer` → next higher (admin, level 10) becomes `escalated_to_user_id` and receives notification; an admin notification names the hierarchy. Second transfer with no higher level → `422`.
- Existing tests (`TimeEditNotificationFlowTest`, leave/time-edit Feature tests) must still pass.
- `php artisan test` (backend) + `npm run lint` / `tsc --noEmit` (frontend).

## Risks / decisions
- Transfer is **manual** (requester decides the immediate reviewer is unavailable) — no auto-detection of "availability". Acceptable per agreed design.
- Multi-level climb allowed: each `transfer` goes one level up (re-callable). Guard against re-escalating to the same user.
- If several users share the nearest higher level, all are notified (matches current `reviewerUserIds` behavior).
- Escalation does not lock out the previously-assigned reviewer; first approve/reject wins.

## Open question (non-blocking)
Allow transfer only by requester, or also by an admin on the requester's behalf? Current plan: **requester OR admin** (controller allows both). Confirm if you want admin-only escalation too.

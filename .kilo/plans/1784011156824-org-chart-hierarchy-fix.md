# Org Chart Hierarchy Engine Fix — Implementation Plan

**Repo:** CareVance HRMS (Laravel 12 backend + React 18 / TS / Vite frontend, PostgreSQL)
**Page:** `/organization-tree` → `frontend/src/pages/OrganizationTree.tsx`
**Endpoint:** `backend/app/Http/Controllers/Api/UserController.php@index` (`simple` branch)

Verified against current code (not assumed):
- `User::getHierarchyLevel()` (backend `app/Models/User.php:418`) is the canonical resolver. Constants `admin=10, manager=50, employee=100, super_admin=0`, matches the `Organization::SYSTEM_ROLE_HIERARCHY_LEVELS` in `backend/app/Models/Organization.php`.
- `OrganizationTree.tsx` builds the tree from `assignedUsers` only (line 241-252) and picks root via `sortedByHierarchy[0]` (line 266-267) → department-less Admin is dropped and lowest-level manager becomes fake root. **Confirmed.**
- `deptKey()` string matching (line 59) used in Steps 3.5/4 — backend `simple` payload only returns department *name* (`UserController.php:97-101,120`), not `department_id`. **Confirmed.**
- `DepartmentTeam` model (managers/members many-to-many via `department_team_managers` / `department_team_members`) fully exists; `User` model has **no** team relation, and the `simple` payload exposes **no** team data. **Confirmed.**
- Hierarchy-level resolver is duplicated 4× (UserController simple/full, DepartmentTeamController `levelOf`, TeamHierarchyController `fallbackLevel`). **Confirmed — out of scope per §5, flag only.**

---

## Additional requirement (from user)
Render the org chart as a continuous **Admin → Departments → Teams → Users** flow. Admin is always the single root. Departments appear as distinct sections under the Admin; within each department, users belonging to a `DepartmentTeam` are grouped under a visible team band; team managers sit above team members (same numeric `hierarchy_level` rule). This is satisfied by the root fix (§4.2) + `department_id` matching (§4.3) + team banding (§4.4) + boundary framing (§4.5).

---

## Step 1 — Backend: extend the `simple` payload (4.1)

**Add `User` model relations** (`backend/app/Models/User.php`):
```php
public function departmentTeamMemberships(): BelongsToMany
{
    return $this->belongsToMany(DepartmentTeam::class, 'department_team_members', 'user_id', 'team_id')
        ->withTimestamps();
}

public function departmentTeamManagerships(): BelongsToMany
{
    return $this->belongsToMany(DepartmentTeam::class, 'department_team_managers', 'user_id', 'team_id')
        ->withTimestamps();
}
```

**Eager-load in `UserController@index`** (line 62-68 `with([...])`): add
`'departmentTeamMemberships:id,name,department_id'`, `'departmentTeamManagerships:id,name,department_id'`.

**Extend the `simple` map** (after line 125) with:
```php
'department_id' => $user->employeeWorkInfo?->department?->id
    ? (int) $user->employeeWorkInfo->department->id : null,
'team' => $this->resolveOrgChartTeam($user),
```
Add a private helper `resolveOrgChartTeam(User $user): ?array` that:
- merges the user's `departmentTeamMemberships` + `departmentTeamManagerships` (via `->get()` on the relation, checking `relationLoaded`/loaded),
- picks **one** team deterministically: prefer a team whose `department_id` equals the user's `department_id`; tie-break by manager over member, then lowest `id`. (Resolves the "user can belong to multiple teams" ambiguity — see Open Questions.)
- returns `['id'=>int,'name'=>string,'is_manager'=>bool]` or `null`.

Use `$user->getHierarchyLevel()` everywhere; do **not** add a 5th match copy.

**Verification:** call `GET /api/users?simple=1` as an org admin; confirm a department-less Admin has `department_id: null` and still appears, and a team-member user has `team:{id,name,is_manager}` set correctly.

---

## Step 2 — Frontend: anchor root on the Admin role (4.2)

In `OrganizationTree.tsx`:
- Build the tree from **all** `raw` users, not `assignedUsers` (delete/repurpose the `assignedUsers`/`unassignedUsers` split for tree input; keep the "No Department Assigned" box only for **non-Admin** users with `department_id === null`).
- Root selection: find the admin via `raw.find(u => u.role === 'admin')`. If multiple, pick the one with earliest `created_at` as root and render the rest as direct children of the root (tagged as Admin peers, not Managers). Never use `sortedByHierarchy[0]`.
- Keep the existing "No admin record is available" empty state when **zero** admins exist.
- Admin never appears in the "No Department Assigned" box.

Verify in isolation: with test data where the Admin has no department, Admin now renders at top.

---

## Step 3 — Frontend: switch department matching to `department_id` (4.3)

- Add `department_id: number | null` to the `OrgUser` type and map it from the payload (around line 193-205).
- Replace every `deptKey(...)` comparison in Steps 3.5 (line 332-337) and 4 (line 361-368) with `u.department_id === other.department_id` integer comparison. Keep `department` (name string) **only** for card display labels.
- `deptKey` can be removed once unused.

---

## Step 4 — Frontend + backend: Team layer inside each department (4.4)

- Add `team: { id:number; name:string; is_manager:boolean } | null` to `OrgUser`.
- In the tree render (`SubordinateTree` + the admin section), when 2+ sibling users in a department share the same `team.id`, wrap them in a visual **team band** (thin labeled divider showing team name) instead of plain adjacency.
- Within a team, ordering stays by `hierarchy_level` (already produced by `childrenMap` sort) — team managers (`is_manager:true`, lower level number) render above team members.
- Users with `team === null` nest directly by `hierarchy_level` under their closest department superior (no regression).
- Teams are additive grouping; existing department-superior nesting logic is unchanged.

---

## Step 5 — Visual pass (4.5)

- Re-verify the `draw()` connector `useEffect` (line 420-462). Connectors are drawn from `tree.childrenMap` only; since Admin is now always a node with children, every branch gets a continuous line. Confirm no node is orphaned (the previously-excluded Admin no longer renders with no line).
- Add department boundary framing: a light background band / border around each department's cluster, and team boundary banding per §4.4, so sections read as distinct.
- Keep `TreeNodeCard` `w-[200px]` sizing.
- The "No Department Assigned" box at bottom shows only non-Admin, department-less users.

---

## Open Questions / Decisions (flagged, not blocking)
1. **Multi-team membership:** pivot tables allow a user in many teams. Plan resolves to the team whose `department_id` matches the user's `department_id` (manager>member, lowest id tie-break). If a user is a member of teams in *different* departments, only the same-department team is shown; others are silently ignored for the org chart. Confirm this is acceptable vs. showing all/flagging a conflict.
2. **4-way hierarchy resolver duplication** (§3.4) is intentionally **not** refactored here; new code calls `$user->getHierarchyLevel()`. Recommend a follow-up cleanup ticket.
3. The `team-hierarchy` endpoint (`TeamHierarchyController`) is untouched per §5.

## Non-goals (unchanged)
No schema changes to `roles` / `department_teams`; only additive `department_id` / `team` fields on the `simple` payload. The `full` (non-simple) branch is **not** modified (no other page consumes `userApi.getAll` without `simple:1` — verified).

## Acceptance (mirrors §6)
Admin root in 100% of cases (incl. no department) • no Admin in "No Department Assigned" • root by `role==='admin'` • custom role <10 doesn't displace Admin • custom roles 40/60 order correctly • department grouping by `department_id` • team members nest under team manager with visible band • team ordering by level • non-team users unchanged • continuous connectors • additive-only payload fields.

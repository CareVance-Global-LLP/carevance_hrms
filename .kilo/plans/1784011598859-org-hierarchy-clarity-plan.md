# Make "Who Reports to Whom" Understandable — Implementation Plan

## Scope
Two files, presentation/information-architecture only (no data-model changes):
- `frontend/src/features/departments/DepartmentWorkspace.tsx` (Departments page)
- `frontend/src/pages/OrganizationTree.tsx` (org chart, already has the earlier visual-polish pass: card redesign, team boxes, legend, zoom/pan)

## Key findings (verified)
- **`reporting_manager_id` is already available frontend-only.** `DepartmentWorkspace` gets `users` from `userApi.getAll({ period: 'all' })` (`UserController@index`, non-`simple` branch). That response eager-loads `employeeWorkInfo`, which serializes `reporting_manager_id` (backend `UserController.php:64-71`, `:151`). So `member.employeeWorkInfo?.reporting_manager_id` is present on every `membersInGroup` entry (they are resolved via `findUserById`). No backend change required.
- `membersInGroup` is built at `DepartmentWorkspace.tsx:948` and `:997` as `findUserById(member.id) || member`, so each entry carries the full `User` object (incl. `employeeWorkInfo`).
- `TeamCard` currently renders two disconnected chip clouds (lines 712-775) and tags team managers with a **text** `StatusBadge tone="info">manager</StatusBadge>` (line 760) — visually confusable with the role pill.
- Org tree already imports `Crown` (line 7) and has `view`/zoom state to extend. Simple mode confirmed as **flat people-only tree** (no team boxes, no department framing boxes, department = small card subtitle only).

## Decisions
- **2.1 "Reports to" fallback:** if `reporting_manager_id` is null → render nothing (cleaner than "—"). If the manager id isn't resolvable in the local `users` map → show `Manager #<id>`.
- **2.3 team-manager marker:** icon-only badge using `Crown` (lucide) next to the team-manager's name inside `TeamCard`; never a text chip. Role pill stays the colored `roleBadgeClass` pill (concept 1). Reporting manager is text-only (concept 3), never a badge.
- **2.3 header explainer:** a small dismissible info popover/tooltip near the "Teams / Departments" heading explaining "Team Manager (oversees a team) vs Reporting Manager (your approval line)". Use existing `AlertCircle`/`Info` pattern.
- **3.1 Simple (default):** flat reporting tree. Cards show name + role pill + department subtitle only (team chip hidden). Connectors all solid (no dashed team edges). No team boxes, no department framing boxes. `Detailed` re-enables team boxes/chips/dashed team connectors.
- **3.2 breadcrumb:** hover sets a transient preview; click pins it. Compute chain upward via `reporting_manager_id` over the existing `raw` users map (already present in org tree). Render as a strip: `Name → reports to → Manager → … → Top`.

## Implementation steps

### Step 1 — Departments: sort by hierarchy + "Reports to" (2.1)
File: `DepartmentWorkspace.tsx`, `DepartmentDetailPanel` (`membersInGroup.map`, ~421-449).
- Build `const managerMap = useMemo(() => new Map((users||[]).map((u:any)=>[Number(u.id), u.name])), [users])`.
- Sort: `const ordered = useMemo(() => [...membersInGroup].sort((a,b)=> (getHierarchyLevel(a)-getHierarchyLevel(b))), [membersInGroup, getHierarchyLevel])` and map over `ordered`.
- Under the email `<p>` (line 435), add:
  ```tsx
  {(() => {
    const rmId = member.employeeWorkInfo?.reporting_manager_id;
    if (rmId == null) return null;
    const name = managerMap.get(Number(rmId));
    return <p className="mt-0.5 text-[11px] text-slate-400">Reports to: {name ?? `Manager #${rmId}`}</p>;
  })()}
  ```
- Acceptance: senior-first order; every row with a manager shows "Reports to: <name>".

### Step 2 — Departments: TeamCard restructure (2.2)
File: `TeamCard` (656-781). Replace the 2-col `grid` (712) with a single vertical structure:
- **Managers** section first: render each manager as a slightly larger/bolder row (avatar + name + `Crown` icon-only badge), not a small chip.
- A visual connector (left vertical line / indent) leading into the **Members** list beneath, rendered as indented rows (avatar + name + remove button).
- Header hint: "N managers jointly oversee M members" so it reads as one hierarchy, not two buckets. Keep Add-member / Add-manager controls.

### Step 3 — Departments: disambiguate manager concepts (2.3) + sidebar preview (2.4)
- 2.3: In `TeamCard`, replace `StatusBadge tone="info">manager</StatusBadge>` (760) with a `Crown` icon-only badge (title="Team manager"). Add `Crown` to imports (line 3-19).
- Add dismissible "?" info tooltip near header (`DepartmentWorkspace` heading, ~893) explaining Team Manager vs Reporting Manager.
- 2.4: In the directory list item (946-982), compute top member via `[...membersInGroup].sort((a,b)=>getHierarchyLevel(a)-getHierarchyLevel(b))[0]` and append subtitle `· led by {name}` under the member count.

### Step 4 — Org tree: Simple/Detailed toggle (3.1)
File: `OrganizationTree.tsx`.
- Add `const [view, setView] = useState<'simple'|'detailed'>('simple')` (default Simple, per user).
- Toolbar: segmented control `Simple | Detailed` near the zoom controls.
- Pass `simple={view==='simple'}` into `TreeNodeCard` and `SubordinateTree`.
- `TreeNodeCard`: when `simple`, hide the team chip (103-109) and keep department subtitle.
- `SubordinateTree`: when `simple`, render all nodes as individual sibling cards (skip team-band bounding boxes) and force all connectors solid (`isTeamEdge` → false). Detailed keeps existing team boxes + dashed team connectors.

### Step 5 — Org tree: hover/click breadcrumb (3.2)
File: `OrganizationTree.tsx`.
- Build `const byId = useMemo(()=> new Map(raw.map(u=>[u.id,u])), [raw])`.
- `const [pinned, setPinned] = useState<number|null>(null)` and `const [hovered, setHovered] = useState<number|null>(null)`.
- `TreeNodeCard`: add `onMouseEnter={()=>setHovered(user.id)} onMouseLeave={()=>setHovered(null)} onClick={()=>setPinned(user.id)}`.
- Render a breadcrumb strip (below toolbar / above viewport) for `byId.get(pinned ?? hovered)`: walk `reporting_manager_id` upward, rendering `Name → reports to → …`. Show role in final node.

## Risks / notes
- `member`/`user` are `any` in this file, so `employeeWorkInfo?.reporting_manager_id` is type-safe without type changes.
- Keep `Members`/`Teams` tab structure and all mutation handlers intact (non-goal).
- Do not alter tree-building algorithm, data fetching, or field names in either file.
- Org tree connectors sit in an unscaled SVG layer aligned to `stageRef`; Simple mode only changes which connectors are dashed, not the measurement logic.

## Validation
- `cd frontend && npx tsc --noEmit` — clean.
- `npx eslint src/features/departments/DepartmentWorkspace.tsx src/pages/OrganizationTree.tsx --ext ts,tsx --report-unused-disable-directives --max-warnings 0` — clean.
- Manual: open Departments → a department → Members tab sorted senior-first with "Reports to" lines; open a team → single hierarchy with Crown badges; sidebar shows "led by". Org tree defaults to Simple (flat), toggle to Detailed restores team boxes; hover/click a card shows the reporting breadcrumb.
- Acceptance criteria cross-check: all 7 boxes in the master prompt mapped to steps 1–5 above.

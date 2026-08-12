# Dialog primitive — what is left

**Date:** 2026-08-12
**Branch:** `feat/dialog-primitive`
**Context:** `docs/superpowers/specs/2026-08-12-dialog-primitive-design.md`

The payroll tranche is done: `grep -rn "fixed inset-0" frontend/src/components/payroll
frontend/src/pages/payroll` returns nothing. 22 overlays across 16 files now use
`Modal` or `SlideOver`.

Note the count. The plan said 21 overlays across 15 files; `PayGroupEmployees.tsx`
was missed in the original survey and found by the Task 11 grep. It is migrated.

## Overlays still hand-rolled

29 files outside `components/ui/dialog` still contain `fixed inset-0`. They split
three ways, and the split matters — most of them are not modal dialogs.

### Modal dialogs — migrate the same way

These are the direct equivalents of the payroll work. Each is a wrapper swap plus
a heading id.

- `components/assets/AssetFormModal.tsx`
- `components/assets/AssignAssetModal.tsx`
- `components/chat/CreateGroupModal.tsx`
- `components/chat/NewConversationModal.tsx`
- `components/employees/AddEmployeeModal.tsx`
- `components/groups/QuickCreateGroupDialog.tsx`
- `components/ui/RejectReasonModal.tsx`
- `features/billing/CancelPlanDialog.tsx`
- `features/billing/SeatDialog.tsx`
- `features/tasks/TaskComposerModal.tsx`
- `pages/EmployeeMobileDashboard.tsx`
- `pages/Invoices.tsx`
- `pages/Loans.tsx`
- `pages/Projects.tsx`
- `pages/ReimbursementsPage.tsx`
- `pages/ReportsWorkspace.tsx`
- `pages/ResignationPage.tsx`
- `pages/RoleManagement.tsx`
- `pages/SelfieMapView.tsx`
- `components/add-user/AddUserDrawer.tsx` (a drawer — use `SlideOver`)
- `components/add-user/steps/Step1BasicInfo.tsx`

`RejectReasonModal` is the highest value of these: it lives in `components/ui/`
and is imported widely, so it should be built on `Modal` for the same reason
`ConfirmDialog` was.

### Adopt the hook, keep the markup

Bespoke layouts that should not be flattened into a shell, but should stop
reimplementing focus and Escape:

- `components/search/CommandBar.tsx` — already has a real Tab trap and portal.
- `components/navigation/SidebarDrawer.tsx` — already has a real Tab trap and portal.
- `components/Layout.tsx`

Replacing their hand-rolled effects with `useDialogBehavior` also puts them on the
shared stack, so they participate in Escape ordering and scroll-lock refcounting
with everything else.

### Not modal dialogs — leave alone

- `components/landing/CursorSpotlight.tsx` — a decorative pointer effect.
- `components/desktop/IdleReturnPrompt.tsx` — evaluate; it interrupts, so it may
  want `alertdialog`.
- `components/chat/MessageArea.tsx` — an inline overlay, not a dialog.
- `features/monitoring/ScreenshotFilmstrip.tsx` — a lightbox; would want its own
  semantics.

Separately, `components/ui/CustomSelect`, `EmployeeSelect`, `MonthPicker`,
`SearchSuggestInput` and `TaskSelect` already portal but are popovers, not modal
dialogs. They want different focus semantics and are deliberately excluded.

## Follow-ups this work surfaced

**Duplicate nested dialog name.** `AddEmployeeToPayGroupModal` renders
`EmployeePickerList` inside itself and passes it the same `title`, so two stacked
dialogs carry an identical accessible name and the user sees the heading twice.
Pre-existing; the a11y work only made it visible. Either the outer header or the
inner `title` should go.

**Test gaps, stated rather than hidden.** Three migrated overlays have no render
test:

- `FilingsDashboard` record-as-filed — behind six queries and a nested filing row.
- `PayGroupSettings` edit and delete — need more page scaffolding than the
  assertion is worth.

There is also no integration test for "Escape closes only the nested dialog"
through `PayrollRunDetailModal`; reaching that state needs the lock request to
reject with a 422 carrying `incomplete`, and driving react-query there through the
mock proved unreliable. The behaviour is covered harder at the unit level — see
the comment in `PayrollRunDetailModal.test.tsx`.

**Pre-existing lint errors in touched files.** `AddEmployeeToPayGroupModal` (5),
`PayrollSettingsModal` (1), `PayGroupSettings` and `SalaryStructureTemplates` (13
between them) carry unused imports and vars. Verified identical before and after
this work; left alone so the chrome-swap diffs stay readable. Worth a separate
sweep — repo-wide the count is 251 errors across 78 files, so `npm run lint`
(`--max-warnings 0`) fails today.

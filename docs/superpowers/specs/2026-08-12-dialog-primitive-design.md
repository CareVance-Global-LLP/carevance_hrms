# Dialog primitive — design

**Date:** 2026-08-12
**Status:** approved, not yet implemented
**Branch:** `feat/dialog-primitive`

## Problem

46 files under `frontend/src` hand-roll an overlay with `fixed inset-0`. 35 of them have no
`role="dialog"`, no `aria-modal` and no Escape handler. Three files implement a real Tab focus
trap — `components/ui/ConfirmDialog.tsx`, `components/search/CommandBar.tsx`,
`components/navigation/SidebarDrawer.tsx`. The rest let Tab walk out of the open dialog into the
page behind it.

The behaviour is not unknown to this codebase; it is known in three places and absent from the
other forty-three. Each of the three working implementations carries a comment recording a real
bug that was fixed there and nowhere else:

- `ConfirmDialog` focuses the panel rather than the confirm button, because landing on "Confirm"
  makes a stray Enter destroy something.
- `SlideOver` holds `onClose` in a ref, because callers pass inline arrows, the effect re-ran on
  every render, and `panelRef.focus()` pulled focus out of the field being typed into — only the
  first character ever landed.
- `CommandBar` and `SidebarDrawer` portal to `document.body` so an `overflow:hidden` ancestor
  cannot clip the overlay.

Fixing this one screen at a time reproduces those three fixes forty-three times, or more likely
does not.

## Approach

Extract, do not rewrite. A headless hook holds the behaviour; two thin shells hold the markup.

```
frontend/src/components/ui/dialog/
  dialogStack.ts          module-level stack of open dialogs
  useDialogBehavior.ts    portal target, focus, Escape, scroll lock, dismissal
  Modal.tsx               centered card shell
  SlideOver.tsx           right drawer shell (moved from features/employees/)
  index.ts
```

`ConfirmDialog` is rebuilt on `Modal` **keeping its current props exactly**, so its 14 call sites
do not change. `SlideOver` moves into the new directory and `features/employees/SlideOver.tsx`
becomes a re-export, so its 12 call sites do not change. 26 existing call sites keep working
untouched.

`CommandBar` and `SidebarDrawer` adopt the hook and keep their own markup. Their layouts are
bespoke for good reasons and flattening them into `Modal` is not in scope.

### Rejected alternatives

- **One `<Modal variant="center|drawer">`.** Fewer files, but centered dialogs and drawers differ
  in layout, sizing and entry animation, so the prop matrix grows to cover both, and all 12
  `SlideOver` call sites have to be rewritten for no user-visible gain.
- **Promote `SlideOver` and write `Modal` beside it.** Least code movement, but the shared
  behaviour stays duplicated across two files, which is the problem this design exists to remove.

## `dialogStack.ts`

A module-level array of open dialog ids. Every dialog pushes on open and pops on close.

It exists because `PayrollRunDetailModal.tsx` is a drawer at `z-50` containing two nested dialogs
at `z-[60]`. That is not a bug today, because the drawer has no Escape handler at all. The moment
the drawer gets one, a per-instance global `keydown` listener would close the drawer and the
nested dialog together on a single Escape.

The stack resolves three things:

| Concern | Rule |
|---|---|
| Escape | Fires only for the entry at the top of the stack. |
| Scroll lock | Refcounted. `body.style.overflow` is captured when the stack goes empty → 1, and restored only when it returns to 0. |
| z-index | Derived from stack depth: `50 + depth * 10`. Replaces the hand-picked `z-40` / `z-50` / `z-[60]` currently in the tree. |

The stack is module state, not context, so a dialog rendered through a portal from anywhere in
the tree participates without a provider.

## `useDialogBehavior.ts`

```ts
useDialogBehavior({
  open: boolean
  onClose: () => void
  busy?: boolean               // blocks Escape and backdrop dismissal
  dismissOnBackdrop?: boolean  // default true
  initialFocusRef?: RefObject<HTMLElement>
})
  => { panelRef, backdropProps, panelProps, zIndex }
```

Behaviour, and where each rule comes from:

1. **Portal target** is `document.body`. (from `CommandBar`)
2. **Focus moves to the panel**, not to the first focusable child, unless `initialFocusRef` is
   given. (from `ConfirmDialog` — a stray Enter on a focused destructive button)
3. **Focus returns** to `document.activeElement` as captured at open. (all three)
4. **`onClose` is held in a ref** and is not an effect dependency. (from `SlideOver` — this is
   load-bearing; making `onClose` a dependency reintroduces the bug where typing in a drawer
   field loses focus after one character)
5. **Tab cycles** between the first and last visible focusable descendants of the panel.
   (from `ConfirmDialog`)
6. **Escape closes**, only when this dialog is top of stack and `busy` is false.
7. **Body scroll locks**, refcounted through the stack.
8. **Backdrop dismissal requires both `pointerdown` and `pointerup` on the backdrop.** The current
   `stopPropagation` pattern is correct for a plain click but still dismisses when the user
   drag-selects text inside the panel and releases outside it. Suppressed entirely while `busy`.

`busy` exists so a click or an Escape cannot discard an in-flight save. Callers that already
track a submitting state pass it.

## Shells

`Modal` renders a centered card: backdrop, `SurfaceCard` panel, optional header with title,
subtitle and close button, scrollable body, optional footer. Props: `open`, `onClose`, `title`,
`subtitle`, `size` (`sm | md | lg | xl`), `busy`, `dismissOnBackdrop`, `footer`, `children`.

`SlideOver` keeps its current props and appearance and gains the Tab trap plus stack
participation. `title` is required on both shells and binds `aria-labelledby` to the rendered
heading, so an accessible name cannot be forgotten.

Entry animation is CSS only — a short fade with a small scale on `Modal` and a translate on
`SlideOver` — wrapped in `@media (prefers-reduced-motion: reduce)`. No animation library; the
primitive must not pull `framer-motion` into every chunk that opens a dialog.

## Migration — payroll tranche

15 files, 21 overlay instances:

`PayrollSettingsModal`, `SalaryStructureFormModal`, `UploadForm16Modal`, `ProcessAndPayModal`,
`PayGroupModal`, `AddEmployeeToPayGroupModal`, `PayrollReportsModal`, `HelpDrawer`,
`PayrollRunDetailModal` (×4), `FilingsDashboard`, `FbpDashboard`, `StopPaymentFlags` (×3),
`EmployeePickerList`, `PayGroupSettings` (×2), `SalaryStructureTemplates`.

Each migration deletes the `fixed inset-0` wrapper and its backdrop, wraps the existing body in
`Modal` or `SlideOver`, and passes the heading text as `title`. **Panel contents are not
modified.** This is a chrome swap. Expected visual change is limited to backdrop opacity and
z-index becoming consistent; anything else is a mistake.

Chosen because payroll carries the highest-traffic screens, the deepest nesting case, and the
largest cluster of dialogs that currently announce nothing to a screen reader.

## Testing

Test-first on `dialogStack` and `useDialogBehavior`, where the logic lives:

- Escape closes the top dialog only, leaving the one beneath it open.
- Scroll lock survives a nested open/close and unlocks only when the last dialog closes.
- Focus lands on the panel and returns to the trigger element on close.
- Tab from the last focusable child cycles to the first; Shift+Tab from the first cycles to the last.
- `busy` blocks both Escape and backdrop dismissal.
- `pointerdown` inside the panel followed by `pointerup` on the backdrop does not close.
- A re-rendered inline `onClose` does not re-run the focus effect.

Then one render test per migrated file: the overlay exposes `role="dialog"` and an accessible
name. Cheap to write and it is what stops the regression.

## Verification

`npx tsc --noEmit` at 0 errors. `npx eslint src --ext ts,tsx` at 0. `npx vitest run` compared by
failing test **name** against `.github/baselines/vitest.txt` (57 names), never by count. New test
files are expected to add passing names only; if the set of failing names changes, the baseline
is regenerated deliberately and committed, not silently.

## Out of scope

- The ~25 non-payroll overlays. Listed for a follow-up pass; unchanged here.
- Visual redesign of any panel body.
- The 31 `alert()` / `confirm()` calls, several of which live in these same payroll files. A
  separate change with a separate review.
- `components/ui/CustomSelect`, `EmployeeSelect`, `MonthPicker` and the other portalled popovers.
  They are popovers, not modal dialogs, and want different focus semantics.

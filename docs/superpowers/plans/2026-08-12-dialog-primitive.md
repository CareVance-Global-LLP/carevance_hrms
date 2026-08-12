# Dialog Primitive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace 21 hand-rolled payroll overlays with one shared, accessible dialog primitive, built by extracting the behaviour that already works in three files.

**Architecture:** A module-level stack (`dialogStack`) tracks open dialogs so Escape, scroll lock and z-index behave correctly when dialogs nest. A headless hook (`useDialogBehavior`) owns focus, keyboard and dismissal. Two shells — `Modal` (centered) and `SlideOver` (right drawer) — own markup only. `ConfirmDialog` is rebuilt on `Modal` keeping its exact props; `SlideOver` moves from `features/employees/` with a re-export left behind. 26 existing call sites are untouched by design.

**Tech Stack:** React 18, TypeScript, Vite, Tailwind, Vitest + happy-dom, @testing-library/react, @testing-library/user-event, lucide-react.

**Spec:** `docs/superpowers/specs/2026-08-12-dialog-primitive-design.md`

## Global Constraints

- All work happens on branch `feat/dialog-primitive`. Do not commit to `main`.
- All commands run from `frontend/` unless stated otherwise.
- `npx tsc --noEmit` must stay at 0 errors after every task.
- `npx eslint src --ext ts,tsx` must stay at 0 errors after every task.
- Test regressions are judged by failing test **name**, never by count, against `.github/baselines/vitest.txt` (57 names). New tests must add passing names only.
- Vitest 4 has no `basic` reporter. Run `npx vitest run <path>` with no `--reporter` flag.
- `vitest.config` sets `globals: false` — every test file imports `describe`, `it`, `expect`, `vi` explicitly from `vitest`.
- Colours come from Tailwind classes already used in the file being edited. Do not introduce hex literals.
- Panel bodies are never modified during migration. This is a chrome swap.
- Every commit message ends with:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

## File Structure

| File | Responsibility |
|---|---|
| `src/components/ui/dialog/dialogStack.ts` | Open-dialog stack; scroll-lock refcount; depth lookup. No React. |
| `src/components/ui/dialog/dialogStack.test.ts` | Unit tests for the stack. |
| `src/components/ui/dialog/useDialogBehavior.ts` | Focus move/trap/restore, Escape, backdrop dismissal, z-index. No markup. |
| `src/components/ui/dialog/useDialogBehavior.test.tsx` | Behaviour tests through a minimal harness component. |
| `src/components/ui/dialog/Modal.tsx` | Centered card shell. |
| `src/components/ui/dialog/Modal.test.tsx` | Shell tests. |
| `src/components/ui/dialog/SlideOver.tsx` | Right drawer shell, moved from `features/employees/`. |
| `src/components/ui/dialog/SlideOver.test.tsx` | Shell tests. |
| `src/components/ui/dialog/index.ts` | Public exports. |
| `src/features/employees/SlideOver.tsx` | Re-export shim so 12 call sites keep working. |
| `src/components/ui/ConfirmDialog.tsx` | Rebuilt on `Modal`, props unchanged. |
| 15 payroll files | Chrome swapped to `Modal` / `SlideOver`. |

---

### Task 1: dialogStack

**Files:**
- Create: `frontend/src/components/ui/dialog/dialogStack.ts`
- Test: `frontend/src/components/ui/dialog/dialogStack.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `pushDialog(id: symbol): void`, `popDialog(id: symbol): void`, `isTopDialog(id: symbol): boolean`, `dialogDepth(id: symbol): number`, `resetDialogStack(): void`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/ui/dialog/dialogStack.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { dialogDepth, isTopDialog, popDialog, pushDialog, resetDialogStack } from './dialogStack';

afterEach(() => {
  resetDialogStack();
});

describe('dialogStack', () => {
  it('locks body scroll when the first dialog opens', () => {
    document.body.style.overflow = 'auto';
    const a = Symbol('a');

    pushDialog(a);

    expect(document.body.style.overflow).toBe('hidden');
  });

  it('restores the pre-lock overflow only when the last dialog closes', () => {
    document.body.style.overflow = 'auto';
    const outer = Symbol('outer');
    const inner = Symbol('inner');

    pushDialog(outer);
    pushDialog(inner);
    popDialog(inner);

    // The outer dialog is still open, so the page behind it must stay locked.
    expect(document.body.style.overflow).toBe('hidden');

    popDialog(outer);

    expect(document.body.style.overflow).toBe('auto');
  });

  it('treats only the most recently pushed dialog as top', () => {
    const outer = Symbol('outer');
    const inner = Symbol('inner');

    pushDialog(outer);
    pushDialog(inner);

    expect(isTopDialog(inner)).toBe(true);
    expect(isTopDialog(outer)).toBe(false);

    popDialog(inner);

    expect(isTopDialog(outer)).toBe(true);
  });

  it('reports depth so nested dialogs can stack their z-index', () => {
    const outer = Symbol('outer');
    const inner = Symbol('inner');

    pushDialog(outer);
    pushDialog(inner);

    expect(dialogDepth(outer)).toBe(0);
    expect(dialogDepth(inner)).toBe(1);
  });

  it('ignores a duplicate push of the same dialog', () => {
    const a = Symbol('a');

    pushDialog(a);
    pushDialog(a);
    popDialog(a);

    expect(document.body.style.overflow).toBe('');
  });

  it('ignores a pop of a dialog that was never pushed', () => {
    expect(() => popDialog(Symbol('ghost'))).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/ui/dialog/dialogStack.test.ts`
Expected: FAIL — `Failed to resolve import "./dialogStack"`.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/components/ui/dialog/dialogStack.ts`:

```ts
/**
 * The set of currently open dialogs, most recent last.
 *
 * This is module state rather than context because a dialog renders through a
 * portal to document.body — it can be mounted from anywhere in the tree, and
 * requiring a provider above every call site would defeat the point.
 *
 * Three things need to know about nesting. PayrollRunDetailModal is a drawer
 * that contains two further dialogs, so without a stack: Escape would close
 * both at once, the inner dialog closing would unlock scrolling while the
 * drawer is still open, and z-index would have to be hand-picked per site the
 * way it is today (z-40, z-50, z-[60]).
 */
type DialogId = symbol;

const stack: DialogId[] = [];

/** The body overflow value captured when the stack went from empty to one. */
let overflowBeforeLock: string | null = null;

const lockBodyScroll = () => {
  if (typeof document === 'undefined') return;
  overflowBeforeLock = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
};

const unlockBodyScroll = () => {
  if (typeof document === 'undefined') return;
  document.body.style.overflow = overflowBeforeLock ?? '';
  overflowBeforeLock = null;
};

export const pushDialog = (id: DialogId): void => {
  if (stack.includes(id)) return;
  stack.push(id);
  if (stack.length === 1) lockBodyScroll();
};

export const popDialog = (id: DialogId): void => {
  const index = stack.indexOf(id);
  if (index === -1) return;
  stack.splice(index, 1);
  if (stack.length === 0) unlockBodyScroll();
};

export const isTopDialog = (id: DialogId): boolean =>
  stack.length > 0 && stack[stack.length - 1] === id;

export const dialogDepth = (id: DialogId): number => stack.indexOf(id);

/** Test-only. Leaves the module in the state it has on a fresh import. */
export const resetDialogStack = (): void => {
  stack.length = 0;
  unlockBodyScroll();
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/ui/dialog/dialogStack.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/dialog/dialogStack.ts frontend/src/components/ui/dialog/dialogStack.test.ts
git commit -m "feat(ui): add dialog stack for nesting, scroll lock and z-index

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: useDialogBehavior

**Files:**
- Create: `frontend/src/components/ui/dialog/useDialogBehavior.ts`
- Test: `frontend/src/components/ui/dialog/useDialogBehavior.test.tsx`

**Interfaces:**
- Consumes: `pushDialog`, `popDialog`, `isTopDialog`, `dialogDepth` from `./dialogStack`.
- Produces:
  ```ts
  useDialogBehavior(options: UseDialogBehaviorOptions): {
    panelRef: React.RefObject<HTMLDivElement>;
    zIndex: number;
    backdropProps: { onPointerDown: React.PointerEventHandler; onPointerUp: React.PointerEventHandler };
    panelProps: { tabIndex: -1; 'aria-modal': true };
  }

  interface UseDialogBehaviorOptions {
    open: boolean;
    onClose: () => void;
    busy?: boolean;
    dismissOnBackdrop?: boolean;
    initialFocusRef?: React.RefObject<HTMLElement>;
  }
  ```

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/ui/dialog/useDialogBehavior.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { resetDialogStack } from './dialogStack';
import { useDialogBehavior } from './useDialogBehavior';

afterEach(() => {
  resetDialogStack();
});

function Dialog({
  open,
  onClose,
  busy = false,
  dismissOnBackdrop = true,
  testId = 'backdrop',
  children,
}: {
  open: boolean;
  onClose: () => void;
  busy?: boolean;
  dismissOnBackdrop?: boolean;
  testId?: string;
  children?: React.ReactNode;
}) {
  const { panelRef, backdropProps, panelProps, zIndex } = useDialogBehavior({
    open,
    onClose,
    busy,
    dismissOnBackdrop,
  });

  if (!open) return null;

  return (
    <div data-testid={testId} style={{ zIndex }} {...backdropProps}>
      <div ref={panelRef} role="dialog" aria-label="Test dialog" data-testid={`${testId}-panel`} {...panelProps}>
        {children}
      </div>
    </div>
  );
}

describe('useDialogBehavior focus', () => {
  it('moves focus to the panel rather than the first control', async () => {
    // Landing on a destructive button means a stray Enter fires it.
    render(
      <Dialog open onClose={vi.fn()}>
        <button type="button">Delete everything</button>
      </Dialog>,
    );

    expect(screen.getByTestId('backdrop-panel')).toHaveFocus();
  });

  it('returns focus to the element that was focused before opening', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button type="button" onClick={() => setOpen(true)}>
            Open
          </button>
          <Dialog open={open} onClose={() => setOpen(false)} />
        </div>
      );
    }

    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Open' });

    await user.click(trigger);
    expect(screen.getByTestId('backdrop-panel')).toHaveFocus();

    await user.keyboard('{Escape}');

    expect(trigger).toHaveFocus();
  });

  it('does not re-run the focus effect when onClose gets a new identity', async () => {
    // SlideOver hit this: callers pass inline arrows, so onClose changed on
    // every render. With onClose in the dependency array the effect re-ran on
    // each keystroke and pulled focus out of the field being typed into, so
    // only the first character ever landed.
    function Harness() {
      const [text, setText] = useState('');
      return (
        <Dialog open onClose={() => setText('')}>
          <input aria-label="Note" value={text} onChange={(event) => setText(event.target.value)} />
        </Dialog>
      );
    }

    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText('Note');

    await user.click(input);
    await user.type(input, 'hello');

    expect(input).toHaveValue('hello');
    expect(input).toHaveFocus();
  });
});

describe('useDialogBehavior keyboard', () => {
  it('closes on Escape', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Dialog open onClose={onClose} />);

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores Escape while busy so an in-flight save is not discarded', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Dialog open busy onClose={onClose} />);

    await user.keyboard('{Escape}');

    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes only the top dialog when two are open', async () => {
    const onCloseOuter = vi.fn();
    const onCloseInner = vi.fn();
    const user = userEvent.setup();

    render(
      <Dialog open onClose={onCloseOuter} testId="outer">
        <Dialog open onClose={onCloseInner} testId="inner" />
      </Dialog>,
    );

    await user.keyboard('{Escape}');

    expect(onCloseInner).toHaveBeenCalledTimes(1);
    expect(onCloseOuter).not.toHaveBeenCalled();
  });

  it('stacks z-index by depth', () => {
    render(
      <Dialog open onClose={vi.fn()} testId="outer">
        <Dialog open onClose={vi.fn()} testId="inner" />
      </Dialog>,
    );

    expect(screen.getByTestId('outer')).toHaveStyle({ zIndex: '50' });
    expect(screen.getByTestId('inner')).toHaveStyle({ zIndex: '60' });
  });

  it('cycles Tab from the last control back to the first', async () => {
    const user = userEvent.setup();
    render(
      <Dialog open onClose={vi.fn()}>
        <button type="button">First</button>
        <button type="button">Last</button>
      </Dialog>,
    );

    const first = screen.getByRole('button', { name: 'First' });
    const last = screen.getByRole('button', { name: 'Last' });

    last.focus();
    await user.tab();

    expect(first).toHaveFocus();
  });

  it('cycles Shift+Tab from the first control back to the last', async () => {
    const user = userEvent.setup();
    render(
      <Dialog open onClose={vi.fn()}>
        <button type="button">First</button>
        <button type="button">Last</button>
      </Dialog>,
    );

    const first = screen.getByRole('button', { name: 'First' });
    const last = screen.getByRole('button', { name: 'Last' });

    first.focus();
    await user.tab({ shift: true });

    expect(last).toHaveFocus();
  });
});

describe('useDialogBehavior backdrop dismissal', () => {
  it('closes when a press and release both land on the backdrop', () => {
    const onClose = vi.fn();
    render(<Dialog open onClose={onClose} />);
    const backdrop = screen.getByTestId('backdrop');

    fireEvent.pointerDown(backdrop);
    fireEvent.pointerUp(backdrop);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close when a drag starts inside the panel and ends on the backdrop', () => {
    // Selecting text in the panel and releasing outside it should not throw
    // away the dialog. stopPropagation on the panel does not cover this.
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose}>
        <p>Some text the user is selecting</p>
      </Dialog>,
    );

    fireEvent.pointerDown(screen.getByTestId('backdrop-panel'));
    fireEvent.pointerUp(screen.getByTestId('backdrop'));

    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not close on backdrop press while busy', () => {
    const onClose = vi.fn();
    render(<Dialog open busy onClose={onClose} />);
    const backdrop = screen.getByTestId('backdrop');

    fireEvent.pointerDown(backdrop);
    fireEvent.pointerUp(backdrop);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not close on backdrop press when dismissOnBackdrop is false', () => {
    const onClose = vi.fn();
    render(<Dialog open dismissOnBackdrop={false} onClose={onClose} />);
    const backdrop = screen.getByTestId('backdrop');

    fireEvent.pointerDown(backdrop);
    fireEvent.pointerUp(backdrop);

    expect(onClose).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/ui/dialog/useDialogBehavior.test.tsx`
Expected: FAIL — `Failed to resolve import "./useDialogBehavior"`.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/components/ui/dialog/useDialogBehavior.ts`:

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { dialogDepth, isTopDialog, popDialog, pushDialog } from './dialogStack';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Deliberately no offsetParent check.
 *
 * ConfirmDialog filters candidates on `el.offsetParent !== null` to skip
 * hidden controls. happy-dom returns null offsetParent for every element, so
 * that filter empties the list under test and the trap silently becomes a
 * no-op — the tests would pass against a trap that does nothing. Attribute
 * checks work identically in the browser and in the test environment, and a
 * dialog only renders its panel while open, so hidden descendants are rare.
 */
const getFocusable = (root: HTMLElement | null): HTMLElement[] => {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) =>
      !element.hasAttribute('disabled') &&
      element.getAttribute('aria-hidden') !== 'true' &&
      element.closest('[hidden]') === null,
  );
};

export interface UseDialogBehaviorOptions {
  open: boolean;
  onClose: () => void;
  /** Blocks Escape and backdrop dismissal, e.g. while a save is in flight. */
  busy?: boolean;
  dismissOnBackdrop?: boolean;
  /** Focus this instead of the panel. Use sparingly — see the effect comment. */
  initialFocusRef?: RefObject<HTMLElement>;
}

export function useDialogBehavior({
  open,
  onClose,
  busy = false,
  dismissOnBackdrop = true,
  initialFocusRef,
}: UseDialogBehaviorOptions) {
  const id = useMemo(() => Symbol('dialog'), []);
  const panelRef = useRef<HTMLDivElement>(null);
  const pressStartedOnBackdropRef = useRef(false);
  const [depth, setDepth] = useState(0);

  /*
   * onClose and busy are held in refs and kept OUT of the effect dependencies
   * below. Callers almost always pass an inline arrow, so onClose has a fresh
   * identity on every render; as a dependency it re-ran the effect on every
   * keystroke and panelRef.focus() pulled focus out of the field being typed
   * into, so only the first character landed. This is load-bearing — see
   * SlideOver's original comment.
   */
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const busyRef = useRef(busy);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    if (!open) return undefined;

    pushDialog(id);
    setDepth(dialogDepth(id));

    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Focus the panel, not the first control: landing on a "Delete" or
    // "Confirm" button makes a stray Enter destroy something.
    (initialFocusRef?.current ?? panelRef.current)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      // A nested dialog owns the keyboard while it is open.
      if (!isTopDialog(id)) return;

      if (event.key === 'Escape') {
        if (busyRef.current) return;
        event.stopPropagation();
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab') return;

      const items = getFocusable(panelRef.current);

      if (items.length === 0) {
        // Nothing to move to — keep focus on the panel rather than letting Tab
        // walk out into the page behind the dialog.
        event.preventDefault();
        panelRef.current?.focus();
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || active === panelRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      popDialog(id);
      // Without this focus lands on <body> and the next Tab restarts from the
      // top of the page rather than from the control that opened the dialog.
      previouslyFocused?.focus?.();
    };
  }, [open, id, initialFocusRef]);

  const onPointerDown = useCallback((event: ReactPointerEvent) => {
    pressStartedOnBackdropRef.current = event.target === event.currentTarget;
  }, []);

  const onPointerUp = useCallback(
    (event: ReactPointerEvent) => {
      const startedOnBackdrop = pressStartedOnBackdropRef.current;
      pressStartedOnBackdropRef.current = false;

      if (!dismissOnBackdrop || busyRef.current) return;
      // Both ends of the press must be the backdrop itself. A click alone is
      // not enough: dragging a text selection out of the panel and releasing
      // on the backdrop would otherwise discard the dialog.
      if (!startedOnBackdrop || event.target !== event.currentTarget) return;

      onCloseRef.current();
    },
    [dismissOnBackdrop],
  );

  return {
    panelRef,
    zIndex: 50 + Math.max(depth, 0) * 10,
    backdropProps: { onPointerDown, onPointerUp },
    panelProps: { tabIndex: -1 as const, 'aria-modal': true as const },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/ui/dialog/useDialogBehavior.test.tsx`
Expected: PASS, 13 tests.

If the two Tab-cycling tests fail because happy-dom's `userEvent.tab()` does not honour the DOM order, replace `await user.tab()` with
`fireEvent.keyDown(document, { key: 'Tab' })` and `fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })`. Do not weaken the assertion — the assertion is the point.

- [ ] **Step 5: Verify the gates**

Run: `npx tsc --noEmit`
Expected: no output, exit 0.

Run: `npx eslint src/components/ui/dialog --ext ts,tsx`
Expected: no output, exit 0.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ui/dialog/useDialogBehavior.ts frontend/src/components/ui/dialog/useDialogBehavior.test.tsx
git commit -m "feat(ui): add useDialogBehavior with focus trap, Escape and stack-aware dismissal

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Modal shell

**Files:**
- Create: `frontend/src/components/ui/dialog/Modal.tsx`
- Create: `frontend/src/components/ui/dialog/index.ts`
- Test: `frontend/src/components/ui/dialog/Modal.test.tsx`

**Interfaces:**
- Consumes: `useDialogBehavior` from `./useDialogBehavior`.
- Produces:
  ```ts
  interface ModalProps {
    open: boolean;
    onClose: () => void;
    /** Rendered as the dialog heading. Exactly one of title or titleId is required. */
    title?: string;
    /** Id of a heading already inside children, for panels with bespoke headers. */
    titleId?: string;
    subtitle?: string;
    size?: 'sm' | 'md' | 'lg' | 'xl';
    role?: 'dialog' | 'alertdialog';
    busy?: boolean;
    dismissOnBackdrop?: boolean;
    ariaDescribedBy?: string;
    showCloseButton?: boolean;
    footer?: ReactNode;
    children: ReactNode;
  }
  ```
  Default export `Modal`. `index.ts` re-exports `Modal`, `SlideOver`, `useDialogBehavior`.

`titleId` exists because several payroll panels have bespoke headers — an icon plus a dynamic heading in a custom flex row. Rendering `title` there would duplicate the heading, and deleting their header would violate the "panel bodies are not modified" constraint. Those files keep their header, add an `id` to its heading, and pass `titleId`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/ui/dialog/Modal.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { resetDialogStack } from './dialogStack';
import Modal from './Modal';

afterEach(() => {
  resetDialogStack();
});

describe('Modal', () => {
  it('renders nothing while closed', () => {
    render(
      <Modal open={false} onClose={vi.fn()} title="Payroll settings">
        <p>Body</p>
      </Modal>,
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('exposes a dialog with an accessible name taken from title', () => {
    render(
      <Modal open onClose={vi.fn()} title="Payroll settings">
        <p>Body</p>
      </Modal>,
    );

    expect(screen.getByRole('dialog', { name: 'Payroll settings' })).toBeInTheDocument();
  });

  it('takes its accessible name from an existing heading when given titleId', () => {
    render(
      <Modal open onClose={vi.fn()} titleId="bespoke-heading">
        <h2 id="bespoke-heading">Record as filed</h2>
      </Modal>,
    );

    expect(screen.getByRole('dialog', { name: 'Record as filed' })).toBeInTheDocument();
  });

  it('renders as an alertdialog when asked', () => {
    render(
      <Modal open role="alertdialog" onClose={vi.fn()} title="Delete run">
        <p>Body</p>
      </Modal>,
    );

    expect(screen.getByRole('alertdialog', { name: 'Delete run' })).toBeInTheDocument();
  });

  it('closes from the header close button', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Modal open onClose={onClose} title="Payroll settings">
        <p>Body</p>
      </Modal>,
    );

    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('disables the close button while busy', () => {
    render(
      <Modal open busy onClose={vi.fn()} title="Payroll settings">
        <p>Body</p>
      </Modal>,
    );

    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
  });

  it('renders the footer', () => {
    render(
      <Modal open onClose={vi.fn()} title="Payroll settings" footer={<button type="button">Save</button>}>
        <p>Body</p>
      </Modal>,
    );

    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/ui/dialog/Modal.test.tsx`
Expected: FAIL — `Failed to resolve import "./Modal"`.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/components/ui/dialog/Modal.tsx`:

```tsx
import { useId, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import { cn } from '@/utils/cn';
import { useDialogBehavior } from './useDialogBehavior';

type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

const sizeClasses: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  titleId?: string;
  subtitle?: string;
  size?: ModalSize;
  role?: 'dialog' | 'alertdialog';
  busy?: boolean;
  dismissOnBackdrop?: boolean;
  ariaDescribedBy?: string;
  showCloseButton?: boolean;
  footer?: ReactNode;
  children: ReactNode;
}

/**
 * Centered modal dialog.
 *
 * Portals to document.body so an `overflow: hidden` or transformed ancestor
 * cannot clip it, and so its z-index is comparable with every other dialog
 * rather than with whatever stacking context it happened to be rendered in.
 */
export default function Modal({
  open,
  onClose,
  title,
  titleId,
  subtitle,
  size = 'md',
  role = 'dialog',
  busy = false,
  dismissOnBackdrop = true,
  ariaDescribedBy,
  showCloseButton = true,
  footer,
  children,
}: ModalProps) {
  const generatedTitleId = useId();
  const { panelRef, backdropProps, panelProps, zIndex } = useDialogBehavior({
    open,
    onClose,
    busy,
    dismissOnBackdrop,
  });

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  const headingId = titleId ?? (title ? generatedTitleId : undefined);

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/50 p-4"
      style={{ zIndex }}
      {...backdropProps}
    >
      <SurfaceCard className={cn('w-full', sizeClasses[size])}>
        <div
          ref={panelRef}
          role={role}
          aria-labelledby={headingId}
          aria-describedby={ariaDescribedBy}
          className="flex max-h-[85vh] flex-col outline-none motion-safe:animate-dialog-in"
          {...panelProps}
        >
          {title ? (
            <div className="flex items-start gap-3 border-b border-slate-200 px-5 py-4">
              <div className="min-w-0 flex-1">
                <h2 id={headingId} className="truncate text-base font-semibold text-slate-950">
                  {title}
                </h2>
                {subtitle ? <p className="mt-0.5 truncate text-xs text-slate-500">{subtitle}</p> : null}
              </div>
              {showCloseButton ? (
                <button
                  type="button"
                  onClick={onClose}
                  disabled={busy}
                  aria-label="Close"
                  className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>

          {footer ? (
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">{footer}</div>
          ) : null}
        </div>
      </SurfaceCard>
    </div>,
    document.body,
  );
}
```

- [ ] **Step 4: Add the entry animation**

Append to `frontend/src/styles/theme.css`:

```css
/*
 * Dialog entry. Applied through motion-safe: so it is skipped entirely for
 * anyone with prefers-reduced-motion set, without a second media query here.
 */
@keyframes dialog-in {
  from {
    opacity: 0;
    transform: scale(0.98);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.animate-dialog-in {
  animation: dialog-in 120ms ease-out;
}
```

- [ ] **Step 5: Create the barrel export**

Create `frontend/src/components/ui/dialog/index.ts`:

```ts
export { default as Modal } from './Modal';
export type { ModalProps } from './Modal';
export { useDialogBehavior } from './useDialogBehavior';
export type { UseDialogBehaviorOptions } from './useDialogBehavior';
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/components/ui/dialog`
Expected: PASS, 26 tests across three files.

- [ ] **Step 7: Verify the gates**

Run: `npx tsc --noEmit` — exit 0.
Run: `npx eslint src/components/ui/dialog --ext ts,tsx` — exit 0.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/ui/dialog frontend/src/styles/theme.css
git commit -m "feat(ui): add centered Modal shell on the dialog behaviour hook

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Move SlideOver and give it the focus trap

**Files:**
- Create: `frontend/src/components/ui/dialog/SlideOver.tsx`
- Create: `frontend/src/components/ui/dialog/SlideOver.test.tsx`
- Replace: `frontend/src/features/employees/SlideOver.tsx` (becomes a re-export)
- Modify: `frontend/src/components/ui/dialog/index.ts`

**Interfaces:**
- Consumes: `useDialogBehavior`.
- Produces: default export `SlideOver` with **unchanged** props — `{ open, title, subtitle?, onClose, footer?, children }` — plus new optional `busy?: boolean` and `dismissOnBackdrop?: boolean`.

The 12 existing call sites import `SlideOver from '@/features/employees/SlideOver'`. They are not edited. The old path becomes a one-line re-export so the move is invisible to them.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/ui/dialog/SlideOver.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { resetDialogStack } from './dialogStack';
import SlideOver from './SlideOver';

afterEach(() => {
  resetDialogStack();
});

describe('SlideOver', () => {
  it('renders nothing while closed', () => {
    render(
      <SlideOver open={false} title="Employee" onClose={vi.fn()}>
        <p>Body</p>
      </SlideOver>,
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('exposes a dialog named by its title', () => {
    render(
      <SlideOver open title="Employee" onClose={vi.fn()}>
        <p>Body</p>
      </SlideOver>,
    );

    expect(screen.getByRole('dialog', { name: 'Employee' })).toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <SlideOver open title="Employee" onClose={onClose}>
        <p>Body</p>
      </SlideOver>,
    );

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps Tab inside the panel', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <button type="button">Outside</button>
        <SlideOver open title="Employee" onClose={vi.fn()}>
          <button type="button">Inside</button>
        </SlideOver>
      </div>,
    );

    const inside = screen.getByRole('button', { name: 'Inside' });
    inside.focus();
    await user.tab();

    expect(screen.getByRole('button', { name: 'Outside' })).not.toHaveFocus();
  });

  it('does not lose focus while typing, with an inline onClose', async () => {
    const user = userEvent.setup();
    render(
      <SlideOver open title="Employee" onClose={() => undefined}>
        <input aria-label="Note" />
      </SlideOver>,
    );

    const input = screen.getByLabelText('Note');
    await user.click(input);
    await user.type(input, 'abcdef');

    expect(input).toHaveValue('abcdef');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/ui/dialog/SlideOver.test.tsx`
Expected: FAIL — `Failed to resolve import "./SlideOver"`.

- [ ] **Step 3: Write the moved implementation**

Create `frontend/src/components/ui/dialog/SlideOver.tsx`:

```tsx
import { useId, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useDialogBehavior } from './useDialogBehavior';

export interface SlideOverProps {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  busy?: boolean;
  dismissOnBackdrop?: boolean;
  footer?: ReactNode;
  children: ReactNode;
}

/**
 * A right-hand drawer for detail and edit surfaces.
 *
 * The employee settings form used to render *below* the directory table, so
 * clicking "Settings" on row 30 pushed a panel in underneath and left you
 * scrolling to find it, with the row you came from now off screen. A drawer
 * keeps the list in place and the context visible.
 *
 * Moved here from features/employees/ so it shares one behaviour hook with
 * Modal; that path is now a re-export and its call sites are unchanged.
 */
export default function SlideOver({
  open,
  title,
  subtitle,
  onClose,
  busy = false,
  dismissOnBackdrop = true,
  footer,
  children,
}: SlideOverProps) {
  const titleId = useId();
  const { panelRef, backdropProps, panelProps, zIndex } = useDialogBehavior({
    open,
    onClose,
    busy,
    dismissOnBackdrop,
  });

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 flex justify-end bg-black/30"
      style={{ zIndex }}
      {...backdropProps}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-labelledby={titleId}
        className="relative flex h-full w-full max-w-lg flex-col border-l border-slate-200 bg-white shadow-modal outline-none motion-safe:animate-slide-in-right"
        {...panelProps}
      >
        <div className="flex items-start gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="truncate text-base font-bold tracking-[-0.02em] text-slate-950">
              {title}
            </h2>
            {subtitle ? <p className="mt-0.5 truncate text-xs text-slate-500">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">{footer}</div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
```

The previous version rendered the backdrop as a full-size `<button aria-label="Close panel">`. That is dropped: the backdrop is now dismissed through `backdropProps`, and a focusable full-screen button inside a focus trap is a control the user has to Tab past to reach the content.

- [ ] **Step 4: Replace the old path with a re-export**

Replace the entire contents of `frontend/src/features/employees/SlideOver.tsx` with:

```tsx
/**
 * Moved to components/ui/dialog/SlideOver so it shares one behaviour hook with
 * Modal. Re-exported here because 12 call sites import this path; new code
 * should import from '@/components/ui/dialog'.
 */
export { default } from '@/components/ui/dialog/SlideOver';
export type { SlideOverProps } from '@/components/ui/dialog/SlideOver';
```

- [ ] **Step 5: Extend the barrel export**

Add to `frontend/src/components/ui/dialog/index.ts`:

```ts
export { default as SlideOver } from './SlideOver';
export type { SlideOverProps } from './SlideOver';
```

- [ ] **Step 6: Confirm `animate-slide-in-right` exists**

Run: `grep -rn "slide-in-right" frontend/src/styles frontend/tailwind.config.js`
Expected: at least one definition. If the grep returns nothing, add to `frontend/src/styles/theme.css`:

```css
@keyframes slide-in-right {
  from {
    transform: translateX(16px);
    opacity: 0;
  }
  to {
    transform: none;
    opacity: 1;
  }
}

.animate-slide-in-right {
  animation: slide-in-right 140ms ease-out;
}
```

- [ ] **Step 7: Run the affected suites**

Run: `npx vitest run src/components/ui/dialog src/features src/pages/Attendance.test.tsx`
Expected: the five new SlideOver tests PASS. Existing failures must match names already in `.github/baselines/vitest.txt` — no new names.

- [ ] **Step 8: Verify the gates**

Run: `npx tsc --noEmit` — exit 0.
Run: `npx eslint src --ext ts,tsx` — exit 0.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/ui/dialog frontend/src/features/employees/SlideOver.tsx frontend/src/styles/theme.css
git commit -m "refactor(ui): move SlideOver onto the shared dialog hook, add focus trap

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Rebuild ConfirmDialog on Modal

**Files:**
- Modify: `frontend/src/components/ui/ConfirmDialog.tsx` (whole file)
- Create: `frontend/src/components/ui/ConfirmDialog.test.tsx`

**Interfaces:**
- Consumes: `Modal` from `@/components/ui/dialog`.
- Produces: `ConfirmDialog` with **identical props** to today — `{ isOpen, title, message, confirmLabel?, cancelLabel?, tone?, onConfirm, onClose, isLoading? }`. No call site changes.

Note the prop is `isOpen`, not `open`, and `isLoading`, not `busy`. Keep both names exactly as they are — 14 call sites depend on them.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/ui/ConfirmDialog.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { resetDialogStack } from '@/components/ui/dialog/dialogStack';
import ConfirmDialog from './ConfirmDialog';

afterEach(() => {
  resetDialogStack();
});

const baseProps = {
  isOpen: true,
  title: 'Delete payroll run',
  message: 'This cannot be undone.',
  onConfirm: vi.fn(),
  onClose: vi.fn(),
};

describe('ConfirmDialog', () => {
  it('renders as an alertdialog named by its title', () => {
    render(<ConfirmDialog {...baseProps} />);

    expect(screen.getByRole('alertdialog', { name: 'Delete payroll run' })).toBeInTheDocument();
  });

  it('does not put initial focus on the confirm button', () => {
    // A focused destructive button turns a stray Enter into a deletion.
    render(<ConfirmDialog {...baseProps} tone="danger" confirmLabel="Delete" />);

    expect(screen.getByRole('button', { name: 'Delete' })).not.toHaveFocus();
  });

  it('calls onConfirm from the confirm button', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<ConfirmDialog {...baseProps} onConfirm={onConfirm} confirmLabel="Delete" />);

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('ignores Escape while loading', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ConfirmDialog {...baseProps} onClose={onClose} isLoading />);

    await user.keyboard('{Escape}');

    expect(onClose).not.toHaveBeenCalled();
  });

  it('renders nothing when closed', () => {
    render(<ConfirmDialog {...baseProps} isOpen={false} />);

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/ui/ConfirmDialog.test.tsx`
Expected: FAIL — the first test fails because the current implementation renders the alertdialog but the `resetDialogStack` import does not resolve until Task 1 is merged (it is), and `not.toHaveFocus()` currently passes. Confirm which assertions fail and why before continuing; if all five pass against the old implementation, the rebuild is still required but the tests are then a regression guard.

- [ ] **Step 3: Rewrite the implementation**

Replace the entire contents of `frontend/src/components/ui/ConfirmDialog.tsx`:

```tsx
import { AlertTriangle, Loader2 } from 'lucide-react';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/dialog/Modal';
import { cn } from '@/utils/cn';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'default';
  onConfirm: () => void;
  onClose: () => void;
  isLoading?: boolean;
}

/**
 * Confirmation for destructive actions.
 *
 * The focus trap, Escape handling and focus restore that used to live here now
 * come from Modal; the props are unchanged so the 14 call sites are unaffected.
 * `role="alertdialog"` is kept — this interrupts the user rather than offering
 * an optional surface.
 */
export default function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  onConfirm,
  onClose,
  isLoading = false,
}: ConfirmDialogProps) {
  const isDanger = tone === 'danger';

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title={title}
      role="alertdialog"
      size="md"
      busy={isLoading}
      ariaDescribedBy="confirm-dialog-message"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isLoading}>
            {cancelLabel}
          </Button>
          <Button
            variant={isDanger ? 'danger' : 'primary'}
            onClick={onConfirm}
            disabled={isLoading}
            iconLeft={isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex items-start gap-3 px-5 py-5">
        <div
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
            isDanger ? 'bg-rose-100 text-rose-600' : 'bg-blue-500/10 text-blue-600',
          )}
        >
          <AlertTriangle className="h-5 w-5" />
        </div>
        <p id="confirm-dialog-message" className="text-sm text-slate-600">
          {message}
        </p>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/ui`
Expected: PASS, including the five new ConfirmDialog tests.

- [ ] **Step 5: Run the suites that use ConfirmDialog**

Run: `npx vitest run`
Expected: failing test names identical to `.github/baselines/vitest.txt`. Diff the names; do not compare counts.

- [ ] **Step 6: Verify the gates**

Run: `npx tsc --noEmit` — exit 0.
Run: `npx eslint src --ext ts,tsx` — exit 0.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/ui/ConfirmDialog.tsx frontend/src/components/ui/ConfirmDialog.test.tsx
git commit -m "refactor(ui): rebuild ConfirmDialog on Modal, props unchanged

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

**STOP HERE for review.** The primitive is complete and independently verifiable. Tasks 6-10 touch payroll screens and should not start until this is reviewed.

---

## Migration pattern (Tasks 6-10)

Every migration is the same four edits. This is the worked example; the per-file tables that follow give the exact line and title for each.

**Before** — `components/payroll/AddEmployeeToPayGroupModal.tsx:92`:

```tsx
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <SurfaceCard className="w-full max-w-lg">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-blue-600" />
            Add employees
          </h2>
          <button onClick={onClose} className="..."><X className="h-4 w-4" /></button>
        </div>
        {/* ...body... */}
      </SurfaceCard>
    </div>
  );
```

**After**:

```tsx
  return (
    <Modal open onClose={onClose} titleId="add-employee-to-paygroup-title" size="lg">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <h2 id="add-employee-to-paygroup-title" className="text-lg font-semibold text-slate-900 flex items-center gap-2">
          <UserPlus className="h-5 w-5 text-blue-600" />
          Add employees
        </h2>
        <button onClick={onClose} className="..."><X className="h-4 w-4" /></button>
      </div>
      {/* ...body, byte-for-byte unchanged... */}
    </Modal>
  );
```

The four edits:

1. Delete the `fixed inset-0` wrapper div and the `SurfaceCard` immediately inside it. `Modal` provides both.
2. Add `import Modal from '@/components/ui/dialog/Modal';` (or `SlideOver`). Remove the `SurfaceCard` import if nothing else in the file uses it — `tsc` will tell you.
3. Add an `id` to the existing heading and pass it as `titleId`. Only use `title` where the panel has no heading of its own, in which case `Modal` renders one.
4. Delete any `onClick={(e) => e.stopPropagation()}` on the panel and any `onClick={onClose}` on the old backdrop. `backdropProps` replaces both.

**Rules that apply to every file:**

- Do not touch the panel body. If a diff line is not one of the four edits above, revert it.
- Where the component already tracks a submitting/saving state, pass it as `busy`.
- Where the old overlay had no backdrop-click dismissal, pass `dismissOnBackdrop={false}` to preserve the current behaviour. Do not add dismissal the screen did not have.
- Keep the existing header close button. It is inside the panel, so `Modal`'s own `showCloseButton` is not used when `titleId` is passed.

**Test to add for each migrated file** — one per overlay, in a co-located `*.test.tsx`:

```tsx
it('renders the <name> overlay as a named dialog', () => {
  render(<Component {...requiredProps} />);

  expect(screen.getByRole('dialog', { name: /<heading text>/i })).toBeInTheDocument();
});
```

---

### Task 6: Simple centered payroll modals

**Files:**
- Modify: `frontend/src/components/payroll/PayrollSettingsModal.tsx:101`
- Modify: `frontend/src/components/payroll/SalaryStructureFormModal.tsx:140`
- Modify: `frontend/src/components/payroll/AddEmployeeToPayGroupModal.tsx:92`
- Modify: `frontend/src/components/payroll/PayGroupModal.tsx:225`
- Test: `frontend/src/components/payroll/payrollDialogs.test.tsx` (one file covering all four)

**Interfaces:**
- Consumes: `Modal` from `@/components/ui/dialog/Modal`.
- Produces: nothing consumed by later tasks.

| File | Line | Size | Title source |
|---|---|---|---|
| `PayrollSettingsModal.tsx` | 101 | `lg` | no heading in the wrapper — pass `title="Payroll settings"` |
| `SalaryStructureFormModal.tsx` | 140 | `lg` | existing `<h3>` — add `id="salary-structure-form-title"`, pass `titleId` |
| `AddEmployeeToPayGroupModal.tsx` | 92 | `lg` | existing `<h2>` — add `id="add-employee-to-paygroup-title"`, pass `titleId` |
| `PayGroupModal.tsx` | 225 | `lg` | existing `<h2>` — add `id="pay-group-modal-title"`, pass `titleId` |

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/components/payroll/payrollDialogs.test.tsx` with one `it` per file, following the per-file test pattern above. Read each component's props first and pass the minimum required set; mock `@/services/api` with `vi.mock('@/services/api', () => ({ /* the named exports the file imports */ }))` so no network call is attempted.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/payroll/payrollDialogs.test.tsx`
Expected: FAIL — `Unable to find an accessible element with the role "dialog"`.

- [ ] **Step 3: Apply the migration pattern to all four files**

Follow the four edits in the migration pattern section, using the table above for size and title source.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/payroll/payrollDialogs.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 5: Verify no visual regression in the diff**

Run: `git diff --stat`
Expected: four files, and the deleted lines should be the wrapper, the `SurfaceCard` open/close tags and any `stopPropagation`. If a diff shows changes inside a panel body, revert that hunk.

- [ ] **Step 6: Verify the gates**

Run: `npx tsc --noEmit` — exit 0.
Run: `npx eslint src --ext ts,tsx` — exit 0.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/payroll
git commit -m "refactor(payroll): move four settings modals onto Modal

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Inline payroll dialogs

**Files:**
- Modify: `frontend/src/components/payroll/FbpDashboard.tsx:123`
- Modify: `frontend/src/components/payroll/StopPaymentFlags.tsx:187,261,361`
- Modify: `frontend/src/components/payroll/EmployeePickerList.tsx:142`
- Modify: `frontend/src/components/payroll/FilingsDashboard.tsx:1258`
- Test: `frontend/src/components/payroll/payrollInlineDialogs.test.tsx`

**Interfaces:**
- Consumes: `Modal`.
- Produces: nothing consumed by later tasks.

These are dialogs declared inline inside a larger component, guarded by a state check such as `{markFiledFor !== null && (...)}`. The guard stays exactly where it is; `Modal` receives `open` from it, or the guard wraps `<Modal open ...>` unchanged — either is fine, but be consistent within a file.

| File | Line | Size | Title |
|---|---|---|---|
| `FbpDashboard.tsx` | 123 | `md` | existing `<h3>Allocate FBP Component</h3>` — add `id="fbp-allocate-title"` |
| `StopPaymentFlags.tsx` | 187 | `md` | read the heading at that line; add an id and pass `titleId` |
| `StopPaymentFlags.tsx` | 261 | `md` | read the heading at that line; add an id and pass `titleId` |
| `StopPaymentFlags.tsx` | 361 | `md` | read the heading at that line; add an id and pass `titleId` |
| `EmployeePickerList.tsx` | 142 | `lg` | existing `<h2>` — add `id="employee-picker-title"` |
| `FilingsDashboard.tsx` | 1258 | `md` | existing `<h3>Record as Filed</h3>` — add `id="record-as-filed-title"` |

`FilingsDashboard:1258` currently dismisses on backdrop click via `onClick={() => setMarkFiledFor(null)}`. Keep that behaviour: leave `dismissOnBackdrop` at its default and pass `onClose={() => setMarkFiledFor(null)}`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/components/payroll/payrollInlineDialogs.test.tsx`, one `it` per overlay (6 total). For the inline dialogs, render the parent component and drive it to the state that opens the dialog with `userEvent`, or set the state through the props the parent exposes. If a dialog cannot be reached without a network response, mock `@/services/api` to resolve the minimum payload.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/payroll/payrollInlineDialogs.test.tsx`
Expected: FAIL — no accessible dialog.

- [ ] **Step 3: Apply the migration pattern**

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/payroll/payrollInlineDialogs.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 5: Verify the gates**

Run: `npx tsc --noEmit` — exit 0.
Run: `npx eslint src --ext ts,tsx` — exit 0.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/payroll
git commit -m "refactor(payroll): move six inline dialogs onto Modal

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Large payroll modals and the help drawer

**Files:**
- Modify: `frontend/src/components/payroll/ProcessAndPayModal.tsx:638`
- Modify: `frontend/src/components/payroll/PayrollReportsModal.tsx:245`
- Modify: `frontend/src/components/payroll/UploadForm16Modal.tsx:138`
- Modify: `frontend/src/components/payroll/HelpDrawer.tsx:36`
- Test: `frontend/src/components/payroll/payrollLargeDialogs.test.tsx`

**Interfaces:**
- Consumes: `Modal`, `SlideOver`.
- Produces: nothing consumed by later tasks.

| File | Line | Shell | Notes |
|---|---|---|---|
| `ProcessAndPayModal.tsx` | 638 | `Modal` size `xl` | Pass the component's existing submitting state as `busy`. This dialog triggers a payroll disbursement — a stray Escape mid-submit must not close it. |
| `PayrollReportsModal.tsx` | 245 | `Modal` size `xl` | Existing `<h2>Payroll Reports</h2>` — add `id="payroll-reports-title"`. |
| `UploadForm16Modal.tsx` | 138 | `Modal` size `xl` | Wrapper is `fixed inset-0 z-50 flex` with no centering; check whether the panel is full-height. If it is a drawer, use `SlideOver` instead and say so in the commit message. |
| `HelpDrawer.tsx` | 36 | `SlideOver` | Wrapper is `z-40 flex justify-end` — a drawer. Its `z-40` is replaced by stack-derived z-index; confirm it still sits above page chrome. |

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/components/payroll/payrollLargeDialogs.test.tsx`, one `it` per file. Add a second test for `ProcessAndPayModal`:

```tsx
it('does not close on Escape while a disbursement is submitting', async () => {
  const onClose = vi.fn();
  const user = userEvent.setup();
  render(<ProcessAndPayModal {...propsThatPutItInSubmittingState} onClose={onClose} />);

  await user.keyboard('{Escape}');

  expect(onClose).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/payroll/payrollLargeDialogs.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Apply the migration pattern**

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/payroll/payrollLargeDialogs.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 5: Verify the gates**

Run: `npx tsc --noEmit` — exit 0.
Run: `npx eslint src --ext ts,tsx` — exit 0.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/payroll
git commit -m "refactor(payroll): move process-and-pay, reports, form16 and help onto the dialog shells

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: PayrollRunDetailModal — the nesting case

**Files:**
- Modify: `frontend/src/components/payroll/PayrollRunDetailModal.tsx:307,1063,1119` and the fourth overlay in the same file
- Test: `frontend/src/components/payroll/PayrollRunDetailModal.test.tsx`

**Interfaces:**
- Consumes: `Modal`, `SlideOver`.
- Produces: nothing consumed by later tasks.

This is the file the stack exists for. Line 307 is a right drawer at `z-50`; lines 1063 and 1119 are centered dialogs at `z-[60]` rendered inside it. After migration all three take their z-index from stack depth, so the hardcoded `z-[60]` is deleted, not translated.

- [ ] **Step 1: Locate the fourth overlay**

Run: `grep -n "fixed inset-0" frontend/src/components/payroll/PayrollRunDetailModal.tsx`
Record all four line numbers before editing; the later ones shift as you edit the earlier ones. Work bottom-up.

- [ ] **Step 2: Write the failing test**

Create `frontend/src/components/payroll/PayrollRunDetailModal.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { resetDialogStack } from '@/components/ui/dialog/dialogStack';
import PayrollRunDetailModal from './PayrollRunDetailModal';

afterEach(() => {
  resetDialogStack();
});

describe('PayrollRunDetailModal', () => {
  it('renders the run drawer as a named dialog', () => {
    render(<PayrollRunDetailModal {...requiredProps} />);

    expect(screen.getByRole('dialog', { name: /run #/i })).toBeInTheDocument();
  });

  it('closes only the nested dialog on Escape, leaving the run drawer open', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<PayrollRunDetailModal {...requiredProps} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: /<the control that opens the nested dialog>/i }));
    expect(screen.getAllByRole('dialog')).toHaveLength(2);

    await user.keyboard('{Escape}');

    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(onClose).not.toHaveBeenCalled();
  });
});
```

Fill in `requiredProps` and the nested-dialog control name from the component; both are readable from its props interface and JSX.

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/components/payroll/PayrollRunDetailModal.test.tsx`
Expected: FAIL — no dialog role.

- [ ] **Step 4: Apply the migration pattern bottom-up**

Line 307 becomes `SlideOver` (or `Modal` with a drawer layout if the panel is a `SurfaceCard` with `animate-slide-in-right` — prefer `SlideOver`). The nested ones become `Modal` size `md`, with their `z-[60]` deleted.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/components/payroll/PayrollRunDetailModal.test.tsx`
Expected: PASS, 2 tests. The second one is the whole reason `dialogStack` exists — if it fails, the bug is in the stack, not in this file.

- [ ] **Step 6: Verify the gates**

Run: `npx tsc --noEmit` — exit 0.
Run: `npx eslint src --ext ts,tsx` — exit 0.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/payroll/PayrollRunDetailModal.tsx frontend/src/components/payroll/PayrollRunDetailModal.test.tsx
git commit -m "refactor(payroll): move run detail drawer and its nested dialogs onto the stack

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Payroll page-level overlays

**Files:**
- Modify: `frontend/src/pages/payroll/PayGroupSettings.tsx:1159,1225`
- Modify: `frontend/src/pages/payroll/SalaryStructureTemplates.tsx:534`
- Test: `frontend/src/pages/payroll/payrollPageDialogs.test.tsx`

**Interfaces:**
- Consumes: `Modal`.
- Produces: nothing consumed by later tasks.

All three use the older `bg-black bg-opacity-50` backdrop rather than `bg-black/50`. `Modal` supplies `bg-black/50`; that opacity change is the one expected visual difference.

Edit bottom-up within `PayGroupSettings.tsx` so line 1159 does not shift before you reach it.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/pages/payroll/payrollPageDialogs.test.tsx`, one `it` per overlay (3 total), driving each page to the state that opens its dialog. Mock `@/services/api`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/pages/payroll/payrollPageDialogs.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Apply the migration pattern**

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/pages/payroll/payrollPageDialogs.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 5: Verify the gates**

Run: `npx tsc --noEmit` — exit 0.
Run: `npx eslint src --ext ts,tsx` — exit 0.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/payroll
git commit -m "refactor(payroll): move pay group and salary template dialogs onto Modal

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Final verification

**Files:**
- Create: `docs/superpowers/plans/2026-08-12-dialog-primitive-remaining.md`

- [ ] **Step 1: Confirm every payroll overlay is migrated**

Run: `grep -rn "fixed inset-0" frontend/src/components/payroll frontend/src/pages/payroll`
Expected: no output. Any remaining hit is a missed overlay — migrate it before continuing.

- [ ] **Step 2: Confirm the dialog semantics landed**

Run: `grep -rlc "role=\"dialog\"\|role=\"alertdialog\"" frontend/src/components/ui/dialog`
Expected: `Modal.tsx` and `SlideOver.tsx`.

- [ ] **Step 3: Run the full suite and diff by name**

Run: `npx vitest run 2>&1 | tee /tmp/vitest-after.txt`

Extract the failing test names and compare against `.github/baselines/vitest.txt`. Expected: the same 57 names, no additions. If a name was added, fix it. If a name was *removed* because a migration fixed a previously failing test, regenerate the baseline and commit it in the same commit, with the reason in the message.

- [ ] **Step 4: Run the remaining gates**

Run: `npx tsc --noEmit` — exit 0.
Run: `npx eslint src --ext ts,tsx` — exit 0.
Run: `npm run build` — succeeds.

- [ ] **Step 5: Record what is left**

Create `docs/superpowers/plans/2026-08-12-dialog-primitive-remaining.md` listing every file still containing `fixed inset-0` outside `components/ui/dialog`, produced by:

```bash
grep -rl "fixed inset-0" frontend/src --include=*.tsx | grep -v "components/ui/dialog"
```

State for each whether it is a modal dialog (migrate later) or a non-modal surface such as `CursorSpotlight`, `SidebarDrawer` or `CommandBar` (adopt the hook only, or leave).

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/plans/2026-08-12-dialog-primitive-remaining.md
git commit -m "docs: record the overlays remaining after the payroll tranche

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Self-review notes

- **Spec coverage:** stack (Task 1), hook with all 8 behaviour rules (Task 2), Modal (Task 3), SlideOver move + shim (Task 4), ConfirmDialog rebuild (Task 5), 21 payroll overlays across 15 files (Tasks 6-10), verification and remaining-work record (Task 11). The spec's "out of scope" items appear in no task, as intended.
- **Naming consistency:** `pushDialog` / `popDialog` / `isTopDialog` / `dialogDepth` / `resetDialogStack` are used identically in Tasks 1, 2, 5 and 9. `panelRef` / `backdropProps` / `panelProps` / `zIndex` are used identically in Tasks 2, 3 and 4. `ConfirmDialog` keeps `isOpen` and `isLoading`; `Modal` and `SlideOver` use `open` and `busy`. That inconsistency is deliberate and stated in Task 5 — renaming would touch 14 call sites for no behavioural gain.
- **Known soft spot:** Tasks 6-10 say "read the heading at that line" for a few titles rather than quoting it. Those headings are dynamic (`Run #{run?.id}`) or were not readable from the audit greps. The pattern for what to do is fully specified; only the literal string is deferred to the file.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { isTopDialog, registerDialog, unregisterDialog } from './dialogStack';

/**
 * Nesting depth of the dialog currently being rendered; -1 outside any dialog.
 *
 * Context rather than registration order because React runs child effects
 * before parent effects — a dialog nested inside another registers first, so
 * anything derived from registration order has the nesting backwards. Context
 * follows the React tree, which is the relationship that actually matters, and
 * it survives the portal because portals preserve context.
 *
 * Shells wrap their children in DialogDepthProvider so a dialog opened from
 * inside a dialog knows it is deeper.
 */
const DialogDepthContext = createContext(-1);

export const DialogDepthProvider = DialogDepthContext.Provider;

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
 * ConfirmDialog filtered candidates on `el.offsetParent !== null` to skip
 * hidden controls. happy-dom returns null offsetParent for every element, so
 * that filter empties the list under test and the trap silently becomes a
 * no-op — the tests would pass against a trap that does nothing. Attribute
 * checks behave identically in the browser and in the test environment, and a
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
  const depth = useContext(DialogDepthContext) + 1;

  /*
   * onClose and busy are held in refs and kept OUT of the effect dependencies
   * below. Callers almost always pass an inline arrow, so onClose has a fresh
   * identity on every render; as a dependency it re-ran the effect on every
   * keystroke and panelRef.focus() pulled focus out of the field being typed
   * into, so only the first character landed. This is load-bearing — it is the
   * bug SlideOver's original comment records.
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

    registerDialog(id, depth);

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
      unregisterDialog(id);
      // Without this focus lands on <body> and the next Tab restarts from the
      // top of the page rather than from the control that opened the dialog.
      previouslyFocused?.focus?.();
    };
  }, [open, id, depth, initialFocusRef]);

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
    depth,
    zIndex: 50 + Math.max(depth, 0) * 10,
    backdropProps: { onPointerDown, onPointerUp },
    panelProps: { tabIndex: -1 as const, 'aria-modal': true as const },
  };
}

/**
 * The set of currently open dialogs.
 *
 * This is module state rather than context because a dialog renders through a
 * portal to document.body — it can be mounted from anywhere in the tree, and
 * requiring a provider above every call site would defeat the point.
 *
 * Two things need to know about nesting. PayrollRunDetailModal is a drawer
 * that contains two further dialogs, so without this: Escape would close both
 * at once, and the inner dialog closing would unlock page scrolling while the
 * drawer is still open.
 *
 * Which dialog is "top" is decided by NESTING DEPTH, not registration order.
 * React runs child effects before parent effects, so a dialog rendered inside
 * another one registers FIRST — ordering by registration reports the outer
 * dialog as top, which is backwards. Depth is supplied by the caller from
 * React context (see useDialogBehavior), so it reflects tree position rather
 * than effect timing. Registration order only breaks ties between siblings at
 * the same depth, where the most recently opened one wins.
 */
type DialogId = symbol;

interface DialogEntry {
  id: DialogId;
  depth: number;
}

const stack: DialogEntry[] = [];

/**
 * Subscribers notified whenever the stack changes.
 *
 * Ambient floating UI needs this. The AI chat bubble sits at z-[100] and every
 * dialog starts at z-index 50, so the bubble covered the bottom-right corner of
 * every drawer — which is exactly where the footer's primary button lives. It
 * sat on top of "Save settings". The bubble subscribes and hides itself while
 * anything modal is open rather than the two fighting over z-index.
 */
const listeners = new Set<() => void>();

const emit = (): void => {
  for (const listener of listeners) listener();
};

export const subscribeDialogStack = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

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

export const registerDialog = (id: DialogId, depth: number): void => {
  if (stack.some((entry) => entry.id === id)) return;
  stack.push({ id, depth });
  if (stack.length === 1) lockBodyScroll();
  emit();
};

export const unregisterDialog = (id: DialogId): void => {
  const index = stack.findIndex((entry) => entry.id === id);
  if (index === -1) return;
  stack.splice(index, 1);
  if (stack.length === 0) unlockBodyScroll();
  emit();
};

export const isTopDialog = (id: DialogId): boolean => {
  if (stack.length === 0) return false;

  // `>=` rather than `>` so that among equal depths the last registered wins.
  let top = stack[0];
  for (const entry of stack) {
    if (entry.depth >= top.depth) top = entry;
  }

  return top.id === id;
};

export const openDialogCount = (): number => stack.length;

/** Test-only. Leaves the module in the state it has on a fresh import. */
export const resetDialogStack = (): void => {
  stack.length = 0;
  unlockBodyScroll();
  emit();
};

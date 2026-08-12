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
};

export const unregisterDialog = (id: DialogId): void => {
  const index = stack.findIndex((entry) => entry.id === id);
  if (index === -1) return;
  stack.splice(index, 1);
  if (stack.length === 0) unlockBodyScroll();
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
};

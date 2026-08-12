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

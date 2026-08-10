/**
 * At most one rail overlay on screen at a time.
 *
 * The rail has two kinds — the tooltip on leaf items and the flyout on groups —
 * and each instance owns its own state. Without a shared claim, hovering a
 * group while a leaf item still holds keyboard focus puts a panel and a tooltip
 * on screen together. Whoever opens last closes whoever was open before.
 */

let closeActive: (() => void) | null = null;

/** Take the slot, closing the previous holder. */
export function claimOverlay(close: () => void): void {
  if (closeActive && closeActive !== close) closeActive();
  closeActive = close;
}

/** Give the slot back — on close, or on unmount while open. */
export function releaseOverlay(close: () => void): void {
  if (closeActive === close) closeActive = null;
}

/** Close whatever is open, if anything. Used when the rail itself changes shape. */
export function closeAnyOverlay(): void {
  closeActive?.();
}

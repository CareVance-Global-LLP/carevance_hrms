import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useAnchoredMenu from './useAnchoredMenu';

const VIEWPORT = { w: 1000, h: 800 };

/**
 * A stand-in for the trigger button. happy-dom gives every element a zero rect,
 * so the anchor's geometry has to be supplied explicitly — that geometry is the
 * whole input to the hook.
 */
const anchorAt = (rect: { top: number; bottom: number; left: number; right: number }) => {
  const el = document.createElement('button');
  el.getBoundingClientRect = () => ({
    ...rect,
    width: rect.right - rect.left,
    height: rect.bottom - rect.top,
    x: rect.left,
    y: rect.top,
    toJSON: () => ({}),
  }) as DOMRect;
  return { current: el };
};

beforeEach(() => {
  window.innerWidth = VIEWPORT.w;
  window.innerHeight = VIEWPORT.h;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useAnchoredMenu placement', () => {
  it('right-aligns the menu to the anchor', () => {
    const anchor = anchorAt({ top: 100, bottom: 128, left: 472, right: 500 });

    const { result } = renderHook(() => useAnchoredMenu(anchor, true, { width: 200 }));

    // Right edge of a 200px menu at left 300 lands on the anchor's right edge.
    expect(result.current.style).toMatchObject({ position: 'fixed', left: 300, width: 200 });
  });

  it('left-aligns when asked', () => {
    const anchor = anchorAt({ top: 100, bottom: 128, left: 472, right: 500 });

    const { result } = renderHook(() => useAnchoredMenu(anchor, true, { width: 200, align: 'left' }));

    expect(result.current.style).toMatchObject({ left: 472 });
  });

  it('clamps to the viewport rather than overflowing the right edge', () => {
    const anchor = anchorAt({ top: 100, bottom: 128, left: 972, right: 1000 });

    const { result } = renderHook(() => useAnchoredMenu(anchor, true, { width: 200 }));

    // Naive right-alignment gives 800, which would end flush against the edge.
    expect(result.current.style?.left).toBe(792);
  });

  it('clamps to the left edge when the anchor sits near x=0', () => {
    const anchor = anchorAt({ top: 100, bottom: 128, left: 4, right: 32 });

    const { result } = renderHook(() => useAnchoredMenu(anchor, true, { width: 200 }));

    // Right-alignment gives -168; the menu is pushed to the 8px gutter instead.
    expect(result.current.style?.left).toBe(8);
  });

  it('opens below the anchor when there is room', () => {
    const anchor = anchorAt({ top: 100, bottom: 128, left: 472, right: 500 });

    const { result } = renderHook(() => useAnchoredMenu(anchor, true, { width: 200 }));

    expect(result.current.style).toMatchObject({ top: 134 });
    expect(result.current.style).not.toHaveProperty('bottom');
  });

  it('flips above the anchor when the space below cannot hold it', () => {
    const anchor = anchorAt({ top: 750, bottom: 778, left: 472, right: 500 });

    const { result } = renderHook(() => useAnchoredMenu(anchor, true, { width: 200 }));

    // 800 - 750 + 6: the menu's bottom sits one gap above the anchor's top.
    expect(result.current.style).toMatchObject({ bottom: 56 });
    expect(result.current.style).not.toHaveProperty('top');
  });

  it('leaves overflow alone when the menu fits', () => {
    const anchor = anchorAt({ top: 100, bottom: 128, left: 472, right: 500 });

    const { result } = renderHook(() => useAnchoredMenu(anchor, true, { width: 200 }));

    /*
     * `overflow-y: auto` computes overflow-x to auto as well, which would clip
     * DepartmentBoard's sideways "Move to department" flyout. The cap is only
     * for a menu that genuinely does not fit.
     */
    expect(result.current.style).not.toHaveProperty('overflowY');
    expect(result.current.style).not.toHaveProperty('maxHeight');
  });

  it('caps the height only when the menu cannot fit either way', () => {
    // A short viewport: 82px below the anchor and 90 above, so the 180px
    // estimate fits on neither side and the menu has to scroll.
    window.innerHeight = 200;
    const anchor = anchorAt({ top: 90, bottom: 118, left: 472, right: 500 });

    const { result } = renderHook(() => useAnchoredMenu(anchor, true, { width: 200 }));

    expect(result.current.style).toMatchObject({ overflowY: 'auto' });
    expect(Number(result.current.style?.maxHeight)).toBeGreaterThan(0);
  });

  it('produces no style while closed', () => {
    const anchor = anchorAt({ top: 100, bottom: 128, left: 472, right: 500 });

    const { result } = renderHook(() => useAnchoredMenu(anchor, false, { width: 200 }));

    expect(result.current.style).toBeNull();
  });
});

describe('useAnchoredMenu dismissal', () => {
  it('dismisses when the anchor has scrolled out of view', () => {
    // Scrolled off to the left of the viewport — the roster and the board both
    // hold their triggers inside a horizontally scrolling strip.
    const anchor = anchorAt({ top: 100, bottom: 128, left: -220, right: -192 });
    const onDismiss = vi.fn();

    renderHook(() => useAnchoredMenu(anchor, true, { width: 200, onDismiss }));

    expect(onDismiss).toHaveBeenCalled();
  });

  it('does not dismiss while the anchor is still visible', () => {
    const anchor = anchorAt({ top: 100, bottom: 128, left: 472, right: 500 });
    const onDismiss = vi.fn();

    renderHook(() => useAnchoredMenu(anchor, true, { width: 200, onDismiss }));

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('repositions on a scroll anywhere in the page', () => {
    const rect = { top: 100, bottom: 128, left: 472, right: 500 };
    const anchor = anchorAt(rect);

    const { result } = renderHook(() => useAnchoredMenu(anchor, true, { width: 200 }));
    expect(result.current.style?.left).toBe(300);

    // The strip scrolls, so the trigger moves without the window scrolling —
    // only a capture-phase listener sees it.
    rect.left = 272;
    rect.right = 300;
    act(() => {
      document.dispatchEvent(new Event('scroll'));
    });

    expect(result.current.style?.left).toBe(100);
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import {
  isTopDialog,
  openDialogCount,
  registerDialog,
  resetDialogStack,
  subscribeDialogStack,
  unregisterDialog,
} from './dialogStack';

afterEach(() => {
  resetDialogStack();
});

describe('dialogStack scroll lock', () => {
  it('locks body scroll when the first dialog opens', () => {
    document.body.style.overflow = 'auto';

    registerDialog(Symbol('a'), 0);

    expect(document.body.style.overflow).toBe('hidden');
  });

  it('restores the pre-lock overflow only when the last dialog closes', () => {
    document.body.style.overflow = 'auto';
    const outer = Symbol('outer');
    const inner = Symbol('inner');

    registerDialog(outer, 0);
    registerDialog(inner, 1);
    unregisterDialog(inner);

    // The outer dialog is still open, so the page behind it must stay locked.
    expect(document.body.style.overflow).toBe('hidden');

    unregisterDialog(outer);

    expect(document.body.style.overflow).toBe('auto');
  });

  it('ignores a duplicate registration of the same dialog', () => {
    const a = Symbol('a');

    registerDialog(a, 0);
    registerDialog(a, 0);

    expect(openDialogCount()).toBe(1);

    unregisterDialog(a);

    expect(document.body.style.overflow).toBe('');
  });

  it('ignores unregistering a dialog that was never registered', () => {
    expect(() => unregisterDialog(Symbol('ghost'))).not.toThrow();
  });
});

describe('dialogStack subscription', () => {
  it('notifies subscribers as the stack opens and empties', () => {
    // The AI help bubble hides itself off this signal; without a notification
    // on register it stays pinned over the dialog's footer button.
    const seen: number[] = [];
    const unsubscribe = subscribeDialogStack(() => seen.push(openDialogCount()));
    const a = Symbol('a');
    const b = Symbol('b');

    registerDialog(a, 0);
    registerDialog(b, 1);
    unregisterDialog(b);
    unregisterDialog(a);

    expect(seen).toEqual([1, 2, 1, 0]);

    unsubscribe();
  });

  it('stops notifying after unsubscribe', () => {
    let calls = 0;
    const unsubscribe = subscribeDialogStack(() => { calls += 1; });

    unsubscribe();
    registerDialog(Symbol('a'), 0);

    expect(calls).toBe(0);
  });

  it('does not notify when a duplicate registration is ignored', () => {
    const a = Symbol('a');
    registerDialog(a, 0);

    let calls = 0;
    const unsubscribe = subscribeDialogStack(() => { calls += 1; });
    registerDialog(a, 0);

    expect(calls).toBe(0);

    unsubscribe();
  });
});

describe('dialogStack top-of-stack', () => {
  it('treats the deepest dialog as top regardless of registration order', () => {
    // React runs child effects before parent effects, so a nested dialog
    // registers BEFORE the dialog containing it. Ordering by registration
    // would report the outer dialog as top, which is backwards.
    const outer = Symbol('outer');
    const inner = Symbol('inner');

    registerDialog(inner, 1);
    registerDialog(outer, 0);

    expect(isTopDialog(inner)).toBe(true);
    expect(isTopDialog(outer)).toBe(false);
  });

  it('falls back to the outer dialog once the nested one closes', () => {
    const outer = Symbol('outer');
    const inner = Symbol('inner');

    registerDialog(inner, 1);
    registerDialog(outer, 0);
    unregisterDialog(inner);

    expect(isTopDialog(outer)).toBe(true);
  });

  it('breaks a tie between siblings in favour of the most recently opened', () => {
    const first = Symbol('first');
    const second = Symbol('second');

    registerDialog(first, 0);
    registerDialog(second, 0);

    expect(isTopDialog(second)).toBe(true);
    expect(isTopDialog(first)).toBe(false);
  });

  it('reports nothing as top when no dialog is open', () => {
    expect(isTopDialog(Symbol('a'))).toBe(false);
  });
});

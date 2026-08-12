import { afterEach, describe, expect, it } from 'vitest';
import {
  isTopDialog,
  openDialogCount,
  registerDialog,
  resetDialogStack,
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

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

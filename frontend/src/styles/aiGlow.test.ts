import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(__dirname, './theme.css'), 'utf8');

describe('ai glow', () => {
  it('defines all five glow tokens in both themes', () => {
    const light = css.slice(css.indexOf(':root {'), css.indexOf(':root[data-theme="dark"]'));
    const dark = css.slice(css.indexOf(':root[data-theme="dark"]'));

    for (const n of [1, 2, 3, 4, 5]) {
      expect(light).toContain(`--ai-glow-${n}:`);
      expect(dark).toContain(`--ai-glow-${n}:`);
    }
  });

  it('drives the border from the tokens, never a hex literal', () => {
    const rule = css.slice(css.indexOf('.ai-glow'), css.indexOf('.ai-glow') + 900);
    expect(rule).toContain('var(--ai-glow-1)');
    expect(rule).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it('stops the rotation under prefers-reduced-motion', () => {
    const reduced = css.slice(css.indexOf('.ai-glow'));
    expect(reduced).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]{0,400}\.ai-glow::before[\s\S]{0,120}animation: none/);
  });
});

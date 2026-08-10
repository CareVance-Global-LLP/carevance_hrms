export type ContrastTone = 'light' | 'dark';

interface RgbColor {
  r: number;
  g: number;
  b: number;
  a?: number;
}

const HEX_SHORT = /^#([\da-f]{3,4})$/i;
const HEX_LONG = /^#([\da-f]{6}|[\da-f]{8})$/i;
const RGB = /^rgba?\(([^)]+)\)$/i;

function clampChannel(value: number) {
  return Math.min(255, Math.max(0, value));
}

function parseHexColor(input: string): RgbColor | null {
  const shortMatch = input.match(HEX_SHORT);
  if (shortMatch) {
    const digits = shortMatch[1];
    const [r, g, b, a] = digits.split('').map((digit) => parseInt(`${digit}${digit}`, 16));
    return { r, g, b, a };
  }

  const longMatch = input.match(HEX_LONG);
  if (!longMatch) {
    return null;
  }

  const digits = longMatch[1];
  if (digits.length === 6) {
    return {
      r: parseInt(digits.slice(0, 2), 16),
      g: parseInt(digits.slice(2, 4), 16),
      b: parseInt(digits.slice(4, 6), 16),
    };
  }

  return {
    r: parseInt(digits.slice(0, 2), 16),
    g: parseInt(digits.slice(2, 4), 16),
    b: parseInt(digits.slice(4, 6), 16),
    a: parseInt(digits.slice(6, 8), 16),
  };
}

function parseRgbColor(input: string): RgbColor | null {
  const match = input.match(RGB);
  if (!match) {
    return null;
  }

  const channels = match[1].split(',').map((value) => value.trim());
  if (channels.length < 3) {
    return null;
  }

  const [r, g, b, a] = channels.map(Number);
  if ([r, g, b].some((value) => Number.isNaN(value))) {
    return null;
  }

  return { r, g, b, a: Number.isNaN(a) ? undefined : a * 255 };
}

function compositeOnWhite(color: RgbColor): RgbColor {
  if (color.a === undefined || color.a >= 255) {
    return color;
  }

  const alpha = color.a / 255;
  return {
    r: clampChannel(Math.round(color.r * alpha + 255 * (1 - alpha))),
    g: clampChannel(Math.round(color.g * alpha + 255 * (1 - alpha))),
    b: clampChannel(Math.round(color.b * alpha + 255 * (1 - alpha))),
  };
}

function toLinear(channel: number) {
  const normalized = channel / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

export function parseColor(input?: string | null): RgbColor | null {
  if (!input) {
    return null;
  }

  return parseHexColor(input) || parseRgbColor(input);
}

export function getRelativeLuminance(input?: string | null) {
  const parsed = parseColor(input);
  if (!parsed) {
    return null;
  }

  const color = compositeOnWhite(parsed);
  const r = toLinear(color.r);
  const g = toLinear(color.g);
  const b = toLinear(color.b);

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function getContrastTone(backgroundColor?: string | null, fallback: ContrastTone = 'light'): ContrastTone {
  const luminance = getRelativeLuminance(backgroundColor);
  if (luminance === null) {
    return fallback;
  }

  return luminance > 0.42 ? 'light' : 'dark';
}

export function getContrastColor(backgroundColor?: string | null, fallback: ContrastTone = 'light') {
  return getContrastTone(backgroundColor, fallback) === 'dark' ? '#f8fafc' : '#020617';
}

const LIGHT_TEXT = '#f8fafc';
const DARK_TEXT = '#020617';

/**
 * Text colour that maximises contrast against an arbitrary background.
 *
 * Distinct from `getContrastColor`, which classifies a surface as light or dark
 * against a 0.42 threshold. That threshold is right for choosing a *tone*, but
 * wrong for choosing readable text: between roughly 0.18 and 0.42 luminance it
 * returns white where black actually reads better. Use this for user-chosen
 * colours — label chips, category swatches — where neither is known in advance.
 */
export function getReadableTextColor(backgroundColor?: string | null, fallback = DARK_TEXT): string {
  const luminance = getRelativeLuminance(backgroundColor);
  if (luminance === null) {
    return fallback;
  }

  const againstLight = 1.05 / (luminance + 0.05);
  const againstDark = (luminance + 0.05) / 0.05;

  return againstLight >= againstDark ? LIGHT_TEXT : DARK_TEXT;
}

import { createElement, type CSSProperties, type ElementType, type ReactNode } from 'react';
import { cn } from '@/utils/cn';
import { getContrastTone, getRelativeLuminance, type ContrastTone } from '@/utils/getContrastColor';
import { useResolvedThemeSafe } from '@/contexts/ThemeContext';

interface AdaptiveSurfaceProps {
  as?: ElementType;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  tone?: ContrastTone | 'auto';
  backgroundColor?: string;
  fallbackTone?: ContrastTone;
  /**
   * Set for surfaces painted a fixed colour regardless of theme (a brand
   * banner, a coloured avatar). Those keep the tone they were given.
   */
  themeIndependent?: boolean;
  [key: string]: unknown;
}

/**
 * Above this, a declared background is a light-theme surface — which means the
 * token layer has repainted it dark, and the declared `tone` is now stale.
 * Matching on luminance rather than a list of strings also catches translucent
 * forms like `rgba(255,255,255,0.95)`, which dropdown panels use.
 */
const LIGHT_SURFACE_LUMINANCE = 0.5;

export default function AdaptiveSurface({
  as = 'div',
  children,
  className,
  style,
  tone = 'auto',
  backgroundColor,
  fallbackTone = 'light',
  themeIndependent = false,
  ...props
}: AdaptiveSurfaceProps) {
  const theme = useResolvedThemeSafe();

  // `tone` describes the *surface*, and the CSS picks contrasting text from it.
  // Callers hardcode tone="light" with backgroundColor="#ffffff", but in dark
  // mode the token layer repaints that surface dark — so the declared tone is
  // stale and would put black text on a dark card. Re-resolve it here.
  const declaredLuminance = backgroundColor ? getRelativeLuminance(backgroundColor) : null;
  const declaredSurfaceIsLight =
    declaredLuminance === null || declaredLuminance > LIGHT_SURFACE_LUMINANCE;

  let resolvedTone: ContrastTone;
  if (theme === 'dark' && !themeIndependent && declaredSurfaceIsLight) {
    resolvedTone = 'dark';
  } else if (tone === 'auto') {
    resolvedTone = getContrastTone(backgroundColor, fallbackTone);
  } else {
    resolvedTone = tone;
  }

  return createElement(
    as,
    {
      ...props,
      className: cn('contrast-surface', className),
      'data-contrast-tone': resolvedTone,
      style,
    },
    children
  );
}

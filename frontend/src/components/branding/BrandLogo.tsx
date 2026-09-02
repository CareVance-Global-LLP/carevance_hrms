import type { HTMLAttributes } from 'react';
import { BRAND, brandLabel } from '@/config/brand';
import { cn } from '@/utils/cn';

interface BrandLogoProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * `full` is the wordmark, `mark` is the circle on its own — what the sidebar
   * shows once it collapses. `icon` is kept as an alias for `mark` so existing
   * call sites keep working.
   */
  variant?: 'full' | 'mark' | 'icon';
  size?: 'sm' | 'md' | 'lg';
  alt?: string;
}

const wrapperSizeMap = {
  full: {
    sm: 'h-[3.25rem]',
    md: 'h-15',
    lg: 'h-[4.25rem]',
  },
  mark: {
    sm: 'h-11 w-11',
    md: 'h-[3.25rem] w-[3.25rem]',
    lg: 'h-16 w-16',
  },
} as const;

/*
 * PNG, deliberately — do not "optimise" these to the SVGs sitting beside them
 * in public/.
 *
 * The SVGs are 572 and 1,027 bytes against the PNGs' 78,074 and 12,152, which
 * makes them look like an obvious win. They are not the same artwork: their
 * monogram is a rough approximation — a solid blob with a stray notch, where
 * the real mark is a C and a V locked together. The favicon points at the PNG,
 * so switching only the app made the two disagree on screen.
 *
 * Replacing these with proper vectors is worth doing, but it needs the real
 * source from whoever owns the brand, not a redraw.
 */
const assetMap = {
  full: BRAND.logoFull,
  mark: BRAND.logoMark,
} as const;

export default function BrandLogo({
  variant = 'full',
  size = 'md',
  alt = brandLabel,
  className,
  ...props
}: BrandLogoProps) {
  const resolved = variant === 'icon' ? 'mark' : variant;

  /*
   * Un-branded, there is no vendor mark to draw.
   *
   * The wrapper is still rendered, at the same size, so every layout that
   * reserves space for the logo keeps its geometry -- the sidebar, the auth
   * shell and the topbar all size themselves around this box. Returning null
   * outright collapsed the sidebar header by 3.25rem.
   */
  if (!BRAND.enabled) {
    return (
      <div
        className={cn(
          'inline-flex shrink-0 items-center justify-start align-middle',
          wrapperSizeMap[resolved][size],
          resolved === 'full' ? 'w-full' : '',
          className
        )}
        aria-hidden="true"
        {...props}
      />
    );
  }

  return (
    <div
      className={cn(
        'inline-flex shrink-0 items-center justify-start overflow-hidden align-middle',
        wrapperSizeMap[resolved][size],
        resolved === 'full' ? 'w-full' : '',
        className
      )}
      {...props}
    >
      <img
        src={assetMap[resolved]}
        alt={alt}
        className={cn(
          'block max-w-full object-contain',
          resolved === 'full' ? 'h-full w-auto' : 'h-full w-full'
        )}
      />
    </div>
  );
}

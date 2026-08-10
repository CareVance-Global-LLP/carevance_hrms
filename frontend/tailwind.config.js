/**
 * Colours resolve through CSS custom properties defined in src/styles/theme.css.
 *
 * The `rgb(var(--x) / <alpha-value>)` form is what keeps opacity modifiers
 * (`bg-slate-200/60`, `ring-sky-300/25`) working; a plain `var(--x)` would break
 * them. Because every palette is indirected this way, switching themes is a
 * matter of flipping the variables — no component classes change.
 */
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;
const ramp = (prefix, steps) =>
  Object.fromEntries(steps.map((step) => [step, token(`${prefix}-${step}`)]));

const FULL = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];
const FULL_950 = [...FULL, 950];
const SEMANTIC = [50, 100, 500, 700, 800];

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  // Theme is driven by an explicit attribute rather than the OS query, so the
  // in-app toggle can override the system preference. "system" is resolved in
  // JS and written out as this attribute.
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // Brand Teal (replaces blue as primary interactive color)
        blue: ramp('brand', FULL_950),
        // Keep `primary` as alias for backward compat
        primary: ramp('brand', FULL),
        // Brand Gold (accent / CTA)
        accent: ramp('accent', FULL),
        // Brand neutral scale (single source of truth for all grays)
        neutral: ramp('n', FULL),
        // `ink` = semantic text scale (replaces raw slate-*-as-text usages)
        ink: ramp('n', FULL),
        // Re-point Tailwind's `gray` and `slate` at the brand neutral scale so
        // every existing `slate-*` / `gray-*` class is already on-brand.
        gray: ramp('n', FULL),
        slate: ramp('n', FULL_950),
        // Semantic status system (darkened text-on-tint pairs for AA contrast)
        success: ramp('success', SEMANTIC),
        warning: ramp('warning', SEMANTIC),
        danger: ramp('danger', SEMANTIC),
        info: ramp('info', SEMANTIC),
        // Stock Tailwind palettes the app uses directly. Tokenised so status
        // tints (`bg-emerald-50 text-emerald-700`) invert in dark mode instead
        // of glowing as light chips on a dark card.
        emerald: ramp('emerald', FULL),
        rose: ramp('rose', FULL),
        amber: ramp('amber', FULL),
        sky: ramp('sky', FULL),
        red: ramp('red', FULL),
        green: ramp('green', FULL),
        violet: ramp('violet', FULL),
        teal: ramp('teal', FULL),
        indigo: ramp('indigo', FULL),
        cyan: ramp('cyan', FULL),
        orange: ramp('orange', FULL),
        purple: ramp('purple', FULL),
        yellow: ramp('yellow', FULL),
        surface: {
          base: token('app-bg'),
          card: token('surface-card'),
          raised: token('surface-raised'),
          sunken: token('surface-sunken'),
          // Deliberately dark-on-light in light mode, and the reverse in dark.
          // Use this instead of `bg-slate-900` for intentionally inverted chrome.
          inverse: token('surface-inverse'),
        },
        'on-inverse': token('on-inverse'),
        'on-brand': token('on-brand'),
        'border-strong': token('border-strong'),
        background: token('app-bg'),
      },
      fontSize: {
        // Page / display title
        display: ['1.75rem', { lineHeight: '2.1rem', letterSpacing: '-0.02em', fontWeight: '700' }],
        // Section / card header
        section: ['1rem', { lineHeight: '1.5rem', fontWeight: '600' }],
        // KPI / numeric data values
        data: ['1.5rem', { lineHeight: '2rem', fontWeight: '700', letterSpacing: '-0.01em' }],
        // Field labels / KPI eyebrows
        caption: ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.08em', fontWeight: '600' }],
      },
      borderRadius: {
        lg: '0.5rem',
        xl: '0.75rem',
      },
      boxShadow: {
        // Resting cards
        card: '0 1px 2px rgba(15,23,42,0.04), 0 1px 6px rgba(15,23,42,0.04)',
        // Hover lift (brand-tinted) — mirrors .card-hover
        'card-hover': '0 14px 30px -14px rgba(93,150,157,0.25), 0 8px 16px -12px rgba(15,23,42,0.15)',
        // Modals / dropdowns / overlays
        modal: '0 20px 50px -20px rgba(15,23,42,0.30), 0 10px 24px -16px rgba(15,23,42,0.20)',
      },
      fontWeight: {
        semibold: '600',
      },
      fontFamily: {
        sans: ['Manrope', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['Space Grotesk', 'Manrope', 'sans-serif'],
      },
      keyframes: {
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pulseGlow: {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.85', transform: 'scale(1.03)' },
        },
      },
      animation: {
        'fade-up': 'fadeUp 0.4s ease-out',
        'pulse-glow': 'pulseGlow 2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}

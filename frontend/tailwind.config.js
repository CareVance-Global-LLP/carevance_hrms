/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Brand Teal (replaces blue as primary interactive color)
        blue: {
          50: '#F0F7F8',
          100: '#D9EBED',
          200: '#B3D7DB',
          300: '#8DC3C9',
          400: '#7AADB3',
          500: '#5D969D',
          600: '#5D969D',
          700: '#3D656B',
          800: '#305056',
          900: '#233B40',
          950: '#16262B',
        },
        // Keep `primary` as alias for backward compat
        primary: {
          50: '#F0F7F8',
          100: '#D9EBED',
          200: '#B3D7DB',
          300: '#8DC3C9',
          400: '#7AADB3',
          500: '#5D969D',
          600: '#5D969D',
          700: '#3D656B',
          800: '#305056',
          900: '#233B40',
        },
        // Brand Gold (accent / CTA)
        accent: {
          50: '#FDF8EF',
          100: '#FBEFCF',
          200: '#F7E09F',
          300: '#F3D06F',
          400: '#E3A842',
          500: '#C8923A',
          600: '#A87A30',
          700: '#886226',
          800: '#684A1C',
          900: '#483212',
        },
        // Brand neutral scale (single source of truth for all grays)
        neutral: {
          50: '#F8FAFB',
          100: '#F1F4F6',
          200: '#E4E8EB',
          300: '#D2D8DD',
          400: '#9AA4AC',
          500: '#6B757D',
          600: '#4E565D',
          700: '#3A4147',
          800: '#272C30',
          900: '#16191C',
        },
        // `ink` = semantic text scale (replaces raw slate-*-as-text usages)
        ink: {
          900: '#16191C',
          800: '#272C30',
          700: '#3A4147',
          600: '#4E565D',
          500: '#6B757D',
          400: '#9AA4AC',
          300: '#D2D8DD',
          200: '#E4E8EB',
          100: '#F1F4F6',
          50: '#F8FAFB',
        },
        // Re-point Tailwind's `gray` and `slate` at the brand neutral scale so
        // every existing `slate-*` / `gray-*` class is already on-brand.
        gray: {
          50: '#F8FAFB',
          100: '#F1F4F6',
          200: '#E4E8EB',
          300: '#D2D8DD',
          400: '#9AA4AC',
          500: '#6B757D',
          600: '#4E565D',
          700: '#3A4147',
          800: '#272C30',
          900: '#16191C',
        },
        slate: {
          50: '#F8FAFB',
          100: '#F1F4F6',
          200: '#E4E8EB',
          300: '#D2D8DD',
          400: '#9AA4AC',
          500: '#6B757D',
          600: '#4E565D',
          700: '#3A4147',
          800: '#272C30',
          900: '#16191C',
          950: '#0E1012',
        },
        // Semantic status system (darkened text-on-tint pairs for AA contrast)
        success: {
          50: '#ECFDF5',
          100: '#D1FAE5',
          500: '#10B981',
          700: '#047857',
          800: '#065F46',
        },
        warning: {
          50: '#FEF6E7',
          100: '#FDECCB',
          500: '#E3A842',
          700: '#A87A30',
          800: '#7A560E',
        },
        danger: {
          50: '#FEF2F2',
          100: '#FEE2E2',
          500: '#EF4444',
          700: '#B91C1C',
          800: '#991B1B',
        },
        info: {
          50: '#F0F7F8',
          100: '#D9EBED',
          500: '#5D969D',
          700: '#3D656B',
          800: '#305056',
        },
        surface: {
          base: '#F5F7F8',
          card: '#FFFFFF',
          raised: '#FFFFFF',
        },
        background: '#F5F7F8',
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

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
        // Brand Gray (neutral UI)
        gray: {
          50: '#FAFAFA',
          100: '#F4F4F5',
          200: '#E4E4E7',
          300: '#D4D4D8',
          400: '#9B9498',
          500: '#71717A',
          600: '#52525B',
          700: '#3F3F46',
          800: '#27272A',
          900: '#18181B',
        },
        surface: '#FFFFFF',
        background: '#F5F7F8',
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

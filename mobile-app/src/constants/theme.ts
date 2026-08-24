/**
 * Mobile palette, derived from the web app's brand tokens.
 *
 * The source of truth is frontend/src/styles/theme.css — CareVance is teal
 * (#5D969D) with a gold accent (#E3A842), and the mark itself is gold. Mobile
 * had been built on stock blue (#2563eb), so the two products did not look like
 * the same company.
 *
 * Values are the web's own ramp entries, not approximations:
 *   primary       brand-500/600
 *   primaryLight  brand-100
 *   accent        accent-400
 *   text/borders   the `n` neutral ramp
 * Dark values come from the [data-theme="dark"] block, which was deliberately
 * lightened for AA contrast — do not "simplify" them back to the light values.
 */
export const lightColors = {
  background: '#F5F7F8',
  surface: '#FFFFFF',
  text: '#16191C',
  textSecondary: '#4E565D',
  textTertiary: '#6B757D',
  border: '#E2E5E7',
  primary: '#5D969D',
  primaryLight: '#D9EBED',
  /** Brand gold. Reserved for emphasis and the mark — never for body text. */
  accent: '#E3A842',
  danger: '#EF4444',
  success: '#10B981',
  warning: '#E3A842',
  card: '#FFFFFF',
  input: '#F1F4F6',
  tabBar: '#FFFFFF',
  tabBarBorder: '#E2E5E7',
  headerBg: '#FFFFFF',
  skeleton: '#E4E8EB',
  overlay: 'rgba(0,0,0,0.5)',
};

export const darkColors: typeof lightColors = {
  background: '#0E141A',
  surface: '#161F26',
  text: '#E6EDF0',
  textSecondary: '#A9B8C0',
  textTertiary: '#869298',
  border: '#2A3841',
  primary: '#6FA9B0',
  primaryLight: '#16303A',
  accent: '#EBB861',
  danger: '#F87171',
  success: '#34C88A',
  warning: '#EBB861',
  card: '#161F26',
  input: '#212C34',
  tabBar: '#161F26',
  tabBarBorder: '#2A3841',
  headerBg: '#161F26',
  skeleton: '#212C34',
  overlay: 'rgba(0,0,0,0.7)',
};

export type ThemeColors = typeof lightColors;

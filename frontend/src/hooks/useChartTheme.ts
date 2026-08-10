import { useMemo } from 'react';
import { useResolvedThemeSafe } from '@/contexts/ThemeContext';

/**
 * Recharts takes colours as props, not classes, so it can't reach the CSS token
 * layer the rest of the app themes through. This hook is the bridge: one source
 * of chart colour for both themes.
 *
 * The series palette is ordered for categorical distinctness rather than by
 * hue family, and is qualitatively matched between themes — the same series
 * index stays recognisably "the same colour" when the theme flips.
 */
export interface ChartTheme {
  /** Cartesian grid lines. */
  grid: string;
  /** Axis lines and tick labels. */
  axis: string;
  axisLabel: string;
  /** Tooltip container + text. */
  tooltip: { background: string; border: string; text: string; shadow: string };
  /** Halo drawn around active dots — matches the surface behind the chart. */
  surface: string;
  /** Categorical series colours, in draw order. */
  series: string[];
  /** Semantic series colours for known meanings. */
  positive: string;
  negative: string;
  warning: string;
  neutral: string;
  /** Opacity for area fills under lines. */
  areaOpacity: number;
  isDark: boolean;
}

const LIGHT: ChartTheme = {
  grid: '#E4E8EB',
  axis: '#D2D8DD',
  axisLabel: '#6B757D',
  tooltip: {
    background: '#FFFFFF',
    border: '#E4E8EB',
    text: '#16191C',
    shadow: '0 10px 24px -12px rgba(15,23,42,0.25)',
  },
  surface: '#FFFFFF',
  series: ['#5D969D', '#E3A842', '#4C8DBF', '#7A9E5B', '#B5739E', '#3D656B', '#C77F52'],
  positive: '#10B981',
  negative: '#EF4444',
  warning: '#E3A842',
  neutral: '#9AA4AC',
  areaOpacity: 0.18,
  isDark: false,
};

const DARK: ChartTheme = {
  grid: '#212C34',
  axis: '#2A3841',
  axisLabel: '#A9B8C0',
  tooltip: {
    background: '#1E2A33',
    border: '#2A3841',
    text: '#E6EDF0',
    shadow: '0 16px 40px -12px rgba(0,0,0,0.7)',
  },
  surface: '#161F26',
  // Lifted and slightly desaturated so they read on a dark ground without glowing.
  series: ['#7FB6BD', '#EBB861', '#7FB0DC', '#9DC47B', '#D194BC', '#A5D4DA', '#E09B6B'],
  positive: '#4FBF8B',
  negative: '#E0776A',
  warning: '#DFAF57',
  neutral: '#7C8C96',
  areaOpacity: 0.24,
  isDark: true,
};

export function useChartTheme(): ChartTheme {
  const theme = useResolvedThemeSafe();
  return useMemo(() => (theme === 'dark' ? DARK : LIGHT), [theme]);
}

export default useChartTheme;

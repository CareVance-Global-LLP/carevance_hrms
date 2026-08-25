import React, { createContext, useContext, useEffect, useState, useCallback, useMemo, useTransition } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { lightColors, darkColors, ThemeColors } from '../constants/theme';

type ThemeMode = 'system' | 'light' | 'dark';

interface ThemeContextValue {
  colors: ThemeColors;
  isDark: boolean;
  mode: ThemeMode;
  /**
   * False until the stored preference has been read back.
   *
   * The provider starts on 'system' and loads the saved choice asynchronously,
   * so anything painted before this flips can be the wrong theme. The splash is
   * held on it to avoid a light-to-dark flash on every launch.
   */
  isReady: boolean;
  setMode: (mode: ThemeMode) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  colors: lightColors,
  isDark: false,
  mode: 'system',
  isReady: true,
  setMode: () => {},
  toggleTheme: () => {},
});

const STORAGE_KEY = '@theme_mode';

export function ThemeProvider({ children }: { children: React.ReactElement }) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');
  const [isReady, setIsReady] = useState(false);
  const [, startTransition] = useTransition();

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (stored === 'light' || stored === 'dark' || stored === 'system') {
          setModeState(stored);
        }
      })
      // A theme we cannot read is not worth holding the app for; 'system' is a
      // reasonable answer and the splash must not wait on a failed read.
      .catch(() => {})
      .finally(() => setIsReady(true));
  }, []);

  const isDark = mode === 'dark' || (mode === 'system' && systemScheme === 'dark');
  const colors = isDark ? darkColors : lightColors;

  const setMode = useCallback((newMode: ThemeMode) => {
    setModeState(newMode);
    AsyncStorage.setItem(STORAGE_KEY, newMode);
  }, []);

  const toggleTheme = useCallback(() => {
    startTransition(() => {
      setMode(isDark ? 'light' : 'dark');
    });
  }, [isDark, setMode, startTransition]);

  const value = useMemo(
    () => ({ colors, isDark, mode, isReady, setMode, toggleTheme }),
    [colors, isDark, mode, isReady, setMode, toggleTheme]
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}

import { Redirect } from 'expo-router';
import { View } from 'react-native';
import { useAuth } from '../src/hooks/useAuth';
import { useTheme } from '../src/hooks/useTheme';

/**
 * The gate between the splash and the app.
 *
 * There is deliberately no spinner here any more. The native splash is still on
 * screen for as long as `isLoading` is true (app/_layout.tsx holds it), so
 * whatever this renders is only ever glimpsed through the fade. A plain themed
 * background is indistinguishable from the splash behind it; the white view and
 * blue spinner that used to live here were the flash on every launch.
 */
export default function Index() {
  const { isAuthenticated, isLoading } = useAuth();
  const { colors } = useTheme();

  if (isLoading) {
    return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  }

  return <Redirect href={isAuthenticated ? '/(tabs)' : '/login'} />;
}

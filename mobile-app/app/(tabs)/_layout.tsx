import React, { useRef, useEffect } from 'react';
import { View, StyleSheet, Platform, Dimensions, Pressable, Animated } from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../src/hooks/useAuth';
import { useTheme } from '../../src/hooks/useTheme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const TAB_BAR_WIDTH = SCREEN_WIDTH * 0.88;
const NUM_TABS = 5;

const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  index: 'home-sharp',
  attendance: 'time-sharp',
  leave: 'calendar-sharp',
  team: 'people-sharp',
  more: 'ellipsis-horizontal-sharp',
};

function FloatingPillTabBar({ state, descriptors, navigation, colors, isDark }: any) {
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: state.index * (TAB_BAR_WIDTH / NUM_TABS),
      useNativeDriver: true,
      tension: 100,
      friction: 8,
    }).start();
  }, [state.index, slideAnim]);

  return (
    <View style={[styles.outerContainer, { paddingBottom: insets.bottom + 8 }]}>
      <View style={styles.pillShadowWrapper}>
        <BlurView
          intensity={Platform.OS === 'ios' ? 85 : 70}
          tint={isDark ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight'}
          style={styles.blurContainer}
          experimentalBlurMethod="dimezisBlurView"
        >
          <View style={[styles.tabBar, { backgroundColor: isDark ? 'rgba(28, 28, 30, 0.65)' : 'rgba(255, 255, 255, 0.65)' }]}>
            <Animated.View
              style={[
                styles.slidingIndicator,
                {
                  transform: [{ translateX: slideAnim }],
                  backgroundColor: colors.primary + '18',
                },
              ]}
            />
            {state.routes.map((route: any, index: number) => {
              const { options } = descriptors[route.key];
              const isFocused = state.index === index;
              const iconName = ICONS[route.name] || 'help';

              const onPress = () => {
                const event = navigation.emit({
                  type: 'tabPress',
                  target: route.key,
                  canPreventDefault: true,
                });
                if (!isFocused && !event.defaultPrevented) {
                  navigation.navigate(route.name);
                }
              };

              return (
                <TabButton
                  key={route.key}
                  iconName={iconName}
                  isFocused={isFocused}
                  onPress={onPress}
                  colors={colors}
                />
              );
            })}
          </View>
        </BlurView>
      </View>
    </View>
  );
}

function TabButton({ iconName, isFocused, onPress, colors }: { iconName: keyof typeof Ionicons.glyphMap; isFocused: boolean; onPress: () => void; colors: any }) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scaleAnim, { toValue: 0.88, useNativeDriver: true, tension: 300, friction: 12 }).start();
  };
  const handlePressOut = () => {
    Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, tension: 300, friction: 12 }).start();
  };

  return (
    <Pressable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={styles.tabButton}
      android_ripple={{ borderless: true, radius: 28, color: colors.primary + '15' }}
    >
      <Animated.View style={[styles.iconWrapper, { transform: [{ scale: scaleAnim }] }]}>
        <View style={[styles.bubble, isFocused && { backgroundColor: colors.primary + '18' }]}>
          <Ionicons name={iconName} size={23} color={isFocused ? colors.primary : colors.textSecondary} />
        </View>
        <View style={[styles.dot, { backgroundColor: isFocused ? colors.primary : 'transparent' }]} />
      </Animated.View>
    </Pressable>
  );
}

export default function TabLayout() {
  const { isAuthenticated } = useAuth();
  const { colors, isDark } = useTheme();
  const router = useRouter();

  useEffect(() => {
    if (!isAuthenticated) router.replace('/login');
  }, [isAuthenticated, router]);

  return (
    <Tabs
      tabBar={(props) => <FloatingPillTabBar {...props} colors={colors} isDark={isDark} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="attendance" options={{ title: 'Attendance' }} />
      <Tabs.Screen name="leave" options={{ title: 'Leave' }} />
      <Tabs.Screen name="team" options={{ title: 'Team' }} />
      <Tabs.Screen name="more" options={{ title: 'More' }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  outerContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  pillShadowWrapper: {
    width: TAB_BAR_WIDTH,
    borderRadius: 28,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 16,
  },
  blurContainer: {
    borderRadius: 28,
    overflow: 'hidden',
  },
  tabBar: {
    flexDirection: 'row',
    height: 64,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  slidingIndicator: {
    position: 'absolute',
    top: '15%',
    left: 0,
    width: TAB_BAR_WIDTH / NUM_TABS,
    height: '70%',
    borderRadius: 18,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
  },
  iconWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  bubble: {
    width: 44,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    marginTop: 3,
  },
});

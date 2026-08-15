import { Tabs } from 'expo-router';
import { View, type ColorValue } from 'react-native';
import { colors } from '../../src/theme/colors';

/** Bottom tabs — Command (the heart of the app, SPEC.md §6), Connections,
 * Settings. Dark-only, single accent for the active state. */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textTertiary,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.hairline },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Command', tabBarIcon: ({ color }) => <Dot color={color} /> }}
      />
      <Tabs.Screen
        name="connections"
        options={{ title: 'Connections', tabBarIcon: ({ color }) => <Dot color={color} /> }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: 'Settings', tabBarIcon: ({ color }) => <Dot color={color} /> }}
      />
    </Tabs>
  );
}

// Minimal dependency-free tab icon — a filled dot in the active/inactive
// tint. Swap for @expo/vector-icons glyphs if a richer icon set is wanted.
function Dot({ color }: { color: ColorValue }) {
  return <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />;
}
